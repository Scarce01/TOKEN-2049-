"""Decoy generation steps 1 to 4 (docs/48_decoy_generation.md).

1. attacker strategy library, Plackett-Luce choice model
2. attractive segments, candidates by kNN interpolation, consistency rules, DCR privacy bounds
3. adversarial validation (logistic + gradient boosting, k-fold, bootstrap AUC, importance, honeyword test)
4. greedy maximin placement under budget, rho_max and the AUC gate, randomized among near-optimal picks

Inputs are only what an attacker inside the exchange backend could see (datasets/src/types.ts Account).
Every threshold below is source = assumed.
"""

import math
import warnings

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict

warnings.filterwarnings("ignore", message="Unknown solver options")  # scipy/sklearn version noise

# datasets/src/gen-accounts.ts PARAMS (assumed); decoys must follow the same rules as real rows
ETH_USD, ETH_SHARE, ETH_MIN_USD = 3000, 0.35, 2000
BAL_MIN, BAL_MAX = 15, 60_000
FEATURES = ["regDays", "activity", "depFreq", "wdFreq", "kycLevel", "balanceUsd", "hasEth"]
CONT = [0, 1, 2, 3, 5]  # continuous columns of vec()
LOG_FEATURES = ["regDays", "activity", "depFreq", "wdFreq", "balanceUsd"]

CFG = {
    "beta": 2.0,  # attacker sharpness in w = exp(beta * z)
    "segmentShare": 0.10,  # attractive segment = top 10 % of real accounts by the strategy score
    "segmentMin": 8,
    "knn": 3,
    "jitter": 1.0,
    "resampleRounds": 2,  # smoothed bootstrap: noise scale relative to the seed's nearest-real distance
    "dcrPct": (5, 95),  # candidate DCR must sit inside the real-to-real nearest-neighbour p5..p95
    "folds": 5,
    "bootstrap": 1000,
    "aucMax": 0.65,  # D28: bootstrap 95 % CI of the out-of-fold AUC must sit inside [1 - aucMax, aucMax]
    "honeyK": 5,
    "honeyMax": 0.35,  # share of honeyword groups where the decoy looks most decoy-like (chance = 1/k)
    "rhoMax": 0.15,  # decoys may be at most 15 % of any attractive segment
    "topM": 3,  # Stackelberg: pick uniformly among the best topM greedy moves
    "mcRuns": 10_000,
    "probeK": 5,
}

# fields an attacker strategy would want but the backend schema does not have (reported, not modeled)
NOT_MODELED = ["whitelist_age", "withdrawal_lock", "recent_large_deposit", "api_key_present"]


NAMES = ["amber", "birch", "cedar", "delta", "ember", "fjord", "grove", "harbor", "iris", "juniper", "kestrel", "lumen"]


def synthetic_population(n: int, seed: int, org: str = "a") -> list[dict]:
    """Same assumed distributions as datasets/src/gen-accounts.ts PARAMS. The 100-account demo data is too
    small for the AUC gate (about 19 rows in the attractive segments), so tests and the live demo use this."""
    r = np.random.default_rng(seed)
    out = []
    for i in range(n):
        usd = max(15.0, min(float(r.lognormal(math.log(400), 1.4)), BAL_MAX))
        out.append({
            "org": org, "userId": f"u{org}-{100_000 + i}", "displayName": f"{NAMES[i % len(NAMES)]}-{1000 + i % 9000}",
            "kycLevel": int(r.choice([1, 2, 3], p=[0.15, 0.55, 0.3])), "regDays": float(r.lognormal(math.log(200), 1.0)),
            "activity": float(r.lognormal(math.log(4), 0.8)), "depFreq": float(r.lognormal(math.log(2), 0.7)),
            "wdFreq": float(r.lognormal(math.log(1.5), 0.7)), "balanceUsd": usd, "deposits": deposits_for(usd),
        })
    return out


def eth_usd(a: dict) -> float:
    return int(a["deposits"]["qETH"]) / 1e18 * ETH_USD


def _l(x: float) -> float:
    return math.log(max(x, 1e-9))


STRATEGIES = {
    "whale": lambda a, q: _l(a["balanceUsd"]),
    "dormant_whale": lambda a, q: _l(a["balanceUsd"]) - _l(a["activity"]),
    "eth_holder": lambda a, q: math.log1p(eth_usd(a)),
    "trusted_veteran": lambda a, q: _l(a["balanceUsd"]) + _l(a["regDays"]),
    "busy_withdrawer": lambda a, q: _l(a["balanceUsd"]) + _l(a["wdFreq"]),
    # whale that skips what looks too good to be true: brand new accounts and near-dead ones
    "cautious": lambda a, q: _l(a["balanceUsd"])
    - 3.0 * (a["regDays"] < q["regDays_p10"])
    - 3.0 * (a["activity"] < q["activity_p5"]),
    "random": lambda a, q: 0.0,
}


def vec(a: dict) -> list[float]:
    return [math.log1p(a[f]) for f in LOG_FEATURES[:4]] + [
        float(a["kycLevel"]),
        math.log1p(a["balanceUsd"]),
        float(eth_usd(a) > 0),
    ]


def deposits_for(usd: float) -> dict:
    """Same split as makeAccount: 35 % in qETH above 2,000 USD, the rest in qUSD (6 decimals)."""
    eth = usd * ETH_SHARE / ETH_USD if usd > ETH_MIN_USD else 0.0
    usd_part = usd - eth * ETH_USD
    return {"qUSD": str(round(usd_part * 100) * 10_000), "qETH": str(round(eth * 1e6) * 10**12) if eth > 0 else "0"}


def consistent(a: dict) -> bool:
    if a["kycLevel"] not in (1, 2, 3) or not BAL_MIN <= a["balanceUsd"] <= BAL_MAX or a["regDays"] < 1:
        return False
    if min(a["activity"], a["depFreq"], a["wdFreq"]) <= 0:
        return False
    total = int(a["deposits"]["qUSD"]) / 1e6 + eth_usd(a)
    return abs(total - a["balanceUsd"]) < 0.02 and (eth_usd(a) > 0) == (a["balanceUsd"] > ETH_MIN_USD)


class Population:
    """The real accounts and everything derived from them; decoys are scored against this, never added to it."""

    def __init__(self, real: list[dict], cfg: dict = CFG):
        self.cfg, self.real = cfg, real
        self.X = np.array([vec(a) for a in real])
        self.mu, self.sd = self.X.mean(0), self.X.std(0)
        self.sd[self.sd == 0] = 1.0
        self.Z = self.z(self.X)
        self.q = {
            "regDays_p10": float(np.percentile([a["regDays"] for a in real], 10)),
            "activity_p5": float(np.percentile([a["activity"] for a in real], 5)),
        }
        self.S = {s: np.array([f(a, self.q) for a in real]) for s, f in STRATEGIES.items()}
        self.smu = {s: v.mean() for s, v in self.S.items()}
        self.ssd = {s: (v.std() or 1.0) for s, v in self.S.items()}
        self.Wr = {s: self.w(s, self.S[s]).sum() for s in STRATEGIES}
        size = max(cfg["segmentMin"], math.ceil(cfg["segmentShare"] * len(real)))
        self.segment = {s: np.argsort(-v, kind="stable")[:size] for s, v in self.S.items() if s != "random"}
        self.threshold = {s: self.S[s][idx].min() for s, idx in self.segment.items()}
        self.union = np.array(sorted({int(i) for idx in self.segment.values() for i in idx}))
        # seeds come from a band twice as wide, so mass jitters INTO the segments as well as out of them;
        # seeding from the segments alone left the survivors richer than the real members (boundary truncation)
        wide = 2 * size
        self.seeds = np.array(sorted({int(i) for s, v in self.S.items() if s != "random" for i in np.argsort(-v, kind="stable")[:wide]}))
        d = np.linalg.norm(self.Z[:, None] - self.Z[None], axis=2)
        np.fill_diagonal(d, np.inf)
        self.nn = d.min(1)  # each real account's distance to its nearest other real account
        lo, hi = cfg["dcrPct"]
        u = self.nn[self.union]
        self.dcr_bounds = (float(np.percentile(u, lo)), float(np.percentile(u, hi)))

    def z(self, X):
        return (np.asarray(X) - self.mu) / self.sd

    def w(self, s: str, scores) -> np.ndarray:
        return np.exp(self.cfg["beta"] * (np.asarray(scores) - self.smu[s]) / self.ssd[s])

    def score(self, a: dict) -> dict:
        return {s: f(a, self.q) for s, f in STRATEGIES.items()}

    def segments_of(self, a: dict) -> list[str]:
        sc = self.score(a)
        return sorted(s for s in self.segment if sc[s] >= self.threshold[s])

    def dcr(self, a: dict) -> float:
        return float(np.linalg.norm(self.Z - self.z(vec(a)), axis=1).min())

    def admissible(self, a: dict) -> bool:
        lo, hi = self.dcr_bounds
        return consistent(a) and lo <= self.dcr(a) <= hi and bool(self.segments_of(a))


def interpolate(pop: Population, rng: np.random.Generator, n: int) -> list[dict]:
    """SMOTE-like with smoothing: a seed from the attractive segments or just below them, one of its
    k nearest neighbours among the seeds, a random point between them, plus noise scaled to the seed's nearest-real
    distance so decoys are not unnaturally close to a real account (the attacker can measure that too).
    Identity (userId, displayName) is NOT set here; lifecycle draws it independently of the features."""
    U, Zu, out = pop.seeds, pop.Z[pop.seeds], []
    for _ in range(n):
        i = int(rng.integers(len(U)))
        nn = np.argsort(np.linalg.norm(Zu - Zu[i], axis=1), kind="stable")[1 : pop.cfg["knn"] + 1]
        j = int(nn[int(rng.integers(len(nn)))])
        z = Zu[i] + float(rng.random()) * (Zu[j] - Zu[i])
        z[CONT] += rng.normal(size=len(CONT)) * pop.cfg["jitter"] * pop.nn[U[i]] / math.sqrt(len(CONT))
        x = z * pop.sd + pop.mu
        a, b = pop.real[U[i]], pop.real[U[j]]
        c = {f: math.expm1(x[k]) for k, f in zip(CONT, LOG_FEATURES[:4] + ["balanceUsd"])}
        c["regDays"] = max(c["regDays"], 1.0)
        c["balanceUsd"] = min(max(c["balanceUsd"], BAL_MIN), BAL_MAX)
        c["kycLevel"] = a["kycLevel"] if rng.random() < 0.5 else b["kycLevel"]
        c["deposits"] = deposits_for(c["balanceUsd"])
        out.append(c)
    return out


def attacker_view(pop: Population, accounts: list[dict], real_idx=None) -> np.ndarray:
    """What a classifier gets: standardized features plus distance to the nearest real account."""
    if real_idx is not None:
        return np.column_stack([pop.Z[real_idx], pop.nn[real_idx]])
    return np.column_stack([pop.z([vec(a) for a in accounts]), [pop.dcr(a) for a in accounts]])


def generate(pop: Population, rng: np.random.Generator, n: int) -> list[dict]:
    """interpolate -> consistency, segment and DCR bounds -> density-ratio resampling: an out-of-fold
    real-vs-candidate model (logistic + gradient boosting) on the attacker's view gives p; candidates are
    drawn with weight (1 - p) / p, which reshapes them toward the segment members on every visible covariate.
    Draw size is the effective sample size, so a few heavy weights cannot dominate."""
    cands = [c for c in interpolate(pop, rng, n) if pop.admissible(c)]
    Xr = attacker_view(pop, [], pop.union)
    for _ in range(pop.cfg["resampleRounds"]):
        if len(cands) < 20:
            return []
        Xc = attacker_view(pop, cands)
        X, y = np.vstack([Xr, Xc]), np.array([0] * len(Xr) + [1] * len(Xc))
        seed = int(rng.integers(2**31))
        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=seed)
        p = np.mean([cross_val_predict(m, X, y, cv=cv, method="predict_proba")[:, 1] for m in (
            LogisticRegression(max_iter=1000), GradientBoostingClassifier(random_state=seed))], 0)[len(Xr) :]
        w = (1 - np.clip(p, 0.02, 0.98)) / np.clip(p, 0.02, 0.98)
        size = int(min(len(cands) // 2, w.sum() ** 2 / (w**2).sum()))
        cands = [cands[i] for i in rng.choice(len(cands), size=size, replace=False, p=w / w.sum())]
    return cands


def _bootstrap(y, p, rng, n):
    vals = []
    for _ in range(n):
        i = rng.integers(0, len(y), len(y))
        if y[i].min() != y[i].max():
            vals.append(roc_auc_score(y[i], p[i]))
    return float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))


def adversarial(pop: Population, decoys: list[dict], seed: int) -> dict:
    """Can a classifier tell the decoys from the real accounts of the attractive segments they sit in?"""
    cfg = pop.cfg
    real_idx = [int(i) for i in pop.union]
    X = np.vstack([attacker_view(pop, [], real_idx), attacker_view(pop, decoys)])
    y = np.array([0] * len(real_idx) + [1] * len(decoys))
    folds = min(cfg["folds"], len(decoys), len(real_idx))
    if folds < 2:
        return {"gate": False, "reason": "need at least 2 decoys and 2 real rows"}
    cv = StratifiedKFold(n_splits=folds, shuffle=True, random_state=seed % 2**32)
    rng = np.random.default_rng(seed)
    out = {"realRows": len(real_idx), "decoyRows": len(decoys), "folds": folds, "source": "assumed"}
    probs = []
    for name, model in [
        ("logistic", LogisticRegression(max_iter=1000)),
        ("gradient_boosting", GradientBoostingClassifier(random_state=seed % 2**32)),
    ]:
        p = cross_val_predict(model, X, y, cv=cv, method="predict_proba")[:, 1]
        lo, hi = _bootstrap(y, p, rng, cfg["bootstrap"])
        out[name] = {"auc": float(roc_auc_score(y, p)), "ci95": [lo, hi]}
        probs.append(p)
    gbt = GradientBoostingClassifier(random_state=seed % 2**32).fit(X, y)
    out["importance"] = dict(sorted(zip(FEATURES + ["nnDist"], map(float, gbt.feature_importances_)), key=lambda kv: -kv[1]))
    # per segment, with the pooled out-of-fold scores (segments alone are too small to train on)
    p = np.mean(probs, 0)
    pos = {r: n for n, r in enumerate(real_idx)}
    seg_of = [set(pop.segments_of(d)) for d in decoys]
    out["segments"] = {}
    for s, idx in sorted(pop.segment.items()):
        rows = [pos[int(i)] for i in idx] + [len(real_idx) + n for n, ss in enumerate(seg_of) if s in ss]
        if y[rows].min() != y[rows].max():
            out["segments"][s] = {"auc": float(roc_auc_score(y[rows], p[rows])), "n": len(rows)}
    # honeyword test: decoy plus k-1 real rows from its segment; how often is the decoy the most decoy-like?
    k, hits, groups = cfg["honeyK"], 0, 0
    for n, ss in enumerate(seg_of):
        for s in sorted(ss):
            pool = [pos[int(i)] for i in pop.segment[s]]
            pick = rng.choice(pool, size=min(k - 1, len(pool)), replace=False)
            hits += int(p[len(real_idx) + n] > p[pick].max())
            groups += 1
    out["honeyword"] = {"k": k, "groups": groups, "rate": hits / groups if groups else None, "chance": 1 / k}
    out["aucUpper"] = max(out["logistic"]["ci95"][1], out["gradient_boosting"]["ci95"][1])
    # two-sided: an AUC confidently BELOW 0.5 is also a difference (flip the classifier); on tiny segments it
    # is what over-fitting the few real rows looks like
    out["aucLower"] = min(out["logistic"]["ci95"][0], out["gradient_boosting"]["ci95"][0])
    out["gate"] = (
        out["aucUpper"] <= cfg["aucMax"]
        and out["aucLower"] >= 1 - cfg["aucMax"]
        and (groups == 0 or hits / groups <= cfg["honeyMax"])
    )
    return out


def p_first(pop: Population, decoys: list[dict]) -> dict:
    """Closed form: the attacker's first pick is a decoy with probability W_D / (W_R + W_D)."""
    out = {}
    for s in STRATEGIES:
        wd = float(pop.w(s, [pop.score(d)[s] for d in decoys]).sum()) if decoys else 0.0
        out[s] = wd / (pop.Wr[s] + wd)
    return out


def monte_carlo(pop: Population, decoys: list[dict], rng: np.random.Generator) -> dict:
    """Plackett-Luce by Gumbel-top-k: first pick is a decoy, and a decoy is hit within the first probeK picks."""
    runs, k, out = pop.cfg["mcRuns"], pop.cfg["probeK"], {}
    for s in STRATEGIES:
        logw = np.log(np.concatenate([pop.w(s, pop.S[s]), pop.w(s, [pop.score(d)[s] for d in decoys])]))
        is_d = np.arange(len(logw)) >= len(pop.real)
        keys = logw + rng.gumbel(size=(runs, len(logw)))
        top = np.argsort(-keys, axis=1)[:, :k]
        out[s] = {"pFirst": float(is_d[top[:, 0]].mean()), f"pHit@{k}": float(is_d[top].any(1).mean())}
    return out


def _key(pf: dict) -> tuple[float, float]:
    v = list(pf.values())
    return (round(min(v), 12), sum(v) / len(v))  # maximin, then mean as the tie-break


def place(pop: Population, active: list[dict], cands: list[dict], n: int, budget_usd: float, rng) -> list[dict]:
    """Greedy maximin over strategies; each step picks uniformly among the topM best moves (Stackelberg:
    an attacker who knows this code still cannot recompute the set without K)."""
    cfg, chosen = pop.cfg, []
    real_n = {s: len(idx) for s, idx in pop.segment.items()}
    left = [c for c in cands]
    while len(chosen) < n:
        cur = active + chosen
        spent = sum(d["balanceUsd"] for d in cur)
        cnt = {s: sum(s in pop.segments_of(d) for d in cur) for s in pop.segment}

        def ok(c):
            if spent + c["balanceUsd"] > budget_usd:
                return False
            return all((cnt[s] + 1) / (real_n[s] + cnt[s] + 1) <= cfg["rhoMax"] for s in pop.segments_of(c))

        feas = [c for c in left if ok(c)]
        if not feas:
            break
        ranked = sorted(feas, key=lambda c: _key(p_first(pop, cur + [c])), reverse=True)[: cfg["topM"]]
        c = ranked[int(rng.integers(len(ranked)))]
        chosen.append(c)
        left.remove(c)
    return chosen


def contribution(pop: Population, active: list[dict]) -> list[tuple[float, float]]:
    """How much the maximin objective drops when each active decoy is removed (lowest goes first)."""
    full = _key(p_first(pop, active))
    return [
        (full[0] - k[0], full[1] - k[1])
        for k in (_key(p_first(pop, active[:i] + active[i + 1 :])) for i in range(len(active)))
    ]

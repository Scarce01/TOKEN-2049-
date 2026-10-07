"""Decoy generation step 5 and the layered refresh (docs/48_decoy_generation.md).

One call = one epoch: recalibrate on the current real population, burn touched decoys, retire drifted ones,
rotate about 20 % a month, refill the pre-aged pool, promote from it, schedule life traces, commit a new
root with new salts. Randomness is HMAC(K, label || epoch), so the plan is reproducible with K and
unpredictable without it. Every parameter here is source = assumed.
"""

import math

import numpy as np

from commit import build_tree, decoy_leaf, decoy_salt, decoy_tag, hmac_k, next_pow2, u32, user_id_hash
from model import CFG, NOT_MODELED, Population, adversarial, contribution, generate, monte_carlo, p_first, place

LIFE = {
    "target": 8,  # active decoys per org
    "poolTarget": 16,  # pre-aged accounts waiting for promotion
    "generate": 3000,  # raw candidates per epoch; most fail consistency, DCR bounds or the resampling
    "ageEpochs": 2,  # a pool account needs this many epochs of life traces before promotion
    "epochDays": 7,
    "turnoverMonthly": 0.20,
    "budgetUsd": 200_000,  # total balance the active decoys may hold
    "genesis": 1_791_158_400,  # 2026-10-05T00:00:00Z, start of epoch 0
    # datasets/src/gen-withdrawals.ts W (assumed): UTC hour weights and transfer size as a share of balance
    "hourWeight": [6, 8, 10, 10, 9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 3, 2, 2, 2, 2, 3, 3, 4, 5],
    "amountFraction": (math.log(0.08), 0.9),
}
MAX_EPOCH = 0xFFFF  # leaf index i = epoch << 16 | n; decoy-admin uses i < 65536, so epoch >= 1 never collides


def _rng(k: bytes, label: str, epoch: int) -> np.random.Generator:
    return np.random.default_rng(int.from_bytes(hmac_k(k, label, u32(epoch)), "big"))


def epoch_window(epoch: int, life: dict = LIFE) -> tuple[int, int]:
    s = life["genesis"] + epoch * life["epochDays"] * 86400
    return s, s + life["epochDays"] * 86400


def rotate_at(k: bytes, epoch: int, life: dict = LIFE) -> int:
    """When this epoch's promotions and retirements take effect: HMAC(K, "rotate" || epoch), not the boundary."""
    s, e = epoch_window(epoch, life)
    return s + int.from_bytes(hmac_k(k, "rotate", u32(epoch))[:8], "big") % (e - s)


def _identity(rng, org: str, names: list[str], used: set) -> tuple[str, str]:
    """Same shapes as datasets/src/gen-accounts.ts freshUserId / displayName, drawn apart from the features."""
    while True:
        uid = f"u{org}-{int(rng.integers(100_000, 1_000_000))}"
        if uid not in used:
            used.add(uid)
            return uid, f"{names[int(rng.integers(len(names)))]}-{int(rng.integers(1000, 10_000))}"


def _life_traces(rec: dict, rng, start: int, life: dict) -> list[dict]:
    """Logins and inbound deposits only: decoys never send funds out (decoy-admin life rule)."""
    a, days, w = rec["account"], life["epochDays"], np.array(life["hourWeight"], float)
    out = []

    def when():
        return start + int(rng.integers(days)) * 86400 + int(rng.choice(24, p=w / w.sum())) * 3600 + int(rng.integers(3600))

    for _ in range(int(rng.poisson(a["activity"] * days / 7))):
        out.append({"userId": a["userId"], "kind": "login", "t": when()})
    mu, sd = life["amountFraction"]
    for _ in range(int(rng.poisson(a["depFreq"] * days / 30))):
        usd = round(min(a["balanceUsd"], a["balanceUsd"] * float(rng.lognormal(mu, sd))), 2)
        out.append({"userId": a["userId"], "kind": "deposit", "t": when(), "usd": usd})
    return out


def run_epoch(
    state: dict | None,
    real: list[dict],
    k: bytes,
    org: str,
    chain_id: int,
    epoch: int,
    org_salt: bytes,
    taken_ids: set,
    burned: set = frozenset(),
    manual: set = frozenset(),
    life: dict = LIFE,
    cfg: dict = CFG,
) -> tuple[dict, dict, dict, dict]:
    """burned: tags touched since the last epoch (43 F4); manual: tags the operator retired.
    Returns (state, plan, feed entry, public report). plan and state are secret (secrets/decoygen);
    the feed entry holds tags and counts only (defender UI); the report holds statistics only."""
    if not 1 <= epoch <= MAX_EPOCH:
        raise ValueError(f"epoch must be in 1..{MAX_EPOCH}")
    state = state or {"org": org, "epoch": 0, "active": [], "pool": [], "retired": [], "usedIds": []}
    if epoch <= state["epoch"]:
        raise ValueError(f"epoch {epoch} already planned (state is at {state['epoch']})")
    pop = Population(real, cfg)
    rng, start = _rng(k, "decoy-gen", epoch), epoch_window(epoch, life)[0]
    t_rot = rotate_at(k, epoch, life)
    events, active, pool = [], list(state["active"]), list(state["pool"])

    def retire(rec, reason, t):
        events.append({"t": t, "kind": "burn" if reason == "burned" else "retire", "tag": rec["tag"], "reason": reason})
        state["retired"].append({"tag": rec["tag"], "epoch": epoch, "reason": reason})

    # 1. burned (touched, 43 F4): out at once and never reused; 2. drift after recalibration
    for rec in [r for r in active if r["tag"] in burned]:
        active.remove(rec)
        retire(rec, "burned", start)
    for group in (active, pool):  # operator pulled it from the inventory
        for rec in [r for r in group if r["tag"] in manual]:
            group.remove(rec)
            retire(rec, "manual", start)
    for group in (active, pool):
        for rec in [r for r in group if not pop.admissible(r["account"])]:
            group.remove(rec)
            retire(rec, "drift", t_rot)
    # 3. planned rotation, about turnoverMonthly a month, lowest contribution first
    x = len(active) * life["turnoverMonthly"] * life["epochDays"] / 30
    n_rot = min(len(active), math.floor(x) + int(rng.random() < x - math.floor(x)))
    if n_rot:
        contrib = contribution(pop, [r["account"] for r in active])
        order = sorted(range(len(active)), key=lambda i: (contrib[i], active[i]["tag"]))
        for rec in [active[i] for i in order[:n_rot]]:
            active.remove(rec)
            retire(rec, "rotated", t_rot)

    # 4. generate, validate, refill the pool
    fresh = generate(pop, rng, life["generate"])
    gate = adversarial(pop, fresh + [r["account"] for r in active + pool], int(rng.integers(2**62)))
    used = set(taken_ids) | set(state["usedIds"])
    names = sorted({a["displayName"].rsplit("-", 1)[0] for a in real})
    id_rng = _rng(k, "decoy-id", epoch)
    if gate["gate"]:
        for c in fresh[: max(0, life["poolTarget"] - len(pool))]:
            uid, name = _identity(id_rng, org, names, used)
            acct = {"org": org, "userId": uid, "displayName": name, **c}
            ident = user_id_hash(org_salt, uid)
            rec = {"account": acct, "ident": "0x" + ident.hex(), "tag": "0x" + decoy_tag(k, "acct", ident).hex(), "born": epoch}
            pool.append(rec)
            events.append({"t": start, "kind": "generate", "tag": rec["tag"], "segments": pop.segments_of(acct)})
    else:
        events.append({"t": start, "kind": "gate-fail", "aucUpper": gate.get("aucUpper"), "reason": gate.get("reason", "auc or honeyword")})

    # 5. promote from the mature pool; the first epoch has nothing mature, so it promotes fresh (marked)
    bootstrap = not active and not any(epoch - r["born"] >= life["ageEpochs"] for r in pool)
    mature = [r for r in pool if bootstrap or epoch - r["born"] >= life["ageEpochs"]]
    if gate["gate"] and mature:
        picked = place(pop, [r["account"] for r in active], [r["account"] for r in mature], life["target"] - len(active), life["budgetUsd"], rng)
        for acct in picked:
            rec = next(r for r in mature if r["account"] is acct)
            pool.remove(rec)
            active.append({**rec, "promoted": epoch, "preAged": not bootstrap})
            events.append({"t": t_rot, "kind": "promote", "tag": rec["tag"], "segments": pop.segments_of(acct)})

    # 6. commit: new salts every epoch (i = epoch << 16 | n), filler leaves hide the count
    active.sort(key=lambda r: r["tag"])
    size = max(16, next_pow2(len(active)))
    leaves = [decoy_leaf(chain_id, bytes.fromhex(r["ident"][2:]), decoy_salt(k, epoch << 16 | n)) for n, r in enumerate(active)]
    leaves += [hmac_k(k, "decoy-filler", u32(epoch), u32(j)) for j in range(len(leaves), size)]
    root, proofs = build_tree(leaves)
    for n, r in enumerate(active):
        r["commit"] = {"i": epoch << 16 | n, "path": ["0x" + p.hex() for p in proofs[n]]}

    # 7. life traces for everything visible in the backend (active and pool)
    trace_rng = _rng(k, "decoy-life", epoch)
    traces = sorted((t for r in active + pool for t in _life_traces(r, trace_rng, start, life)), key=lambda t: (t["t"], t["userId"]))

    decoys = [r["account"] for r in active]
    pf, mc = p_first(pop, decoys), monte_carlo(pop, decoys, _rng(k, "decoy-mc", epoch))
    state.update(epoch=epoch, active=active, pool=pool, usedIds=sorted(used))
    events.sort(key=lambda e: (e["t"], e["kind"], e.get("tag", "")))
    root_hex = "0x" + root.hex()
    plan = {
        "org": org, "epoch": epoch, "chainId": chain_id, "window": epoch_window(epoch, life), "rotateAt": t_rot,
        "root": root_hex, "leafCount": size, "bootstrap": bootstrap,
        "active": active, "pool": pool, "lifeTraces": traces, "gate": gate, "pFirst": pf, "monteCarlo": mc, "source": "assumed",
    }
    feed = {
        "epoch": epoch, "window": epoch_window(epoch, life), "rotateAt": t_rot, "root": root_hex, "leafCount": size,
        "funnel": {"generated": life["generate"], "accepted": len(fresh)},
        "gate": {"pass": gate["gate"], "aucUpper": gate.get("aucUpper"), "aucLower": gate.get("aucLower"), "honeyword": gate.get("honeyword", {}).get("rate")},
        "active": [{"tag": r["tag"], "segments": pop.segments_of(r["account"])} for r in active],
        "pool": [{"tag": r["tag"], "born": r["born"]} for r in pool],
        "pFirst": pf, "events": events, "source": "assumed",
    }
    retired_now = sum(e["kind"] in ("retire", "burn") for e in events)
    report = {
        "org": org, "epoch": epoch, "source": "assumed",
        "acceptRate": len(fresh) / life["generate"],
        "adversarial": {k2: gate[k2] for k2 in ("logistic", "gradient_boosting", "aucUpper", "aucLower", "importance", "folds") if k2 in gate}
        | {"segments": {s: v["auc"] for s, v in gate.get("segments", {}).items()}, "honeyword": {x: gate.get("honeyword", {}).get(x) for x in ("k", "rate", "chance")}},
        "gate": gate["gate"], "pFirst": pf, "monteCarlo": mc,
        "turnover": retired_now / max(1, len(active) + retired_now),
        "notModeled": NOT_MODELED,
    }
    return state, plan, feed, report

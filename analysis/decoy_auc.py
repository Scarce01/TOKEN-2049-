"""Decoy indistinguishability (35_phase5.md 5.6, proposal 6 B, D28).

Train classifiers to tell decoy accounts from real ones using what an attacker could see in the
backend: registration age, activity, deposit/withdraw frequency, KYC level, balance percentile, has a key,
on-chain deposit exists. Target: AUC upper bound <= 0.65.

Labels come from secrets/decoys.local.json, so this runs LOCALLY ONLY and its output is not committed
(analysis/out is gitignored). source = assumed (synthetic accounts).
Usage: python analysis/decoy_auc.py --org a
"""

import argparse
import json
import os

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.metrics import roc_auc_score

ROOT = os.path.join(os.path.dirname(__file__), "..")


def load(org, top=None):
    accounts = json.load(open(os.path.join(ROOT, "datasets", "out", f"all-accounts-{org}.json"), encoding="utf-8"))
    decoys = json.load(open(os.path.join(ROOT, "secrets", "decoys.local.json"), encoding="utf-8"))
    ids = {a["userId"] for a in decoys.get(org, {}).get("accounts", [])}
    bal = np.array([a["balanceUsd"] for a in accounts])
    pct = bal.argsort().argsort() / (len(bal) - 1)
    X = np.array(
        [
            [a["regDays"], a["activity"], a["depFreq"], a["wdFreq"], a["kycLevel"], pct[i], 1.0, 1.0]
            for i, a in enumerate(accounts)
        ]
    )
    X[:, :4] = np.log1p(X[:, :4])
    y = np.array([a["userId"] in ids for a in accounts], dtype=int)
    if top:
        keep = np.argsort(-bal)[:top]  # the attacker's candidate set: the top-N accounts by balance
        return X[keep], y[keep]
    return X, y


def bootstrap_auc(y, p, rng, n=1000):
    out = []
    for _ in range(n):
        idx = rng.integers(0, len(y), len(y))
        if y[idx].min() == y[idx].max():
            continue
        out.append(roc_auc_score(y[idx], p[idx]))
    return float(np.percentile(out, 2.5)), float(np.percentile(out, 97.5))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--org", default="a")
    ap.add_argument("--top", type=int, default=0, help="evaluate within the top-N accounts by balance")
    a = ap.parse_args()
    X, y = load(a.org, a.top or None)
    if y.sum() < 2:
        raise SystemExit("need decoy labels: run decoy-admin accounts first")
    rng = np.random.default_rng(2049)
    folds = min(5, int(y.sum()))
    cv = StratifiedKFold(n_splits=folds, shuffle=True, random_state=2049)
    out = {"org": a.org, "top": a.top or "all", "n": int(len(y)), "decoys": int(y.sum()), "folds": folds, "source": "assumed"}
    for name, model in [
        ("logistic", LogisticRegression(max_iter=1000)),
        ("gradient_boosting", GradientBoostingClassifier(random_state=2049)),
    ]:
        p = cross_val_predict(model, X, y, cv=cv, method="predict_proba")[:, 1]
        auc = roc_auc_score(y, p)
        lo, hi = bootstrap_auc(y, p, rng)
        out[name] = {"auc": auc, "ci95": [lo, hi]}
    out["auc_upper_bound"] = max(out["logistic"]["ci95"][1], out["gradient_boosting"]["ci95"][1])
    out["target_le_0_65"] = out["auc_upper_bound"] <= 0.65
    os.makedirs(os.path.join(ROOT, "analysis", "out"), exist_ok=True)
    with open(os.path.join(ROOT, "analysis", "out", f"decoy_auc_{a.org}_{a.top or 'all'}.json"), "w") as f:
        json.dump(out, f, indent=2)
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()

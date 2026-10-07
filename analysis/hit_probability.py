"""Decoy hit probability (35_phase5.md 5.5, proposal 6 A, D39).

Model 2: attacker probes k of the top-m accounts uniformly; d decoys among them.
    P_hit = 1 - C(m-d, k) / C(m, k)
Model 3: attacker picks by balance weight; p = W_D / (W_R + W_D), P_hit ~ 1 - (1 - p)^k.

D39: formula vs 100,000-run Monte Carlo must agree within 1 percentage point.
Every number here is source=assumed (formula and simulation, not measured).

Usage: python analysis/hit_probability.py [--out analysis/out]
"""

import argparse
import csv
import json
import os
from math import comb

import numpy as np


def p_hit_uniform(m: int, d: int, k: int) -> float:
    if k > m:
        return 1.0
    return 1.0 - comb(m - d, k) / comb(m, k)


def p_hit_weighted(w_decoy: float, w_real: float, k: int) -> float:
    p = w_decoy / (w_decoy + w_real)
    return 1.0 - (1.0 - p) ** k


def mc_uniform(m: int, d: int, k: int, runs: int, rng: np.random.Generator) -> float:
    hits = 0
    for _ in range(runs):
        picks = rng.choice(m, size=k, replace=False)
        hits += bool((picks < d).any())  # decoys are indices 0..d-1
    return hits / runs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "out"))
    ap.add_argument("--runs", type=int, default=100_000)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rng = np.random.default_rng(2049)

    # proposal example: m = 200, d = 10, k = 20 -> about 66 %
    m, d, k = 200, 10, 20
    formula = p_hit_uniform(m, d, k)
    mc = mc_uniform(m, d, k, a.runs, rng)
    check = {
        "m": m,
        "d": d,
        "k": k,
        "formula": formula,
        "monte_carlo": mc,
        "runs": a.runs,
        "abs_diff_pp": abs(formula - mc) * 100,
        "D39_pass": abs(formula - mc) < 0.01,
        "source": "assumed",
    }

    rows = []
    for dd in (5, 10, 20):
        for kk in range(1, 61):
            rows.append({"m": m, "d": dd, "k": kk, "p_hit": p_hit_uniform(m, dd, kk)})
    with open(os.path.join(a.out, "hit_probability.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["m", "d", "k", "p_hit"])
        w.writeheader()
        w.writerows(rows)

    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots(figsize=(7, 4))
        for dd in (5, 10, 20):
            ks = [r["k"] for r in rows if r["d"] == dd]
            ps = [r["p_hit"] for r in rows if r["d"] == dd]
            ax.plot(ks, ps, label=f"d = {dd} decoys in top {m}")
        ax.set_xlabel("accounts probed by the attacker (k)")
        ax.set_ylabel("P(touch at least one decoy)")
        ax.set_title("Decoy hit probability (formula; source: assumed)")
        ax.grid(alpha=0.3)
        ax.legend()
        fig.tight_layout()
        fig.savefig(os.path.join(a.out, "hit_probability.png"), dpi=150)
    except Exception as e:  # plotting is optional
        check["plot_error"] = str(e)

    with open(os.path.join(a.out, "hit_probability.json"), "w") as f:
        json.dump(check, f, indent=2)
    print(json.dumps(check, indent=2))


if __name__ == "__main__":
    main()

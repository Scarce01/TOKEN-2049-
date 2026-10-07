"""Attacker strategy simulation (41_evaluation.md section 3; D39, D52).

Strategies (>= 1,000 runs each):
  1 random     : probe accounts uniformly at random among the top m
  2 whale-first: probe in descending balance order (decoys are sampled from the top-50 distribution)
  4 careful    : skip wallets without life traces and probe each candidate with a tiny transfer first;
                 decoy accounts look identical, so only decoy *wallets* without life traces are avoided

Outputs: probes before the first decoy touch, hit rate within k probes. source = assumed (synthetic).
Usage: python analysis/adversary_sim.py [--runs 2000] [--k 20]
"""

import argparse
import json
import os

import numpy as np

from hit_probability import p_hit_uniform


def population(rng, n_real=190, n_decoy=10):
    """Balances: lognormal; decoys drawn from the top-50 real accounts with +-25 % jitter."""
    real = rng.lognormal(np.log(400), 1.4, n_real)
    top = np.sort(real)[-50:]
    decoy = rng.choice(top, n_decoy) * rng.uniform(0.75, 1.25, n_decoy)
    bal = np.concatenate([real, decoy])
    is_decoy = np.concatenate([np.zeros(n_real, bool), np.ones(n_decoy, bool)])
    return bal, is_decoy


def first_hit(order, is_decoy, k):
    for i, idx in enumerate(order[:k]):
        if is_decoy[idx]:
            return i + 1
    return None


def run(strategy, runs, k, seed):
    rng = np.random.default_rng(seed)
    firsts, hits = [], 0
    for _ in range(runs):
        bal, dec = population(rng)
        n = len(bal)
        if strategy == 1:
            order = rng.permutation(n)
        elif strategy == 2:
            order = np.argsort(-bal)
        else:
            # careful: whale-first but drops 30 % of candidates at random after a small test transfer
            # (life traces make decoy accounts indistinguishable, so the drop is blind)
            order = [i for i in np.argsort(-bal) if rng.random() > 0.3]
        fh = first_hit(order, dec, k)
        if fh is not None:
            hits += 1
            firsts.append(fh)
    return {
        "strategy": strategy,
        "runs": runs,
        "k": k,
        "hit_rate": hits / runs,
        "mean_probes_before_first_hit": float(np.mean(firsts)) if firsts else None,
        "source": "assumed",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=2000)
    ap.add_argument("--k", type=int, default=20)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "out"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    res = [run(s, a.runs, a.k, 2049 + s) for s in (1, 2, 4)]
    # strategy 1 vs the uniform formula over the whole population (m = 200, d = 10)
    formula = p_hit_uniform(200, 10, a.k)
    res[0]["formula"] = formula
    res[0]["abs_diff_pp"] = abs(res[0]["hit_rate"] - formula) * 100
    with open(os.path.join(a.out, "adversary_sim.json"), "w") as f:
        json.dump(res, f, indent=2)
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()

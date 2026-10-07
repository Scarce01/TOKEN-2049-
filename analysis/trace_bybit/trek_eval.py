"""Trek evaluation on the cached Bybit data (offline, no network).
    python trek_eval.py
1. Haircut vs FIFO on the same edges (plain models, no swap awareness).
2. Small-split floor: how many addresses are flagged with a per-edge floor versus a cumulative floor.
3. Dwell time: how long tainted funds sit at an address before moving on. This is the window Trek has to act.
"""

import json
import statistics
from pathlib import Path

import bench
from run import load
from score import score
from trace_core import propagate
from trace_fifo import propagate_fifo

HOPS, TAU = 4, 500_000
OUT = Path(__file__).parent / "results"


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * p))] if xs else None


def main():
    cfg, fbi, seed_sets = load()
    seeds = seed_sets["A"]
    cfg2 = dict(cfg, min_edge_wei=str(10**16))  # 0.01 ETH-eq, ten times lower: keeps small splits
    res = {}

    # ---- 1. haircut vs FIFO (per-edge floor 0.1 ETH-eq as in the published results)
    edges, fetched, senders = bench.cached_universe(cfg)
    cls = bench.cached_classifier(cfg, senders, True)
    hair = propagate(edges, seeds, HOPS, TAU, cls, swap_aware=False).as_json()["nodes"]
    fifo = propagate_fifo(edges, seeds, HOPS, TAU, cls).as_json()["nodes"]
    full = propagate(edges, seeds, HOPS, TAU, cls, swap_aware=True).as_json()["nodes"]
    res["cached"] = {"addresses": len(fetched), "edges": len(edges)}
    res["models"] = {}
    for name, nodes in (("haircut (plain)", hair), ("FIFO (plain)", fifo), ("haircut + swap (current)", full)):
        row = {}
        for k in (1, 2, 3, 4):
            sc = score(nodes, fbi, seeds, k, TAU)
            row[f"k{k}"] = {"found": len(sc["found_fbi"]), "of": sc["recall_denominator"], "flagged": sc["flagged"]}
        res["models"][name] = row
    only_h = {a for a, n in hair.items() if n["hop"] >= 1} - {a for a, n in fifo.items() if n["hop"] >= 1}
    only_f = {a for a, n in fifo.items() if n["hop"] >= 1} - {a for a, n in hair.items() if n["hop"] >= 1}
    res["overlap"] = {"haircut_only": len(only_h), "fifo_only": len(only_f), "haircut_only_on_fbi": len(only_h & set(fbi)), "fifo_only_on_fbi": len(only_f & set(fbi))}

    # ---- 2. small-split floor
    edges_lo, fetched_lo, senders_lo = bench.cached_universe(cfg2)
    cls_lo = bench.cached_classifier(cfg2, senders_lo, True)
    lo = propagate(edges_lo, seeds, HOPS, TAU, cls_lo, swap_aware=True).as_json()["nodes"]
    floor = 10**17
    res["floor"] = {"edges_at_0.1": len(edges), "edges_at_0.01": len(edges_lo)}
    for label, nodes, mt in (("per-edge floor 0.1 (published)", full, 0), ("edges >= 0.01, cumulative floor 0.1", lo, floor), ("edges >= 0.01, no floor", lo, 0)):
        sc = score(nodes, fbi, seeds, HOPS, TAU, min_tainted=mt)
        res["floor"][label] = {"flagged": sc["flagged"], "found_fbi": len(sc["found_fbi"]), "of": sc["recall_denominator"]}

    # ---- 3. dwell time on the full model
    by_src = {}
    for e in edges:
        by_src.setdefault(e.frm, []).append(e)
    for v in by_src.values():
        v.sort(key=lambda e: (e.ts, e.block))
    dwell, parked, per_hop = [], 0, {}
    for a, n in full.items():
        # only addresses whose own transfers were fetched: an unfetched address has no outflow rows, not "no outflow"
        if a not in fetched or n["hop"] < 1 or n["breakpoint"] or n["taint_ppm"] < TAU or not n["first_tainted_ts"]:
            continue
        t0 = n["first_tainted_ts"]
        nxt = next((e.ts for e in by_src.get(a, []) if e.ts >= t0), None)
        if nxt is None:
            parked += 1
            continue
        dwell.append(nxt - t0)
        per_hop.setdefault(n["hop"], []).append(nxt - t0)
    res["dwell"] = {
        "tainted_addresses_fetched": len(dwell) + parked, "forwarded": len(dwell), "parked_in_window": parked,
        "seconds_p10_median_p90": [pct(dwell, 0.1), statistics.median(dwell) if dwell else None, pct(dwell, 0.9)],
        "share_forwarded_within": {f"{s}s": round(100 * sum(1 for d in dwell if d <= s) / len(dwell), 1) for s in (12, 60, 600, 3600)},
        "median_by_hop_seconds": {h: statistics.median(v) for h, v in sorted(per_hop.items())},
        "count_by_hop": {h: len(v) for h, v in sorted(per_hop.items())},
        "share_forwarded_within_hop2plus": {f"{s}s": round(100 * sum(1 for h, v in per_hop.items() if h >= 2 for d in v if d <= s) / max(1, sum(len(v) for h, v in per_hop.items() if h >= 2)), 1) for s in (12, 60, 600, 3600)},
    }
    # time for tainted funds to first reach an address classified as a service
    ts0 = cfg["attack_ts"]
    reach = sorted((n["first_tainted_ts"] - ts0) // 60 for a, n in full.items() if n["breakpoint"] and n["first_tainted_ts"])
    res["first_reach_of_a_breakpoint_minutes"] = {"count": len(reach), "earliest": reach[0] if reach else None, "median": statistics.median(reach) if reach else None}
    OUT.mkdir(exist_ok=True)
    (OUT / "trek_eval.json").write_text(json.dumps(res, indent=1, sort_keys=True))
    print(json.dumps(res, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()

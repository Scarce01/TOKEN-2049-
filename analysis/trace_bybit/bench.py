"""Benchmark tracing models on the same cached data (no network). Snapshot of whatever is cached now.
    python bench.py [--seeds A|B] [--hops 4]
V0 naive BFS: anything a tainted address sends after being tainted is tainted (no amounts).
V1 haircut: proportional taint (the original model).
V2 haircut + swap awareness + service breakpoints (current model).
"""

import argparse
import json
from pathlib import Path

from classify import load_labels
import etherscan
from etherscan import edges_from_raw
from run import load
from score import score
from trace_core import propagate

PPM = 1_000_000


def cached_universe(cfg):
    edges, fetched, senders = {}, set(), {}
    for f in sorted(etherscan.CACHE.glob("*.json")):
        try:
            d = json.loads(f.read_text())
        except Exception:
            continue  # being written right now
        name = d["name"]
        if not (name.startswith("node:") or name.startswith("node2:")):
            continue
        a = name.split(":")[1]
        fetched.add(a)
        for e in edges_from_raw(d["v"], cfg):
            if e.value >= int(cfg["min_edge_wei"]):
                edges[e.key()] = e
                if e.to == a:
                    senders.setdefault(a, set()).add(e.frm)
    return list(edges.values()), fetched, senders


def cached_classifier(cfg, senders, use_services):
    code, names = {}, {}
    for f in etherscan.CACHE.glob("*.json"):
        try:
            d = json.loads(f.read_text())
        except Exception:
            continue
        if d["name"].startswith("code-latest:"):
            code[d["name"].split(":")[1]] = etherscan.has_contract_code(d["v"])
        elif d["name"].startswith("src:"):
            names[d["name"].split(":")[1]] = d["v"]
    labels = load_labels()

    def classify(a):
        if a in labels:
            return {"type": labels[a]["type"]}
        if use_services and len(senders.get(a, ())) >= cfg["service_min_senders"]:
            return {"type": "service (many senders)"}
        if code.get(a):
            return {"type": "contract"}
        return None

    return classify


def naive_bfs(edges, seeds, hops):
    """Temporal reachability: a node passes taint on only after it first received tainted funds."""
    first = {s: (-1, 0) for s in seeds}  # addr -> (block of first taint, hop)
    for e in sorted(edges, key=lambda e: (e.block, e.txhash, e.frm, e.to)):
        if e.frm in first and first[e.frm][0] <= e.block and first[e.frm][1] < hops and e.to not in first:
            first[e.to] = (e.block, first[e.frm][1] + 1)
    return {a: {"hop": h, "taint_ppm": PPM} for a, (_, h) in first.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", choices=["A", "B"], default="A")
    ap.add_argument("--case", default=None)
    ap.add_argument("--hops", type=int, default=4)
    ap.add_argument("--tau", type=int, default=500000)
    args = ap.parse_args()
    cfg, fbi, seed_sets = load(args.case)
    seeds = seed_sets[args.seeds]
    edges, fetched, senders = cached_universe(cfg)
    print(f"cached: {len(fetched)} addresses, {len(edges)} edges (>= 0.1 ETH-eq); seeds {args.seeds}; tau {args.tau / 1e4:.0f}%\n")
    variants = {
        "V0 naive BFS": naive_bfs(edges, seeds, args.hops),
        "V1 haircut": propagate(edges, seeds, args.hops, args.tau, cached_classifier(cfg, senders, False), swap_aware=False).as_json()["nodes"],
        "V2 haircut+swap+services": propagate(edges, seeds, args.hops, args.tau, cached_classifier(cfg, senders, True), swap_aware=True).as_json()["nodes"],
    }
    print(f"{'model':26} {'hop':>3} {'FBI found':>10} {'recall':>7} {'flagged':>8} {'precision>=':>11}")
    out = {}
    for name, nodes in variants.items():
        out[name] = {}
        for k in range(1, args.hops + 1):
            sc = score(nodes, fbi, seeds, k, args.tau)
            out[name][k] = sc
            print(f"{name:26} {k:>3} {len(sc['found_fbi']):>4}/{sc['recall_denominator']:<5} {sc['recall_pct']:>6}% {sc['flagged']:>8} {str(sc['precision_lower_bound_pct']) + '%':>11}")
        # Ranking quality: order flagged non-seed addresses by tainted amount (what an analyst looks at first).
        ranked = sorted(
            ((int(n.get("tainted_in", 0)), a) for a, n in nodes.items() if a not in set(seeds) and n["hop"] <= args.hops and n["taint_ppm"] >= args.tau and not n.get("breakpoint")),
            reverse=True,
        )
        if ranked and ranked[0][0] > 0:
            fb = set(fbi)
            row = {f"top{n}": sum(1 for _, a in ranked[:n] if a in fb) for n in (51, 100, 200)}
            out[name]["ranking"] = row
            print(f"{'':26} ranked by tainted amount: FBI in top 51 = {row['top51']}, top 100 = {row['top100']}, top 200 = {row['top200']}")
        print()
    Path("results").mkdir(exist_ok=True)
    Path(f"results/{args.case + '_' if args.case else ''}bench_{args.seeds}.json").write_text(json.dumps({"fetched": len(fetched), "edges": len(edges), "tau": args.tau, "variants": out}, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()

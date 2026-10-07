"""Bybit tracing backtest. Usage:
    python run.py fetch [--seeds A|B]      network: pull data level by level into the cache
    python run.py score [--seeds A|B]      offline: propagate + score from the cache, write results/
Set TRACE_OFFLINE=1 to make any cache miss an error (used by the determinism check).
"""

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import etherscan
from classify import make_classifier
from score import score
from trace_core import propagate

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
OUT = HERE / "results"


def load(case=None):
    """case None = Bybit (config.json, FBI list, seed sets A and B). Otherwise cases/<case>.json."""
    if case:
        cfg = json.loads((HERE / "cases" / f"{case}.json").read_text())
        cfg["min_edge_wei"] = cfg["min_edge"]
        etherscan.CACHE = HERE.parent / "out" / f"trace_{case}" / "cache"
        truth = [a.lower() for a in cfg["truth"]]
        return cfg, truth, {"A": [a.lower() for a in cfg["seeds"]]}
    cfg = json.loads((HERE / "config.json").read_text())
    pub = json.loads((ROOT / "datasets/public/public_sources.json").read_text())
    fbi = [a.lower() for a in pub["fbi_bybit"]["addresses"]]
    assert len(fbi) == 51 and len(set(fbi)) == 51, "FBI list must be exactly 51 unique addresses"
    seeds = {"A": [a.lower() for a in cfg["seeds"]["A"]], "B": [a.lower() for a in pub["bybit"]["seed_addresses"]]}
    return cfg, fbi, seeds


def count_senders(edges, addr, min_value):
    """Distinct senders of at least min_value into addr. Dust (address poisoning) must not count: attacker
    wallets receive many tiny transfers and would be mistaken for exchanges."""
    return len({e.frm for e in edges if e.to == addr and e.value >= min_value})


def edges_for(addrs, cfg, state):
    es = []
    for a in sorted(addrs):
        raw = etherscan.fetch_node(a, cfg)
        if raw.get("truncated"):
            state["truncated"].add(a)
        mine = etherscan.edges_from_raw(raw, cfg)
        n_senders = count_senders(mine, a, int(cfg["min_edge_wei"]))
        if n_senders >= cfg["service_min_senders"]:
            state["services"][a] = n_senders
        es += mine
        state["fetched"].add(a)
    return [e for e in es if e.value >= int(cfg["min_edge_wei"])]


def run_levels(cfg, seeds, tau_ppm, fetch, extra_edges=(), drop=None):
    """Level-by-level expansion. With fetch=False every address must already be in the cache.
    extra_edges: synthetic edges (cross-chain, from '<chain>:<addr>' nodes that are never fetched).
    drop(edge): edges to leave out (the bridge contract's own payout that a cross-chain edge replaces)."""
    state = {"fetched": set(), "truncated": set(), "services": {}, "expanded": set()}
    edges = {e.key(): e for e in extra_edges}
    frontier = sorted(seeds)
    for level in range(cfg["hops"] + 1):
        frontier = [a for a in frontier if a not in state["fetched"] and ":" not in a]
        for e in edges_for(frontier, cfg, state):
            if not (drop and drop(e)):
                edges[e.key()] = e
        base_classify = make_classifier(cfg, state["truncated"], state["services"])
        classify = lambda a, f=base_classify: None if ":" in a else f(a)  # noqa: E731
        res = propagate(list(edges.values()), seeds, hops=min(level + 1, cfg["hops"]), tau_ppm=tau_ppm, classify=classify)
        # Swap transactions: read the whole tx so an output paid to a fresh wallet is visible.
        if cfg.get("expand_swaps", True):
            todo = {}
            for e in edges.values():
                n = res.nodes.get(e.frm)
                if n and e.frm in state["fetched"] and not n.breakpoint and n.tainted_in > 0 and n.hop < cfg["hops"]:
                    base = e.txhash.split(":", 1)[0]
                    if base not in state["expanded"] and etherscan.is_contract(e.to, cfg["end_block"]):
                        todo[base] = max(todo.get(base, 0), e.value)
            picked = sorted(todo, key=lambda b: (-todo[b], b))[: cfg.get("max_tx_expand_per_level", 400)]
            for b in sorted(picked):
                for e in etherscan.edges_from_raw(etherscan.tx_transfers(b, cfg), cfg):
                    if e.value >= int(cfg["min_edge_wei"]) and not (drop and drop(e)):
                        edges[e.key()] = e
                state["expanded"].add(b)
            if picked:
                print(f"  level {level}: expanded {len(picked)} swap transactions", file=sys.stderr)
                res = propagate(list(edges.values()), seeds, hops=min(level + 1, cfg["hops"]), tau_ppm=tau_ppm, classify=classify)
        cands = sorted(((n.tainted_in, a) for a, n in res.nodes.items() if n.hop == level + 1 and n.breakpoint is None and a not in state["fetched"]), reverse=True)
        frontier = []
        for _, a in cands:  # classify before fetching: never page through a DEX router or an exchange
            if len(frontier) >= cfg["max_fetch_per_level"]:
                break
            if classify(a) is None:
                frontier.append(a)
        if len(cands) > len(frontier):
            print(f"  level {level + 1}: {len(cands)} candidates, fetching top {len(frontier)} by tainted amount", file=sys.stderr)
        frontier.sort()
        print(f"  level {level}: edges={len(edges)} nodes={len(res.nodes)} next={len(frontier)}", file=sys.stderr)
    return list(edges.values()), state


def evaluate(cfg, fbi, seeds, seeds_set, edges, state):
    """Propagate over the fetched edges and score against the truth list (offline)."""
    base_classify = make_classifier(cfg, state["truncated"], state["services"])

    def classify(a):
        if ":" in a:  # cross-chain source node: never a breakpoint
            return None
        try:
            return base_classify(a)
        except RuntimeError:  # offline cache miss: an address we never fetched, so it never passes taint on
            return None

    out = {
        "seeds_set": seeds_set,
        "seeds": seeds,
        "seeds_on_fbi": sorted(set(seeds) & set(fbi)),
        "window": [cfg["start_block"], cfg["end_block"]],
        "fetched_addresses": len(state["fetched"]),
        "edges": len(edges),
        "by_tau": {},
    }
    al = cfg["attacker_like"]
    fbi_set, seed_set = set(fbi), set(seeds)
    for tau in cfg["tau_sweep_ppm"]:
        res = propagate(edges, seeds, hops=cfg["hops"], tau_ppm=cfg["tau_fetch_ppm"], classify=classify)
        j = res.as_json()
        nodes = j["nodes"]
        tainted = {a for a, n in nodes.items() if n["taint_ppm"] > 0}
        senders = {}
        for e in edges:
            senders.setdefault(e.to, set()).add(e.frm)
        for a, n in nodes.items():
            clean = len(senders.get(a, set()) - tainted)
            if not n["breakpoint"] and a not in seed_set:
                c = classify(a)  # cached when it was a fetch candidate; None otherwise
                if c:
                    n["breakpoint"] = c["type"]
            if n["breakpoint"]:
                n["class"] = "service"
            elif a in seed_set:
                n["class"] = "seed"
            elif a not in state["fetched"]:
                n["class"] = "unknown (not fetched)"
            elif n["taint_ppm"] >= al["min_taint_ppm"] and clean <= al["max_clean_senders"]:
                n["class"] = "attacker-like"
            else:
                n["class"] = "touched"
        fbi_hits = {a: n for a, n in nodes.items() if a in fbi_set and a not in seed_set and n["taint_ppm"] >= tau}
        adv = {a: (n["first_tainted_ts"] - cfg["attack_ts"]) // 60 for a, n in fbi_hits.items() if n["first_tainted_ts"]}
        atk = {a: n for a, n in nodes.items() if n["class"] == "attacker-like"}
        out["by_tau"][str(tau)] = {
            "by_hop": {f"k{k}": score(nodes, fbi, seeds, k, tau) for k in range(1, cfg["hops"] + 1)},
            "attacker_like": {
                "count": len(atk),
                "on_fbi": sum(1 for a in atk if a in fbi_set),
                "precision_lower_bound_pct": round(100 * sum(1 for a in atk if a in fbi_set) / len(atk), 2) if atk else None,
                "fbi_recall_pct": round(100 * sum(1 for a in atk if a in fbi_set) / len(fbi_set - seed_set), 2),
            },
            "class_counts": {c: sum(1 for n in nodes.values() if n["class"] == c) for c in sorted({n["class"] for n in nodes.values()})},
            "breakpoint_totals": {
                t: round(sum(int(n["tainted_in"]) for n in nodes.values() if n["breakpoint"] == t) / (10**6 if cfg.get("prices") else 10**18), 2)
                for t in sorted({n["breakpoint"] for n in nodes.values() if n["breakpoint"]})
            },
            "breakpoint_unit": "USD" if cfg.get("prices") else "ETH",
            "breakpoint_addresses": {t: sum(1 for n in nodes.values() if n["breakpoint"] == t) for t in sorted({n["breakpoint"] for n in nodes.values() if n["breakpoint"]})},
            "fbi_missed": sorted(fbi_set - seed_set - set(fbi_hits)),
            "minutes_after_attack_to_first_taint": adv,
            "nodes": nodes if tau == cfg["tau_default_ppm"] else None,
        }
    # Headline: rank by tainted amount (ratio only as a 10% floor). Same nodes for every tau (expansion is fixed).
    nodes = out["by_tau"][str(cfg["tau_default_ppm"])]["nodes"]
    floor = cfg.get("rank_min_taint_ppm", 100000)
    ranked = sorted(
        ((int(n["tainted_in"]), a) for a, n in nodes.items() if a not in seed_set and n["hop"] <= cfg["hops"] and n["taint_ppm"] >= floor and not n["breakpoint"]),
        reverse=True,
    )
    targets = set(fbi) - seed_set
    T = len(targets)
    hit = lambda k: sum(1 for _, a in ranked[:k] if a in targets)  # noqa: E731
    out["ranking"] = {
        "min_taint_ppm": floor,
        "candidates": len(ranked),
        "truth_size": T,
        "found_anywhere": hit(len(ranked)),
        "recall_pct": round(100 * hit(len(ranked)) / T, 2) if T else None,
        f"hits_in_top_{T}": hit(T),
        "precision_at_truth_size_pct": round(100 * hit(T) / T, 2) if T else None,
        f"hits_in_top_{2 * T}": hit(2 * T),
        "hits_in_top_100": hit(100),
        "missed": sorted(targets - {a for _, a in ranked}),
    }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fetch", "score"])
    ap.add_argument("--seeds", choices=["A", "B"], default="B")
    ap.add_argument("--case", default=None, help="bitget, stake, ... (default: Bybit)")
    args = ap.parse_args()
    if args.cmd == "score":
        os.environ["TRACE_OFFLINE"] = "1"
    cfg, fbi, seed_sets = load(args.case)
    if args.case:
        args.seeds = "A"
    seeds = seed_sets[args.seeds]
    edges, state = run_levels(cfg, seeds, cfg["tau_fetch_ppm"], fetch=args.cmd == "fetch")
    if args.cmd == "fetch":
        print(f"fetched {len(state['fetched'])} addresses, {len(edges)} edges, truncated: {sorted(state['truncated'])}")
        return

    out = evaluate(cfg, fbi, seeds, args.seeds, edges, state)
    OUT.mkdir(exist_ok=True)
    body = json.dumps(out, indent=1, sort_keys=True)
    (OUT / f"{args.case + '_' if args.case else ''}result_{args.seeds}.json").write_text(body)
    print(f"sha256 {hashlib.sha256(body.encode()).hexdigest()}")


if __name__ == "__main__":
    main()

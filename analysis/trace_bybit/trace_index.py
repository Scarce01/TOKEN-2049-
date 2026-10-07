"""Index of traced addresses for the paid trace route (services/trace-market). Offline, from the cache.
Usage: python trace_index.py   writes services/trace-market/data/trace_index.json
results/*.json drop the edge that first tainted each address; this keeps it (parent + evidence tx), so a buyer
can check every link on a block explorer. Public on-chain replay data only (no decoys involved)."""

import json
import os

os.environ["TRACE_OFFLINE"] = "1"

import run  # noqa: E402
from classify import make_classifier  # noqa: E402
from trace_core import propagate  # noqa: E402

OUT = run.ROOT / "services" / "trace-market" / "data" / "trace_index.json"
CASES = {"bybit-2025-02": None, "bitget-2026-09": "bitget", "stake-2023-09": "stake"}


def index(case):
    cfg, _, seed_sets = run.load(case)
    seeds = seed_sets["A"]
    edges, state = run.run_levels(cfg, seeds, cfg["tau_fetch_ppm"], fetch=False)
    base = make_classifier(cfg, state["truncated"], state["services"])

    def classify(a):
        try:
            return base(a)
        except RuntimeError:  # never fetched: passes no taint on
            return None

    res = propagate(edges, seeds, hops=cfg["hops"], tau_ppm=cfg["tau_fetch_ppm"], classify=classify)
    scale = 10**6 if cfg.get("prices") else 10**18
    nodes = {}
    for a, n in sorted(res.nodes.items()):
        if not n.is_seed and n.taint_ppm == 0:
            continue
        v = n.via
        nodes[a] = {
            "hop": n.hop,
            "taintPct": round(n.taint_ppm / 10**4, 1),
            "tainted": round(n.tainted_in / scale, 2),
            "breakpoint": n.breakpoint,
            "from": v[0] if v else None,
            "evidenceTx": v[1].split(":", 1)[0] if v else None,
            "block": v[5] if v else None,
        }
    return {
        "chain": "ethereum-mainnet",
        "unit": "USD" if cfg.get("prices") else "ETH",
        "window": [cfg["start_block"], cfg["end_block"]],
        "seeds": seeds,
        "nodes": nodes,
    }


if __name__ == "__main__":
    out = {"source": "REPLAY: public on-chain transfers, Etherscan cache", "cases": {k: index(c) for k, c in CASES.items()}}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, sort_keys=True, separators=(",", ":")))
    for k, c in out["cases"].items():
        print(k, len(c["nodes"]), "nodes")

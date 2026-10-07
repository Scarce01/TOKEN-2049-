"""Compact replay data for the Observatory's Incident Replay (apps/observatory/src/data/replay.json).

Everything here is public on-chain data or derived from it (source = public on-chain). Run from the repo root:
  python analysis/trace_bybit/export_ui.py
Inputs: analysis/trace_bybit/results/*.json, cases/*.json, config.json, datasets/public/bitget_2026-09.json,
and the spike-rule result (analysis/out/bitget_spike.json, or the 2026-10-07 data package in qu3ee_data/).
"""

import json
import os
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "apps", "observatory", "src", "data", "replay.json")
HIGH = "900000"  # the high-confidence view: at least 90 % of the money traces back to the seed


def load(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as f:
        return json.load(f)


def first(*paths):
    for p in paths:
        if os.path.exists(p):
            return load(p)
    return None


def short(a):
    return f"{a[:6]}…{a[-4:]}"


def case(cid, exchange, when, truth_name, cfg, res, truth, *, eth_only=None, coverage="Ethereum"):
    rk = res["ranking"]
    T = rk["truth_size"]
    hops = [
        {"hop": int(k[1:]), "flagged": v["flagged"], "found": len(v["found_fbi"])}
        for k, v in sorted(res["by_tau"][HIGH]["by_hop"].items(), key=lambda kv: int(kv[0][1:]))
    ]
    full = next((h["hop"] for h in hops if h["found"] == T), None)
    bt = res["by_tau"][HIGH]
    nodes = bt.get("nodes") or {}
    return {
        "id": cid,
        "exchange": exchange,
        "when": when,
        "groundTruth": truth_name,
        "truthSize": T,
        "seeds": len(res["seeds"]),
        "window": res["window"],
        "windowBlocks": res["window"][1] - res["window"][0],
        "discoveryFloorPct": rk["min_taint_ppm"] / 10_000,
        "highViewPct": int(HIGH) / 10_000,
        "recovered": rk["found_anywhere"],
        "topN": rk[f"hits_in_top_{T}"],
        "candidates": rk["candidates"],
        "graph": {"addresses": res["fetched_addresses"], "edges": res["edges"]},
        "hops": hops,
        "fullRecoveryHop": full,
        "highViewHolds": hops[-1]["found"] if hops else 0,
        "coverage": coverage,
        "crossChain": coverage != "Ethereum",
        "ethOnly": eth_only,
        # where the traced money stopped: exchanges, DEX pools, bridge routers (tracing ends there)
        "breakpoints": {
            "unit": bt["breakpoint_unit"],
            "totals": bt["breakpoint_totals"],
            "addresses": bt["breakpoint_addresses"],
        },
        "attackerLike": bt["attacker_like"],
        "classes": bt.get("class_counts", {}),
        "truth": [
            {
                "address": short(a),
                "label": truth.get(a),
                "hop": nodes.get(a, {}).get("hop"),
                "taintPct": round(nodes[a]["taint_ppm"] / 10_000, 1) if a in nodes else None,
                "recovered": a not in rk["missed"],
            }
            for a in sorted(truth, key=lambda x: (nodes.get(x, {}).get("hop", 99), x))
        ],
        "source": "public on-chain",
    }


def main():
    R = os.path.join(HERE, "results")
    pub = load(ROOT, "datasets", "public", "bitget_2026-09.json")
    by_cfg = load(HERE, "config.json")
    stake_cfg, bitget_cfg = load(HERE, "cases", "stake.json"), load(HERE, "cases", "bitget.json")

    bybit = load(R, "result_A.json")
    pub_sources = load(ROOT, "datasets", "public", "public_sources.json")
    bybit_truth = {a.lower(): None for a in pub_sources["fbi_bybit"]["addresses"]}

    stake = load(R, "stake_result_A.json")
    stake_truth = {a.lower(): None for a in stake_cfg["truth"]}
    bitget_eth = load(R, "bitget_result_A.json")
    bitget_x = load(R, "bitget_xchain_result.json")
    labels = {w["address"].lower(): w.get("etherscan_label") for w in pub["attacker_addresses"]}
    bitget_truth = {a.lower(): labels.get(a.lower()) for a in bitget_cfg["truth"]}

    cases = [
        case("bybit-2025-02", "Bybit", "2025-02", "FBI PSA I-022625-PSA", by_cfg, bybit, bybit_truth),
        case("stake-2023-09", "Stake", "2023-09", stake_cfg.get("truth_name", "FBI release, Ethereum addresses"), stake_cfg, stake, stake_truth),
        case(
            "bitget-2026-09",
            "Bitget",
            "2026-09-24",
            bitget_cfg.get("truth_name", "Analyst labels, at least two public sources"),
            bitget_cfg,
            bitget_x,
            bitget_truth,
            eth_only={"recovered": bitget_eth["ranking"]["found_anywhere"], "candidates": bitget_eth["ranking"]["candidates"]},
            coverage="Ethereum, Across, Stargate",
        ),
    ]
    by_id = {c["id"]: c for c in cases}
    for c in cases[2]["truth"]:  # Bitget: also say whether the Ethereum-only replay had it
        full = next(a for a in bitget_truth if short(a) == c["address"])
        c["ethereumOnly"] = full not in bitget_eth["ranking"]["missed"]

    # Bitget network: the bridges the money crossed, by origin chain
    x = bitget_x["xchain"]
    usd = defaultdict(float)
    for e in x["cross_edges"]:
        usd[e["from"].split(":")[0]] += e["usd"]
    by_chain = Counter((l["chain"], l["bridge"]) for l in x["links"])
    by_id["bitget-2026-09"]["network"] = {
        "chains": [
            {
                "chain": ch,
                "reached": len(v.get("reached", {})),
                "skipped": v.get("skipped", "").split(":")[0] if v.get("skipped") else None,
                "bridges": {b: n for (c2, b), n in sorted(by_chain.items()) if c2 == ch},
                "usd": round(usd.get(ch, 0)),
            }
            for ch, v in sorted(x["chains"].items())
        ],
        "links": len(x["links"]),
        "bridgedUsd": round(sum(usd.values())),
    }
    by_id["bitget-2026-09"]["timeline"] = [{"utc": t["utc"], "event": t["event"]} for t in pub["timeline"]]

    # Controls in a replay are "what the rule would have done", never "what was done"
    spike = first(os.path.join(ROOT, "analysis", "out", "bitget_spike.json"),
                  os.path.join(ROOT, "qu3ee_data", "qu3ee_data", "qu3ee_benchmark_data_2026-10-07", "results", "bitget_spike.json"))
    if spike:
        by_id["bitget-2026-09"]["controls"] = {
            "kind": "spike",
            "events": spike["events_utc"],
            "rule": [r for r in spike["results"] if r["spike_max_x_p99"] == 10],
            "note": "Patrol CUSUM spike rule at 10x the pre-hack p99 per minute; false alarms counted on 3.8 days before the hack",
        }
    trek = load(R, "trek_replay.json")["by_cap"].get("50")
    if trek:
        by_id["bybit-2025-02"]["controls"] = {
            "kind": "trek",
            "watchBudget": 50,
            "proposed": trek["fbi_proposed"],
            "of": trek["fbi_of"],
            "stillUnmovedPct": trek["all_delay"]["share_still_unmoved_if_the_flag_takes"],
            "note": "Trek replayed on the Bybit transfers with a watch budget of 50 addresses; classification uses hindsight",
        }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"generated": "2026-10-07", "source": "public on-chain", "cases": cases}, f, indent=1)
    for c in cases:
        print(f"{c['id']}: {c['recovered']}/{c['truthSize']} top {c['topN']}, {c['candidates']} candidates, hops {[(h['flagged'], h['found']) for h in c['hops']]}")
    print(f"wrote {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()

"""DON benchmark: what the deployed workflows actually do on public Base Sepolia (source: testnet, Chainlink DON).

Reads two sides and joins them:
  CRE   executions of each workflow (`cre execution list --json`): status, duration, failure causes
  chain reports the Receivers accepted (their ReportProcessed events): action kinds, cron tick to block time,
        gas, how many DON transmitters sent them
With --trap-trigger-tx (a decoy touch), it also measures decoy touch to the first FREEZE on chain.

Usage (repo root, CRE login via CRE_API_KEY in workflows/.env):
  python3 analysis/don_bench/don_benchmark.py --workflows quorum-patrol [--since 2026-10-07T11:00:00Z]
  python3 analysis/don_bench/don_benchmark.py --workflows quorum-trap --trap-trigger-tx 0x...
Writes reports/don/don_benchmark.json.
"""

import argparse
import collections
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RPC = "https://sepolia.base.org"
KIND = {0: "PING", 1: "VERDICT", 2: "ALERT", 3: "FREEZE", 4: "SWEEP", 5: "QUOTA_ZERO", 6: "COLD_DELAY", 7: "THREAT",
        8: "QUOTA_REFILL", 9: "SCORE", 10: "TOPUP", 11: "THRESHOLD_COMMIT", 12: "THRESHOLD_REVEAL", 13: "PATROL_STATE",
        14: "ASSET_CHECKPOINT"}  # packages/shared/src/constants.ts
RECEIVER_REPORT = "0xc9f3b4e9"  # ReportProcessed(bytes32,bytes) on QuorumReceiver (topic prefix)
FORWARDER_REPORT = "0x3617b009"  # ReportProcessed(address,bytes32,bytes2,bool) on the KeystoneForwarder


def rpc(method, params, tries=6):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for i in range(tries):
        try:
            req = urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json", "User-Agent": "don-bench/1"})
            with urllib.request.urlopen(req, timeout=60) as r:
                j = json.load(r)
            if "error" in j:
                raise RuntimeError(j["error"])
            return j["result"]
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


def cre(args):
    exe = os.environ.get("CRE_BIN") or shutil.which("cre") or str(Path.home() / ".cre/bin/cre")
    out = subprocess.run([exe, *args, "-e", ".env"], cwd=ROOT / "workflows", capture_output=True, text=True, timeout=300)
    return out.stdout


def quant(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * q))] if xs else None


def executions(name, since, limit):
    args = ["execution", "list", name, "--limit", str(limit), "--json"]
    if since:
        args += ["--start", since]
    t = cre(args)
    rows = json.loads(t[t.index("["):]) if "[" in t else []
    by = collections.Counter(f"{r['status']}/{r.get('classifiedStatus')}" for r in rows)
    dur = [int(str(r.get("duration", "0")).rstrip("s") or 0) for r in rows if r["status"] == "SUCCESS"]
    causes = collections.Counter()
    for r in [r for r in rows if r["status"] == "FAILURE"][:3]:  # sample: each status call is one API request
        s = cre(["execution", "status", r["uuid"]])
        for m in re.findall(r"^\s+- (.+?)(?: \(Count: \d+\))?$", s, re.M):
            causes[re.sub(r"0x[0-9a-fA-F]+", "0x..", m)[:200]] += 1
    starts = sorted(r["startedAt"] for r in rows)
    return {
        "executions": len(rows),
        "window_utc": [starts[0], starts[-1]] if starts else None,
        "by_status": dict(by),
        "success_duration_s_p50_p90_max": [quant(dur, 0.5), quant(dur, 0.9), max(dur) if dur else None],
        "failure_causes_sampled": dict(causes),
        "credit_used": sum(float(r.get("creditUsed") or 0) for r in rows),
    }


def reports(receivers, from_block, to_block):
    logs = []
    for s in range(from_block, to_block + 1, 200):  # the public RPC answers 413 on wider windows
        logs += rpc("eth_getLogs", [{"fromBlock": hex(s), "toBlock": hex(min(to_block, s + 199)), "address": receivers}])
    txs = sorted({lg["transactionHash"] for lg in logs if lg["topics"][0].startswith(RECEIVER_REPORT)})
    out, blocks = [], {}
    for h in txs:
        rc = rpc("eth_getTransactionReceipt", [h])
        b = int(rc["blockNumber"], 16)
        if b not in blocks:
            blocks[b] = int(rpc("eth_getBlockByNumber", [hex(b), False])["timestamp"], 16)
        kinds = []
        for lg in rc["logs"]:
            if lg["topics"][0].startswith(RECEIVER_REPORT):
                data = bytes.fromhex(lg["data"][2:])
                n = int.from_bytes(data[32:64], "big")
                kinds += [KIND.get(k, str(k)) for k in data[64:64 + n]]
        accepted = [int(lg["data"][-64:], 16) for lg in rc["logs"] if lg["topics"][0].startswith(FORWARDER_REPORT)]
        out.append({"tx": h, "block": b, "ts": blocks[b], "from": rc["from"].lower(), "to": (rc["to"] or "").lower(),
                    "gas": int(rc["gasUsed"], 16), "fee_wei": int(rc["gasUsed"], 16) * int(rc["effectiveGasPrice"], 16),
                    "kinds": kinds, "forwarder_result": accepted[0] if accepted else None})
    return out


def summarize_reports(rs):
    lat = [r["ts"] % 60 for r in rs]  # cron fires at second 0 of each minute ("0 * * * * *"): tick to block time
    return {
        "accepted_reports": len(rs),
        "forwarder_result_1": sum(1 for r in rs if r["forwarder_result"] == 1),
        "by_kind": dict(collections.Counter(k for r in rs for k in r["kinds"])),
        "dON_transmitters": len({r["from"] for r in rs}),
        "via_keystone_forwarder": sorted({r["to"] for r in rs}),
        "cron_tick_to_block_s_p50_p90_max": [quant(lat, 0.5), quant(lat, 0.9), max(lat) if lat else None],
        "gas_per_report_p50": quant([r["gas"] for r in rs], 0.5),
        "fees_eth_total": round(sum(r["fee_wei"] for r in rs) / 1e18, 8),
        "examples": [r["tx"] for r in rs[:3]],
    }


def trap_latency(trigger_tx, rs):
    rc = rpc("eth_getTransactionReceipt", [trigger_tx])
    t0 = int(rpc("eth_getBlockByNumber", [rc["blockNumber"], False])["timestamp"], 16)
    after = [r for r in rs if r["ts"] >= t0 and "FREEZE" in r["kinds"]]
    if not after:
        return {"trigger_tx": trigger_tx, "freeze_found": False}
    f = min(after, key=lambda r: (r["block"], r["tx"]))
    return {"trigger_tx": trigger_tx, "trigger_block": int(rc["blockNumber"], 16), "freeze_tx": f["tx"], "freeze_block": f["block"],
            "decoy_touch_to_freeze_s": f["ts"] - t0, "freeze_report_kinds": f["kinds"]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workflows", default="quorum-patrol")
    ap.add_argument("--since", default=None, help="ISO time; default: the CRE default window")
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--deployment", default=str(ROOT / "deployments/base-sepolia.json"))
    ap.add_argument("--from-block", type=int, default=None, help="default: the deployment's start block")
    ap.add_argument("--trap-trigger-tx", default=None)
    a = ap.parse_args()
    d = json.loads(Path(a.deployment).read_text())
    receivers = sorted(v["receiver"] for k, v in d.items() if re.fullmatch(r"org[A-Z]", k))
    workflows = {w: executions(w, a.since, a.limit) for w in a.workflows.split(",")}  # before the long chain scan
    head = int(rpc("eth_blockNumber", []), 16)
    rs = reports(receivers, a.from_block or d["startBlock"], head)
    out = {
        "source": "testnet (public Base Sepolia, Chainlink DON, private registry)",
        "generated_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "chain": {"chainId": d["chainId"], "mode": d.get("mode"), "receivers": receivers, "blocks": [a.from_block or d["startBlock"], head]},
        "workflows": workflows,
        "reports": summarize_reports(rs),
    }
    if a.trap_trigger_tx:
        out["trap"] = trap_latency(a.trap_trigger_tx, rs)
    dst = ROOT / "reports/don/don_benchmark.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

"""Cross-source check (41_evaluation.md section 2): every edge touching a node is re-read from a public
Ethereum RPC (independent of Etherscan) and compared field by field.
    python verify_rpc.py [address ...]      default: the seed A address
Normal ETH transfers: eth_getTransactionByHash (from, to, value, block) + receipt status.
Token transfers: the receipt must contain a Transfer(from, to, value) log from the token contract.
Internal ETH transfers need trace APIs that public RPCs do not serve: counted as "not checkable".
"""

import json
import sys
import time
import urllib.request
from pathlib import Path

import etherscan

HERE = Path(__file__).parent
RPCS = ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"]  # both independent of Etherscan
RPC = " / ".join(RPCS)
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"


def rpc(method, params):
    """A null result is retried on the other endpoint: some load-balanced nodes are pruned."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for attempt in range(8):
        url = RPCS[attempt % len(RPCS)]
        try:
            req = urllib.request.Request(url, body, {"Content-Type": "application/json", "User-Agent": "quorum-trace"})
            with urllib.request.urlopen(req, timeout=30) as r:
                j = json.load(r)
            if j.get("result") is not None:
                return j["result"]
        except Exception:
            pass
        time.sleep(0.5 + attempt)
    raise RuntimeError(f"rpc failed on all endpoints: {method} {params}")


def topic_addr(t):
    return "0x" + t[-40:]


def check(addr, cfg):
    raw = etherscan.fetch_node(addr, cfg)
    tokens = {sym: c.lower() for sym, c in cfg["tokens"].items()}
    res = {"ok": 0, "mismatch": [], "not_checkable": 0}
    receipts = {}

    def receipt(h):
        if h not in receipts:
            receipts[h] = rpc("eth_getTransactionReceipt", [h])
        return receipts[h]

    for r in raw["txlist"]:
        if r.get("isError") == "1" or int(r["value"]) == 0 or not r.get("to"):
            continue
        tx = rpc("eth_getTransactionByHash", [r["hash"]])
        rc = receipt(r["hash"])
        same = (
            tx["from"].lower() == r["from"].lower()
            and (tx["to"] or "").lower() == r["to"].lower()
            and int(tx["value"], 16) == int(r["value"])
            and int(tx["blockNumber"], 16) == int(r["blockNumber"])
            and rc["status"] == "0x1"
        )
        res["ok" if same else "mismatch"] += 1 if same else 0
        if not same:
            res["mismatch"].append(r["hash"])
    for sym, rows in sorted(raw["tokens"].items()):
        for r in rows:
            if int(r["value"]) == 0:
                continue
            rc = receipt(r["hash"])
            hit = any(
                lg["address"].lower() == tokens[sym]
                and lg["topics"]
                and lg["topics"][0] == TRANSFER
                and len(lg["topics"]) == 3
                and topic_addr(lg["topics"][1]) == r["from"].lower()
                and topic_addr(lg["topics"][2]) == r["to"].lower()
                and int(lg["data"], 16) == int(r["value"])
                for lg in rc["logs"]
            )
            if hit:
                res["ok"] += 1
            else:
                res["mismatch"].append(r["hash"])
    res["not_checkable"] = sum(1 for r in raw["internal"] if r.get("isError") != "1" and int(r["value"]) > 0)
    return res


def main():
    cfg = json.loads((HERE / "config.json").read_text())
    addrs = [a.lower() for a in (sys.argv[1:] or cfg["seeds"]["A"])]
    total = {"ok": 0, "mismatch": [], "not_checkable": 0}
    for a in addrs:
        r = check(a, cfg)
        print(f"{a}: ok {r['ok']}, mismatch {len(r['mismatch'])}, internal not checkable {r['not_checkable']}")
        total["ok"] += r["ok"]
        total["mismatch"] += r["mismatch"]
        total["not_checkable"] += r["not_checkable"]
    out = HERE / "results" / "rpc_crosscheck.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({"rpc": RPC, "addresses": addrs, **total}, indent=1, sort_keys=True))
    print(f"total: ok {total['ok']}, mismatch {len(total['mismatch'])}, not checkable {total['not_checkable']}")


if __name__ == "__main__":
    main()

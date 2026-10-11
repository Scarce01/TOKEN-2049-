# NOWNodes reliability probe (Trap second source, cross-chain tracer). source = measured. Usage: NOWNODES_KEY=... python analysis/nownodes_probe.py [N]
# For each chain: N latest-ish txs from a public RPC block; fetch receipts from both; canonicalize like workflows/trap nownodes.ts.
import json, os, sys, time, urllib.request, statistics
KEY = os.environ["NOWNODES_KEY"]
CHAINS = {  # name: (nownodes url, public reference rpc, header-key?)
 "eth-sepolia": ("https://eth-sepolia.nownodes.io", "https://ethereum-sepolia-rpc.publicnode.com", True),
 "eth": (f"https://eth.nownodes.io/{KEY}", "https://ethereum-rpc.publicnode.com", False),
 "base": (f"https://base.nownodes.io/{KEY}", "https://mainnet.base.org", False),
 "arbitrum": (f"https://arbitrum.nownodes.io/{KEY}", "https://arbitrum-one-rpc.publicnode.com", False),
 "optimism": (f"https://optimism.nownodes.io/{KEY}", "https://optimism-rpc.publicnode.com", False),
 "bsc": (f"https://bsc.nownodes.io/{KEY}", "https://bsc-rpc.publicnode.com", False),
 "base-sepolia": ("https://base-sepolia.nownodes.io", "https://sepolia.base.org", True),
}
def call(url, m, p, hdr=False):
    h = {"Content-Type": "application/json", "User-Agent": "qu3ee-bench/1"}
    if hdr: h["api-key"] = KEY
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, json.dumps({"jsonrpc":"2.0","id":1,"method":m,"params":p}).encode(), h), timeout=20) as r:
            j = json.load(r)
        return j, (time.perf_counter()-t)*1000, None
    except Exception as e:
        return None, (time.perf_counter()-t)*1000, type(e).__name__ + ":" + str(getattr(e, "code", ""))
def canon(res):
    if res is None: return "miss"
    rows = sorted(f"{int(l['logIndex'],16)}|{l['address'].lower()}|{','.join(t.lower() for t in l['topics'])}|{l['data'].lower()}" for l in res.get("logs", []))
    return f"ok|{int(res.get('status','0x0'),16)}|{';'.join(rows)}"
q = lambda xs, f: round(sorted(xs)[min(len(xs)-1, int(len(xs)*f))], 1) if xs else None
N = int(sys.argv[1]) if len(sys.argv) > 1 else 30
out = {}
for name, (nn, ref, hdr) in CHAINS.items():
    r = {"n": 0, "errors": {}, "lat_ms": [], "agree": 0, "disagree": 0, "nn_miss": 0}
    j, ms, err = call(nn, "eth_blockNumber", [], hdr)
    jr, _, _ = call(ref, "eth_blockNumber", [])
    if not j or "result" not in (j or {}):
        out[name] = {"available": False, "error": err or (j or {}).get("error")}; print(name, out[name], flush=True); continue
    r["head_lag_blocks_vs_ref"] = int(jr["result"],16) - int(j["result"],16) if jr else None
    blk, _, _ = call(ref, "eth_getBlockByNumber", [hex(int(jr["result"],16) - 3), False])
    txs = (blk or {}).get("result", {}).get("transactions", [])[:N]
    for h in txs:
        a, ms, err = call(nn, "eth_getTransactionReceipt", [h], hdr)
        b, _, _ = call(ref, "eth_getTransactionReceipt", [h])
        r["n"] += 1
        if err or not a or "error" in a:
            k = err or str(a.get("error", {}).get("code")); r["errors"][k] = r["errors"].get(k, 0) + 1; continue
        r["lat_ms"].append(ms)
        if a.get("result") is None: r["nn_miss"] += 1; continue
        if canon(a["result"]) == canon(b and b.get("result")): r["agree"] += 1
        else: r["disagree"] += 1
    lat = r.pop("lat_ms")
    r.update({"available": True, "lat_ms_p50_p90_max": [q(lat,.5), q(lat,.9), round(max(lat),1) if lat else None]})
    out[name] = r; print(name, r, flush=True)
print(json.dumps(out))

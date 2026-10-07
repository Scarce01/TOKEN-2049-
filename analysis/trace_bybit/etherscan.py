"""Etherscan V2 client with an on-disk cache. Reads only; everything downstream works from the cache."""

import hashlib
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

from trace_core import Edge

HERE = Path(__file__).parent
CACHE = HERE.parent / "out" / "trace_bybit" / "cache"
API = "https://api.etherscan.io/v2/api"
_last = [0.0]


def _key():
    k = os.environ.get("ETHERSCAN_API_KEY")
    if not k and (HERE / ".env").exists():
        k = (HERE / ".env").read_text().split("=", 1)[1].strip()
    if not k:
        raise SystemExit("ETHERSCAN_API_KEY missing (analysis/trace_bybit/.env)")
    return k


def call(params, retries=12):
    if os.environ.get("TRACE_OFFLINE"):
        raise RuntimeError(f"cache miss in offline mode: {params}")
    q = {"chainid": 1, **params, "apikey": _key()}
    last = "rate limited"
    for attempt in range(retries):
        wait = 0.22 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            with urllib.request.urlopen(f"{API}?{urllib.parse.urlencode(q)}", timeout=40) as r:
                j = json.load(r)
        except Exception as ex:  # network blip, timeout, laptop asleep: back off and retry
            last = repr(ex)
            time.sleep(min(60, 2 * (attempt + 1)))
            continue
        res = j.get("result")
        if isinstance(res, str) and ("rate limit" in res.lower() or "max calls" in res.lower()):
            time.sleep(min(30, 1 + attempt))
            continue
        return j
    raise RuntimeError(f"etherscan call failed after {retries} tries: {params.get('module')}/{params.get('action')}: {last}")


def _cached(name, fn):
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"{hashlib.sha256(name.encode()).hexdigest()[:24]}.json"
    if f.exists():
        return json.loads(f.read_text())
    v = fn()
    f.write_text(json.dumps({"name": name, "v": v}, sort_keys=True))
    return {"name": name, "v": v}


def _pages(params, start, end, max_rows):
    rows, cur, truncated = [], start, False
    while True:
        j = call({**params, "startblock": cur, "endblock": end, "page": 1, "offset": 10000, "sort": "asc"})
        res = j.get("result")
        if not isinstance(res, list):  # "No transactions found"
            break
        rows += res
        if len(res) < 10000:
            break
        nxt = int(res[-1]["blockNumber"])
        if nxt == cur or len(rows) >= max_rows:
            truncated = True
            break
        cur = nxt
    return rows, truncated


def fetch_node(addr, cfg):
    """All ETH and whitelisted-token transfers of `addr` in the window, as raw rows (cached).
    Old cache entries (one tokentx call per token) are reused; new ones use a single tokentx call
    filtered locally, which halves the calls per address."""
    a = addr.lower()
    s, e, mx = cfg["start_block"], cfg["end_block"], cfg["max_rows_per_address"]
    old_key = f"node:{a}:{s}:{e}:{sorted(cfg['tokens'])}"
    f_old = CACHE / f"{hashlib.sha256(old_key.encode()).hexdigest()[:24]}.json"
    if f_old.exists():
        return json.loads(f_old.read_text())["v"]

    def job():
        out = {"txlist": [], "internal": [], "tokens": {}}
        out["txlist"], t1 = _pages({"module": "account", "action": "txlist", "address": a}, s, e, mx)
        out["internal"], t2 = _pages({"module": "account", "action": "txlistinternal", "address": a}, s, e, mx)
        rows, t3 = _pages({"module": "account", "action": "tokentx", "address": a}, s, e, mx)
        by_contract = {c.lower(): sym for sym, c in cfg["tokens"].items()}
        for sym in sorted(cfg["tokens"]):
            out["tokens"][sym] = []
        for r in rows:
            sym = by_contract.get(r.get("contractAddress", "").lower())
            if sym:
                out["tokens"][sym].append(r)
        out["truncated"] = t1 or t2 or t3
        return out

    return _cached(f"node2:{a}:{s}:{e}:{sorted(cfg['tokens'])}", job)["v"]


def _unit(cfg):
    """Value converter. Bybit config has no prices: raw wei (ETH-equivalent 1:1). Multi-asset cases convert
    every asset to integer micro-USD with the case's fixed prices (integer math only)."""
    prices = (cfg or {}).get("prices")
    if not prices:
        return lambda sym, v: v
    return lambda sym, v: v * prices[sym]["usd_micro"] // 10 ** prices[sym]["decimals"]


def edges_from_raw(raw, cfg=None):
    conv = _unit(cfg)
    es = []
    for r in raw["txlist"]:
        if r.get("isError") == "1" or int(r["value"]) == 0 or not r.get("to"):
            continue
        es.append(Edge(int(r["blockNumber"]), r["hash"].lower(), r["from"].lower(), r["to"].lower(), "ETH", conv("ETH", int(r["value"])), int(r["timeStamp"])))
    for r in raw["internal"]:
        if r.get("isError") == "1" or int(r["value"]) == 0 or not r.get("to"):
            continue
        h = f"{r['hash'].lower()}:{r.get('traceId', '')}"
        es.append(Edge(int(r["blockNumber"]), h, r["from"].lower(), r["to"].lower(), "ETH", conv("ETH", int(r["value"])), int(r["timeStamp"])))
    for sym, rows in raw["tokens"].items():
        for r in rows:
            if int(r["value"]) == 0:
                continue
            es.append(Edge(int(r["blockNumber"]), r["hash"].lower(), r["from"].lower(), r["to"].lower(), sym, conv(sym, int(r["value"])), int(r["timeStamp"])))
    return [e for e in es if e.value > 0]


def is_contract(addr, end_block):
    """Etherscan has no historical state ("historical state ... is not available"), so this reads code at
    latest. A contract that self-destructed since the window is missed (rare; noted in the write-up).
    Any RPC error raises: an error must never be read as "not a contract"."""

    def job():
        j = call({"module": "proxy", "action": "eth_getCode", "address": addr, "tag": "latest"})
        if "error" in j or not isinstance(j.get("result"), str) or not j["result"].startswith("0x"):
            raise RuntimeError(f"eth_getCode failed for {addr}: {j.get('error') or j.get('result')}")
        return j["result"]

    r = _cached(f"code-latest:{addr.lower()}", job)["v"]
    return has_contract_code(r)


def has_contract_code(code):
    """EIP-7702 (Pectra, May 2025): an EOA that delegated has code 0xef0100 || 20-byte address. It is still
    an externally owned account (attackers use it), so it must not be treated as a contract breakpoint."""
    if code in ("0x", ""):
        return False
    return not (code.lower().startswith("0xef0100") and len(code) == 2 + 2 * 23)


def contract_name(addr):
    def job():
        j = call({"module": "contract", "action": "getsourcecode", "address": addr})
        res = j.get("result")
        return (res[0].get("ContractName") or "") if isinstance(res, list) and res else ""

    return _cached(f"src:{addr.lower()}", job)["v"]


# ---- transaction expansion: every whitelisted transfer inside one transaction ----

RPCS = {1: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"]}
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"


def rpc(method, params, chain_id=1):
    """Public RPC (independent of Etherscan). A null result is retried on the next endpoint."""
    if os.environ.get("TRACE_OFFLINE"):
        raise RuntimeError(f"cache miss in offline mode: rpc {method}")
    urls = RPCS[chain_id]
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    last = None
    for attempt in range(10):
        url = urls[attempt % len(urls)]
        try:
            req = urllib.request.Request(url, body, {"Content-Type": "application/json", "User-Agent": "quorum-trace"})
            with urllib.request.urlopen(req, timeout=30) as r:
                j = json.load(r)
            if j.get("result") is not None:
                return j["result"]
            last = j.get("error")
        except Exception as ex:
            last = repr(ex)
        time.sleep(min(30, 1 + attempt))
    raise RuntimeError(f"rpc failed: {method} {params}: {last}")


def tx_transfers(txhash, cfg):
    """Raw rows (same shape as fetch_node) for ETH and whitelisted-token transfers inside one tx (cached)."""
    h = txhash.split(":", 1)[0].lower()
    cid = cfg.get("chain_id", 1)

    def job():
        tx = rpc("eth_getTransactionByHash", [h], cid)
        rc = rpc("eth_getTransactionReceipt", [h], cid)
        blk = int(rc["blockNumber"], 16)
        ts = int(rpc("eth_getBlockByNumber", [hex(blk), False], cid)["timestamp"], 16)
        ok = rc["status"] == "0x1"
        out = {"txlist": [], "internal": [], "tokens": {sym: [] for sym in sorted(cfg["tokens"])}, "truncated": False}
        if ok and int(tx["value"], 16) > 0 and tx.get("to"):
            out["txlist"].append({"blockNumber": str(blk), "hash": h, "from": tx["from"], "to": tx["to"], "value": str(int(tx["value"], 16)), "timeStamp": str(ts), "isError": "0"})
        by_contract = {c.lower(): sym for sym, c in cfg["tokens"].items()}
        for lg in rc["logs"] if ok else []:
            sym = by_contract.get(lg["address"].lower())
            if sym and lg["topics"] and lg["topics"][0] == TRANSFER and len(lg["topics"]) == 3:
                out["tokens"][sym].append({"blockNumber": str(blk), "hash": h, "from": "0x" + lg["topics"][1][-40:], "to": "0x" + lg["topics"][2][-40:], "value": str(int(lg["data"], 16)), "timeStamp": str(ts)})
        j = call({"module": "account", "action": "txlistinternal", "txhash": h})
        for i, r in enumerate(j.get("result") if isinstance(j.get("result"), list) else []):
            out["internal"].append({**r, "hash": h, "traceId": r.get("traceId") or f"t{i}"})
        return out

    return _cached(f"tx:{cid}:{h}", job)["v"]

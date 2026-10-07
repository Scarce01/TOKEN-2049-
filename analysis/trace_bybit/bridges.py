"""Cross-chain tracing through Across and Stargate, for funds that leave on another chain and land on Ethereum.

The seed is the same address on every chain (attackers reuse one key across EVM chains). On each origin chain we
follow the seed forward with plain JSON-RPC (NOWNodes): every transaction an address sent is found by bisecting its
nonce, so native transfers are visible without an indexer. Each receipt yields token transfers and bridge deposits.
A deposit only becomes a cross-chain edge after its fill is found on Ethereum with the same identifier:
  Across:   FundsDeposited(originChainId implied, depositId)  ->  FilledRelay(originChainId, depositId) on the SpokePool
  Stargate: OFTSent(guid)                                     ->  OFTReceived(guid) on a Stargate pool
The fill is the evidence (Ethereum tx and log index), the same shape CRE verify-edge reads.

Known limits: Mayan, CCTP and other bridges are not decoded; transfers made by contracts (not sent by the address
itself) are not followed on origin chains; thresholds are fixed per chain (see cases/bitget.json "xchain").
"""

import hashlib
import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import etherscan
from evidence import keccak256
from trace_core import Edge


def topic(sig):
    return "0x" + keccak256(sig.encode()).hex()


TRANSFER = topic("Transfer(address,address,uint256)")
FUNDS_DEPOSITED = topic("FundsDeposited(bytes32,bytes32,uint256,uint256,uint256,uint256,uint32,uint32,uint32,bytes32,bytes32,bytes32,bytes)")
FILLED_RELAY = topic(
    "FilledRelay(bytes32,bytes32,uint256,uint256,uint256,uint256,uint256,uint32,uint32,bytes32,bytes32,bytes32,bytes32,bytes32,(bytes32,bytes32,uint256,uint8))"
)
OFT_SENT = topic("OFTSent(bytes32,uint32,address,uint256,uint256)")
OFT_RECEIVED = topic("OFTReceived(bytes32,uint32,address,uint256)")

ETHEREUM_SPOKE_POOL = "0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5"  # Across SpokePool on Ethereum (Etherscan: ERC1967Proxy)
ETHEREUM_EID = 30101  # LayerZero v2 endpoint id of Ethereum
EIDS = {30110: "arbitrum", 30111: "optimism", 30184: "base", 30102: "bsc", 30106: "avalanche"}


def words(data):
    d = data[2:]
    return [d[i : i + 64] for i in range(0, len(d), 64)]


def addr_of(word_or_topic):
    return "0x" + word_or_topic[-40:].lower()


def pad(a):
    return "0x" + "0" * 24 + a[2:].lower()


def decode_deposits(receipt):
    """Bridge deposits in an origin-chain receipt that go to Ethereum."""
    out = []
    for lg in receipt.get("logs", []):
        t = lg.get("topics") or []
        if not t:
            continue
        if t[0] == FUNDS_DEPOSITED and int(t[1], 16) == 1:
            w = words(lg["data"])
            out.append({"bridge": "across", "deposit_id": int(t[2], 16), "depositor": addr_of(t[3]), "recipient": addr_of(w[7]), "log": lg})
        elif t[0] == OFT_SENT and int(words(lg["data"])[0], 16) == ETHEREUM_EID:
            out.append({"bridge": "stargate", "guid": t[1], "from": addr_of(t[2]), "log": lg})
    return out


def decode_fill(lg):
    """An Ethereum fill log: Across FilledRelay or Stargate OFTReceived."""
    t = lg["topics"]
    w = words(lg["data"])
    if t[0] == FILLED_RELAY:
        return {"bridge": "across", "origin_chain_id": int(t[1], 16), "deposit_id": int(t[2], 16), "recipient": addr_of(w[9]), "output_token": addr_of(w[1]), "amount": int(w[3], 16)}
    if t[0] == OFT_RECEIVED:
        return {"bridge": "stargate", "guid": t[1], "src_eid": int(w[0], 16), "recipient": addr_of(t[2]), "amount": int(w[1], 16)}
    return None


class Rpc:
    """JSON-RPC with an on-disk cache keyed by (chain, method, params). Only immutable reads are cached."""

    def __init__(self, chain, url, cache_dir):
        self.chain, self.url, self.cache, self.calls = chain, url, cache_dir, 0

    def __call__(self, method, params, cache=True):
        key = json.dumps([self.chain, method, params], sort_keys=True)
        f = self.cache / f"rpc_{hashlib.sha256(key.encode()).hexdigest()[:24]}.json"
        if cache and f.exists():
            return json.loads(f.read_text())["v"]
        self.calls += 1
        if self.calls % 200 == 0:
            print(f"  {self.chain}: {self.calls} rpc calls", file=sys.stderr, flush=True)
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        req = urllib.request.Request(self.url, data=body, headers={"Content-Type": "application/json", "User-Agent": "trace/1"})
        for attempt in range(6):
            try:
                with urllib.request.urlopen(req, timeout=90) as r:
                    j = json.load(r)
                break
            except Exception:
                if attempt == 5:
                    raise
                time.sleep(2 * (attempt + 1))  # rate limit or network blip
        if "error" in j:
            raise RuntimeError(f"{self.chain} {method}: {j['error']}")
        if cache:
            self.cache.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps({"k": key, "v": j["result"]}))
        return j["result"]


def block_at(rpc, ts, head, lookback):
    """First block with timestamp >= ts (bisection inside the last `lookback` blocks)."""
    lo, hi = max(1, head - lookback), head
    while lo < hi:
        mid = (lo + hi) // 2
        blk = rpc("eth_getBlockByNumber", [hex(mid), False])
        if blk and int(blk["timestamp"], 16) >= ts:
            hi = mid
        else:
            lo = mid + 1
    return lo


def sent_txs(rpc, a, start, end):
    """Every transaction `a` sent in blocks [start, end], found by bisecting its nonce (no indexer needed)."""
    nonce = lambda b: int(rpc("eth_getTransactionCount", [a, hex(b)]), 16)  # noqa: E731

    def find(k):
        lo, hi = start, end
        while lo < hi:
            mid = (lo + hi) // 2
            if nonce(mid) > k:
                hi = mid
            else:
                lo = mid + 1
        blk = rpc("eth_getBlockByNumber", [hex(lo), True])
        return [t for t in blk["transactions"] if t["from"].lower() == a and int(t["nonce"], 16) == k]

    with ThreadPoolExecutor(3) as pool:  # map keeps nonce order, so the result does not depend on timing
        return [t for txs in pool.map(find, range(nonce(start - 1), nonce(end))) for t in txs]


def is_eoa(rpc, a, block):
    code = rpc("eth_getCode", [a, hex(block)])
    return code in ("0x", "") or code.startswith("0xef0100")  # EIP-7702 delegation is still an EOA


class OriginTrace:
    """Forward trace from the seed on one origin chain. An address is reached when it got at least the chain's
    minimum (native, or an allowlisted token) from a reached address, sent by that address itself."""

    def __init__(self, rpc, xcfg, start, end):
        self.rpc, self.x, self.start, self.end = rpc, xcfg, start, end
        self.tokens = {k.lower(): v for k, v in xcfg["tokens"].items()}

    def run(self, seeds, hops):
        reached = {s: {"hop": 0, "via": None} for s in seeds}
        deposits, frontier = [], list(seeds)
        for hop in range(hops + 1):
            nxt = []
            for a in sorted(frontier):
                for tx in sent_txs(self.rpc, a, self.start, self.end):
                    rc = self.rpc("eth_getTransactionReceipt", [tx["hash"]])
                    if rc["status"] != "0x1":
                        continue
                    for d in decode_deposits(rc):
                        deposits.append({**d, "sender": a, "origin_tx": tx["hash"], "hop": hop})
                    if hop == hops:
                        continue
                    outs = []
                    if int(tx["value"], 16) >= int(self.x["native_min"]) and tx.get("to"):
                        outs.append(tx["to"].lower())
                    for lg in rc["logs"]:
                        t = lg.get("topics") or []
                        tok = self.tokens.get(lg.get("address", "").lower())
                        if tok and len(t) == 3 and t[0] == TRANSFER and addr_of(t[1]) == a and int(lg["data"], 16) >= int(tok["min"]):
                            outs.append(addr_of(t[2]))
                    for b in outs:
                        if b not in reached and is_eoa(self.rpc, b, self.end):
                            reached[b] = {"hop": hop + 1, "via": tx["hash"]}
                            nxt.append(b)
            frontier = nxt
        return reached, deposits


def find_fill(dep, origin_chain_id, cfg):
    """The Ethereum fill for an origin deposit, via the Etherscan logs API (free on chain 1)."""
    if dep["bridge"] == "across":
        q = {"address": ETHEREUM_SPOKE_POOL, "topic0": FILLED_RELAY, "topic1": pad("0x" + f"{origin_chain_id:040x}"), "topic2": pad("0x" + f"{dep['deposit_id']:040x}")}
        q.update({"topic0_1_opr": "and", "topic1_2_opr": "and", "topic0_2_opr": "and"})
    else:
        q = {"topic0": OFT_RECEIVED, "topic1": dep["guid"], "topic0_1_opr": "and"}
    name = f"fill:{json.dumps(q, sort_keys=True)}:{cfg['start_block']}:{cfg['end_block']}"
    res = etherscan._cached(name, lambda: etherscan.call({"module": "logs", "action": "getLogs", "fromBlock": cfg["start_block"], "toBlock": cfg["end_block"], **q}))["v"]
    logs = res.get("result") if isinstance(res.get("result"), list) else []
    for lg in logs:
        f = decode_fill(lg)
        if f:
            return {**f, "tx": lg["transactionHash"].lower(), "block": int(lg["blockNumber"], 16), "ts": int(lg["timeStamp"], 16), "log_index": int(lg["logIndex"], 16) if lg.get("logIndex", "0x") != "0x" else 0, "emitter": lg["address"].lower()}
    return None


def fill_value(fill, cfg, stargate_pools):
    """micro-USD value of a fill with the case's fixed prices; None when the asset is unknown."""
    by_addr = {v.lower(): k for k, v in cfg["tokens"].items()}
    if fill["bridge"] == "across":
        sym = by_addr.get(fill["output_token"])
    else:
        sym = stargate_pools.get(fill["emitter"])
    if sym is None:
        return None, None
    p = cfg["prices"][sym]
    return sym, fill["amount"] * p["usd_micro"] // 10 ** p["decimals"]


def cross_edges(links, cfg, stargate_pools):
    """Synthetic Ethereum edges: from '<chain>:<sender>' (reached on the origin chain) to the fill recipient."""
    es = []
    for lk in links:
        sym, v = fill_value(lk["fill"], cfg, stargate_pools)
        if v:
            f = lk["fill"]
            es.append(Edge(f["block"], f["tx"], f"{lk['chain']}:{lk['sender']}", f["recipient"], sym, v, f["ts"], f["log_index"]))
    return es

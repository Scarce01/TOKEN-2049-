"""Trek on the simulation chain (local anvil fork): a live source for any JSON-RPC endpoint, plus a CLI.

trek.py's `watch` is wired to Ethereum mainnet (mainnet config, Etherscan history, chainId 1 in every evidence hash).
This module leaves trek.py untouched and feeds the same Trek class from the fork:
  - token transfers of the deployment's tokens via eth_getLogs (one call per block, one per backfilled address)
  - the real chain id, so evidenceHash matches what CRE verify-edge computes on chain
  - our own contracts (vaults, receivers, board, ...) are breakpoints: tracing stops there
Native ETH is not followed here: verify-edge cannot verify a native transfer from a receipt (no value in it).

    python fork_source.py --deployment ../../deployments/base-sepolia-fork.json --seed 0x.. \\
        --trigger-evidence 0x.. --from-block N [--to-block M] [--out proposals.jsonl]
"""

import argparse
import json
import sys
import urllib.request

from trek import TRANSFER, Policy, Trek
from trace_core import Edge

PROTOCOL_KEYS = ("requestBoard", "depositVault", "keyRegistry", "threatRegistry", "quorumLens", "faucet", "decoyCommit")


class JsonRpc:
    def __init__(self, url):
        self.url, self.n = url, 0

    def __call__(self, method, params):
        self.n += 1
        body = json.dumps({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params}).encode()
        req = urllib.request.Request(self.url, data=body, headers={"content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            out = json.loads(r.read())
        if out.get("error"):
            raise RuntimeError(f"{method}: {out['error']}")
        return out["result"]


class ForkSource:
    """Same interface as trek.RpcSource (edges, inflows, block_number), on any RPC, tokens only, raw units."""

    def __init__(self, rpc, tokens, start_block):
        self.rpc, self.start = rpc, start_block
        self.tokens = {a.lower(): sym for sym, a in tokens.items()}
        self._ts = {}

    def block_number(self):
        return int(self.rpc("eth_blockNumber", []), 16)

    def _time(self, block):
        if block not in self._ts:
            self._ts[block] = int(self.rpc("eth_getBlockByNumber", [hex(block), False])["timestamp"], 16)
        return self._ts[block]

    def _edges(self, logs):
        out = []
        for lg in logs:
            if len(lg["topics"]) != 3 or lg["topics"][0].lower() != TRANSFER:
                continue
            v = int(lg["data"], 16)
            if not v:
                continue
            b = int(lg["blockNumber"], 16)
            a, t = "0x" + lg["topics"][1][-40:], "0x" + lg["topics"][2][-40:]
            sym = self.tokens[lg["address"].lower()]
            out.append(Edge(b, lg["transactionHash"].lower(), a.lower(), t.lower(), sym, v, self._time(b), int(lg["logIndex"], 16)))
        return out

    def edges(self, block, tracked):
        logs = self.rpc("eth_getLogs", [{"fromBlock": hex(block), "toBlock": hex(block), "address": sorted(self.tokens), "topics": [TRANSFER]}])
        return [e for e in self._edges(logs) if e.frm in tracked or e.to in tracked]

    def inflows(self, addr, upto):
        topic = "0x" + "0" * 24 + addr.lower()[2:]
        flt = {"fromBlock": hex(self.start), "toBlock": hex(upto), "address": sorted(self.tokens), "topics": [TRANSFER, None, topic]}
        return [e for e in self._edges(self.rpc("eth_getLogs", [flt])) if e.to == addr.lower()]


def classifier(deployment):
    """Our own contracts are exits (breakpoint 'protocol'): money that reaches them is not followed further."""
    stops = {deployment[k].lower() for k in PROTOCOL_KEYS if k in deployment}
    for org in ("orgA", "orgB"):
        for k in ("receiver", "hotVault", "warmVault", "coldVault"):
            if org in deployment and k in deployment[org]:
                stops.add(deployment[org][k].lower())
    return lambda a: {"type": "protocol"} if a.lower() in stops else None


def follow(rpc, deployment, seeds, trigger_evidence, from_block, to_block, policy=None):
    """Run Trek block by block over [from_block, to_block] and return its proposals."""
    chain_id = int(rpc("eth_chainId", []), 16)
    tokens = {"qUSD": deployment["qUSD"], "qETH": deployment["qETH"]}
    src = ForkSource(rpc, tokens, deployment.get("startBlock", from_block))
    # raw token units: floor 1 qUSD (6 decimals); Trek's mainnet floor of 0.1 ETH-equivalent would hide everything
    pol = policy or Policy(floor=1_000_000, track_cap=50)
    trek = Trek([s.lower() for s in seeds], src, classifier(deployment), pol, chain_id=chain_id, trigger_evidence=trigger_evidence)
    out = []
    for b in range(from_block, to_block + 1):
        out += trek.on_block(b)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpc", default="http://127.0.0.1:8545")
    ap.add_argument("--deployment", required=True)
    ap.add_argument("--seed", required=True, action="append")
    ap.add_argument("--trigger-evidence", required=True, help="evidenceHash of the Trap THREAT that listed the seed")
    ap.add_argument("--from-block", type=int, required=True)
    ap.add_argument("--to-block", type=int, default=0, help="0 = latest")
    ap.add_argument("--out", default="-")
    a = ap.parse_args()
    rpc = JsonRpc(a.rpc)
    with open(a.deployment, encoding="utf-8") as f:
        dep = json.load(f)
    to_block = a.to_block or int(rpc("eth_blockNumber", []), 16)
    props = follow(rpc, dep, a.seed, a.trigger_evidence.lower(), a.from_block, to_block)
    sink = sys.stdout if a.out == "-" else open(a.out, "w", encoding="utf-8")
    for p in props:
        sink.write(json.dumps(p, sort_keys=True) + "\n")
    if sink is not sys.stdout:
        sink.close()
    print(f"trek-fork: blocks {a.from_block}..{to_block}, proposals {len(props)}, rpc calls {rpc.n}", file=sys.stderr)


if __name__ == "__main__":
    main()

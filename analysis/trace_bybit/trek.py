"""Trek: follows tainted money block by block and PROPOSES what the safety net should do.

Trek is untrusted by design (like exchange-api): it never writes to a chain. Every proposal carries the fields of
ThreatRegistry.add plus the one transfer that explains the taint, so a CRE verify-edge handler can read that
transfer, check it, and only then write the derived entry (docs/36_phase6.md 6.4, docs/47).

Actions (docs/47: suspicion only delays, it never hard-freezes):
  delay         address is at least 90% tainted, tainted amount over the floor, within 3 hops
  watch         tainted, over the floor, but weaker or deeper: logged, no action
  notify        tainted funds reached an exit that is not a member exchange
  hold_deposit  tainted funds reached an address of a member exchange (deposits from it are held)
The confirmed freeze for the decoy seed itself is the Trap workflow's job, not Trek's.

    python trek.py replay --caps 25,50,100,0      replay the cached Bybit data block by block
    python trek.py watch --seed 0x.. --from-block N [--blocks 20]    follow live blocks on a public RPC
"""

import argparse
import json
import sys
import time
from dataclasses import dataclass

from evidence import NATIVE_LOG_INDEX, evidence_hash
from trace_core import PPM, Edge, Tracer

ZERO32 = "0x" + "00" * 32
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"


@dataclass
class Policy:
    hops: int = 4
    tau_ppm: int = 500_000  # keep following an address only if this share of its inflow is tainted
    delay_taint_ppm: int = 900_000
    delay_max_hop: int = 3
    floor: int = 10**17  # cumulative tainted amount (edge units) before an address is proposed at all
    track_cap: int = 50  # how many wallets are watched at once (read budget); seeds are always watched
    ttl_s: int = 72 * 3600  # THREAT_TTL


def _base(h):
    return h.split(":", 1)[0]


class Trek:
    def __init__(self, seeds, source, classify, policy=None, chain_id=1, trigger_evidence=ZERO32, members=()):
        self.p = policy or Policy()
        self.chain_id = chain_id
        self.trigger = trigger_evidence
        self.members = {m.lower() for m in members}
        self.source = source
        self.seeds = [s.lower() for s in seeds]
        self.tracer = Tracer(self.seeds, self.p.hops, self.p.tau_ppm, classify)
        self.tracked = set(self.seeds)
        self.backfilled = set(self.seeds)
        self.emitted: dict[str, dict] = {}  # address -> {"tier", "evidence"}
        self._version = -1

    # ---- which wallets we spend reads on
    def _eligible(self):
        out = []
        for a, n in self.tracer.nodes.items():
            if n.is_seed or n.breakpoint or n.hop >= self.p.hops:
                continue
            if n.taint_ppm >= self.p.tau_ppm:
                out.append((-n.tainted_in, a))
        out.sort()
        cap = self.p.track_cap
        return {a for _, a in (out if cap <= 0 else out[:cap])}

    def _refresh(self, block):
        self.tracked = set(self.seeds) | self._eligible()
        new = sorted(self.tracked - self.backfilled)
        self.backfilled |= set(new)
        if new:
            hist = []
            for a in new:
                hist += self.source.inflows(a, block)  # clean and tainted inflows so far: the taint ratio needs them
            self.tracer.feed(hist)

    # ---- one block
    def on_block(self, block):
        self.tracer.feed(self.source.edges(block, self.tracked))
        if self.tracer.version == self._version:
            return []
        self.tracer.classify_pending()  # a wallet that has only received so far may already be an exit
        self._refresh(block)
        self._version = self.tracer.version
        return self._propose(block)

    def _evidence_of(self, via):
        tx, log, asset = via[1], via[4], via[2]
        if ":" in tx or (asset == "ETH" and log < 0):
            return evidence_hash(self.chain_id, tx, NATIVE_LOG_INDEX), NATIVE_LOG_INDEX
        if log < 0:
            return None, None  # token transfer whose log index is unknown (Etherscan rows); RPC rows have it
        return evidence_hash(self.chain_id, tx, log), log

    def _ancestor_evidence(self, addr):
        seen = set()
        while addr not in seen:
            seen.add(addr)
            if addr in self.emitted and self.emitted[addr].get("evidence"):
                return self.emitted[addr]["evidence"]
            n = self.tracer.nodes.get(addr)
            if n is None or n.via is None or n.is_seed:
                break
            addr = n.via[0]
        return self.trigger

    def _propose(self, block):
        out = []
        ts_now = max((n.via[6] for n in self.tracer.nodes.values() if n.via), default=0)
        for addr in sorted(self.tracer.nodes):
            n = self.tracer.nodes[addr]
            if n.is_seed or n.via is None or n.taint_ppm < self.p.tau_ppm or n.tainted_in < self.p.floor:
                continue
            if n.breakpoint:
                kind, action = "exit", ("hold_deposit" if addr in self.members else "notify")
                tier = action
            else:
                kind = "edge"
                strong = n.taint_ppm >= self.p.delay_taint_ppm and n.hop <= self.p.delay_max_hop
                action = tier = "delay" if strong else "watch"
            prev = self.emitted.get(addr)
            if prev and not (prev["tier"] == "watch" and tier == "delay"):
                continue  # already proposed at this strength (upgrades watch -> delay are re-sent once)
            ev, log = self._evidence_of(n.via)
            parent_ev = self._ancestor_evidence(n.via[0]) if n.via[0] in self.tracer.nodes else self.trigger
            ts = n.via[6]
            prop = {
                "v": 1,
                "kind": kind,
                "action": action,
                "chainId": self.chain_id,
                "block": block,
                "hop": n.hop,
                "taintPpm": n.taint_ppm,
                "taintedIn": str(n.tainted_in),
                "edge": {
                    "parent": n.via[0],
                    "child": addr,
                    "txHash": _base(n.via[1]),
                    "logIndex": log,
                    "native": log == NATIVE_LOG_INDEX,
                    "asset": n.via[2],
                    "amount": str(n.via[3]),
                    "block": n.via[5],
                },
                "threat": {  # arguments of ThreatRegistry.add (proof stays empty: derived entries need none)
                    "suspect": addr,
                    "chainId": self.chain_id,
                    "evidenceHash": ev,
                    "fingerprintHash": ZERO32,
                    "expiresAt": ts + self.p.ttl_s,
                    "parentEvidence": parent_ev,
                    "proof": "0x",
                },
            }
            if kind == "exit":
                prop["exit"] = {"type": n.breakpoint}
            self.emitted[addr] = {"tier": tier, "evidence": ev}
            out.append(prop)
        return out


# ---------------------------------------------------------------- sources
class ReplaySource:
    """Serves cached edges block by block. Only edges that touch a watched wallet are handed over, like a live feed."""

    def __init__(self, edges):
        self.by_block: dict[int, list] = {}
        self.inflow: dict[str, list] = {}
        for e in edges:
            self.by_block.setdefault(e.block, []).append(e)
            self.inflow.setdefault(e.to, []).append(e)

    def blocks(self):
        return sorted(self.by_block)

    def edges(self, block, tracked):
        return [e for e in self.by_block.get(block, ()) if e.frm in tracked or e.to in tracked]

    def inflows(self, addr, upto):
        return [e for e in self.inflow.get(addr, ()) if e.block <= upto]


class RpcSource:
    """Live source on public RPCs. Native ETH comes from the full block, tokens from one getLogs call per block.
    Internal ETH transfers (contract to wallet) are NOT visible this way: a known gap, see the docs."""

    def __init__(self, cfg, min_edge=0):
        import etherscan

        self.es, self.cfg, self.min_edge = etherscan, cfg, min_edge
        self.conv = etherscan._unit(cfg)
        self.tokens = {c.lower(): sym for sym, c in cfg["tokens"].items()}

    def block_number(self):
        return int(self.es.rpc("eth_blockNumber", [], self.cfg.get("chain_id", 1)), 16)

    def edges(self, block, tracked):
        cid = self.cfg.get("chain_id", 1)
        blk = self.es.rpc("eth_getBlockByNumber", [hex(block), True], cid)
        ts = int(blk["timestamp"], 16)
        out = []
        for tx in blk["transactions"]:
            v = int(tx["value"], 16)
            if v == 0 or not tx.get("to"):
                continue
            a, b = tx["from"].lower(), tx["to"].lower()
            if a not in tracked and b not in tracked:
                continue
            rc = self.es.rpc("eth_getTransactionReceipt", [tx["hash"]], cid)
            if rc["status"] != "0x1":
                continue  # a failed transaction moves no value
            out.append(Edge(block, tx["hash"].lower(), a, b, "ETH", self.conv("ETH", v), ts))
        logs = self.es.rpc("eth_getLogs", [{"fromBlock": hex(block), "toBlock": hex(block), "address": sorted(self.tokens), "topics": [TRANSFER]}], cid)
        for lg in logs:
            if len(lg["topics"]) != 3:
                continue
            a, b = "0x" + lg["topics"][1][-40:], "0x" + lg["topics"][2][-40:]
            if a not in tracked and b not in tracked:
                continue
            v = int(lg["data"], 16)
            if v:
                sym = self.tokens[lg["address"].lower()]
                out.append(Edge(block, lg["transactionHash"].lower(), a, b, sym, self.conv(sym, v), ts, int(lg["logIndex"], 16)))
        return [e for e in out if e.value >= self.min_edge]

    def inflows(self, addr, upto):
        cfg = dict(self.cfg, end_block=upto)
        raw = self.es.fetch_node(addr, cfg)
        return [e for e in self.es.edges_from_raw(raw, cfg) if e.to == addr and e.block <= upto and e.value >= self.min_edge]


# ---------------------------------------------------------------- replay evaluation
def replay(edges, seeds, classify, policy, fbi=(), members=(), trigger=ZERO32):
    src = ReplaySource(edges)
    trek = Trek(seeds, src, classify, policy, trigger_evidence=trigger, members=members)
    proposals = []
    for b in src.blocks():
        proposals += trek.on_block(b)
    return trek, proposals, src


def evaluate(proposals, edges, fbi, seeds):
    """How early did Trek flag the wallets on the official list? Lead = seconds between the block where Trek
    proposed a wallet and the first time that wallet sent money on (only wallets that did move on are counted)."""
    fbi = {a.lower() for a in fbi} - {s.lower() for s in seeds}
    ts_by_block = {e.block: e.ts for e in edges}
    sends = {}
    for e in edges:
        sends.setdefault(e.frm, []).append(e)
    by_addr = {p["edge"]["child"]: p for p in proposals if p["kind"] == "edge"}
    hit = {a for a in fbi if a in by_addr}
    leads = []
    for a in sorted(hit):
        p = by_addr[a]
        later = [e.ts for e in sends.get(a, []) if e.block > p["block"]]
        if later:
            leads.append(min(later) - ts_by_block.get(p["block"], 0))
    leads.sort()
    # the same question for every wallet Trek asked to delay, not only the official list
    all_leads = []
    for a, p in by_addr.items():
        if p["action"] != "delay":
            continue
        later = [e.ts for e in sends.get(a, []) if e.block > p["block"]]
        if later:
            all_leads.append(min(later) - ts_by_block.get(p["block"], 0))
    all_leads.sort()
    n = len(all_leads)
    all_delay = {
        "moved_on_after_flag": n,
        "lead_seconds_p10_median_p90": [all_leads[int(n * q)] for q in (0.1, 0.5, 0.9)] if n else None,
        "share_still_unmoved_if_the_flag_takes": {f"{s}s": round(100 * sum(1 for x in all_leads if x > s) / n, 1) for s in (12, 60, 600, 3600)} if n else None,
    }
    return {
        "all_delay": all_delay,
        "proposals": len(proposals),
        "delay": sum(1 for p in proposals if p["action"] == "delay"),
        "watch": sum(1 for p in proposals if p["action"] == "watch"),
        "exits": sum(1 for p in proposals if p["kind"] == "exit"),
        "fbi_proposed": len(hit),
        "fbi_delay_tier": sum(1 for a in hit if by_addr[a]["action"] == "delay"),
        "fbi_of": len(fbi),
        "fbi_that_moved_on_after_flag": len(leads),
        "lead_seconds_p10_median_p90": [leads[int(len(leads) * q)] for q in (0.1, 0.5, 0.9)] if leads else None,
    }


def verify_queue(proposals, edges, per_tick=12, tick_s=30, exec_s=0):
    """What a rate-limited verifier does to the lead time. Planned CRE verify-edge: one call per 30 s, 12 edges
    each (docs/36_phase6.md 6.4). Trek submits the largest tainted amount first. A wallet counts as caught only if
    its verification finished before it first moved money on. exec_s adds the CRE run time per call.
    A derived entry is only accepted while its parent is still valid on chain, so a parent always goes first
    (lower hop first, then largest amount)."""
    ts_by_block = {e.block: e.ts for e in edges}
    sends = {}
    for e in edges:
        sends.setdefault(e.frm, []).append(e.ts)
    items = []
    for p in proposals:
        if p["action"] != "delay":
            continue
        a, t0 = p["edge"]["child"], ts_by_block.get(p["block"], 0)
        later = [t for t in sends.get(a, []) if t > t0]
        items.append({"addr": a, "hop": p["hop"], "t0": t0, "amt": int(p["taintedIn"]), "move": min(later) if later else None, "done": None})
    items.sort(key=lambda i: i["t0"])
    waiting, i, t, backlog = [], 0, items[0]["t0"] if items else 0, 0
    while i < len(items) or waiting:
        while i < len(items) and items[i]["t0"] <= t:
            waiting.append(items[i])
            i += 1
        waiting.sort(key=lambda x: (x["hop"], -x["amt"]))
        for it in waiting[:per_tick]:
            it["done"] = t + exec_s
        waiting = waiting[per_tick:]
        backlog = max(backlog, len(waiting))
        t += tick_s
    moved = [it for it in items if it["move"] is not None]
    caught = sum(1 for it in moved if it["done"] < it["move"])
    waits = sorted(it["done"] - it["t0"] for it in items)
    q = lambda f: waits[min(len(waits) - 1, int(len(waits) * f))] if waits else None  # noqa: E731
    return {
        "delay_proposals": len(items),
        "moved_on_after_flag": len(moved),
        "verified_before_moving_on": caught,
        "share_caught_pct": round(100 * caught / len(moved), 1) if moved else None,
        "wait_seconds_median_p90_max": [q(0.5), q(0.9), waits[-1] if waits else None],
        "peak_backlog": backlog,
        "order": [it["addr"] for it in sorted(items, key=lambda i: i["done"])],
        "per_tick": per_tick,
        "tick_s": tick_s,
    }


# ---------------------------------------------------------------- CLI
def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("replay")
    r.add_argument("--caps", default="25,50,100,0", help="comma list of track caps; 0 = unlimited")
    r.add_argument("--trigger-evidence", default=ZERO32, help="evidenceHash of the decoy trigger (Trap output)")
    w = sub.add_parser("watch")
    w.add_argument("--seed", required=True, action="append")
    w.add_argument("--from-block", type=int, required=True)
    w.add_argument("--blocks", type=int, default=0, help="stop after N blocks (0 = follow forever)")
    w.add_argument("--cap", type=int, default=50)
    w.add_argument("--out", default="-")
    w.add_argument("--trigger-evidence", default=ZERO32, help="evidenceHash of the decoy trigger (Trap output)")
    args = ap.parse_args()

    import bench
    from run import load

    cfg, fbi, seed_sets = load()
    if args.cmd == "replay":
        edges, fetched, senders = bench.cached_universe(cfg)
        classify = bench.cached_classifier(cfg, senders, True)
        rows = {}
        for cap in [int(c) for c in args.caps.split(",")]:
            pol = Policy(track_cap=cap, floor=int(cfg["min_edge_wei"]))
            _, props, _ = replay(edges, seed_sets["A"], classify, pol, fbi, trigger=args.trigger_evidence)
            rows[str(cap)] = evaluate(props, edges, fbi, seed_sets["A"])
            rows[str(cap)]["verify_queue"] = {f"{n}_per_{t}s": verify_queue(props, edges, n, t) for n, t in ((12, 30), (60, 30), (12, 10))}
            print(cap, json.dumps(rows[str(cap)]))
        out = bench.Path(__file__).parent / "results" / "trek_replay.json"
        out.write_text(json.dumps({"cached_addresses": len(fetched), "edges": len(edges), "by_cap": rows}, indent=1, sort_keys=True))
        return

    src = RpcSource(cfg, min_edge=int(cfg["min_edge_wei"]))
    classify = bench.cached_classifier(cfg, {}, False)
    trek = Trek(
        [s.lower() for s in args.seed], src, classify, Policy(track_cap=args.cap, floor=int(cfg["min_edge_wei"])), trigger_evidence=args.trigger_evidence
    )
    sink = sys.stdout if args.out == "-" else open(args.out, "a")
    b, done = args.from_block, 0
    while True:
        latest = src.block_number()
        while b <= latest and (args.blocks == 0 or done < args.blocks):
            for p in trek.on_block(b):
                sink.write(json.dumps(p, sort_keys=True) + "\n")
                sink.flush()
            b += 1
            done += 1
        if args.blocks and done >= args.blocks:
            break
        time.sleep(6)


if __name__ == "__main__":
    main()

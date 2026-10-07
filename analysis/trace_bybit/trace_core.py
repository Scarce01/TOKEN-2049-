"""Haircut taint propagation over a fixed edge list. Pure function: no network, no clock, no floats.

Model (time-ordered haircut, see docs/research/trace_bybit.md):
  * Replay edges in (block, txhash, frm, to, asset) order.
  * Each address keeps cumulative inflow `total_in` and tainted inflow `tainted_in` (all in-window).
  * When X sends v: ratio(X) = tainted_in / total_in at that moment (seeds: 1). The tainted part
    passed on is v * ratio, capped by what X still has tainted (tainted_in - tainted_out).
  * X only passes taint if it is below the hop limit, not a breakpoint, and ratio >= tau.
  * Y's reported taint is tainted_in / total_in over the whole window (the formula in the spec).
  * Swap awareness: converting a tainted asset does not launder it. When X receives value back in the
    same transaction as a tainted outflow (DEX swap), or later from a counterparty X sent tainted
    funds to (redemption, round trip), that inflow stays X's tainted money, up to what X sent out.
    A return is not a hop. Edges of one transaction are processed tainted-sources-first.
  * Swap to another wallet: in a transaction where tainted funds went in, a DEX-like contract (router,
    pool, aggregator, intent reactor, WETH) paying out to a different address passes the taint on to it,
    up to what went in (shared across the transaction's outputs). That is one hop. Exchanges, bridges,
    services and burns never pass taint this way.
Amounts are integers (wei, ETH-equivalent); ratios are parts per million (ppm).
"""

from dataclasses import dataclass, field

PPM = 1_000_000
NOT_SWAP = ("exchange", "service", "bridge", "burn", "mixer", "high-degree")


def swap_like(c):
    return bool(c) and not any(w in c["type"].lower() for w in NOT_SWAP)


@dataclass(frozen=True)
class Edge:
    block: int
    txhash: str
    frm: str
    to: str
    asset: str
    value: int
    ts: int
    log_index: int = -1  # position of the Transfer log inside the tx; -1 when unknown (Etherscan rows) or native

    def key(self):
        # Base tx hash: the same internal transfer read per address and per tx must count once.
        return (self.block, self.txhash.split(":", 1)[0], self.frm, self.to, self.asset, self.value)


@dataclass
class Node:
    hop: int
    total_in: int = 0
    tainted_in: int = 0
    tainted_out: int = 0
    first_tainted_ts: int | None = None
    first_tainted_block: int | None = None
    breakpoint: str | None = None
    is_seed: bool = False
    classified: bool = False
    via: tuple | None = None  # (from, txhash, asset, value, log_index, block, ts) of the edge that first tainted it

    @property
    def taint_ppm(self):
        if self.is_seed:
            return PPM
        return self.tainted_in * PPM // self.total_in if self.total_in else 0


@dataclass
class Result:
    nodes: dict = field(default_factory=dict)
    breakpoint_totals: dict = field(default_factory=dict)  # type -> tainted wei that stopped there

    def as_json(self):
        return {
            "nodes": {
                a: {
                    "hop": n.hop,
                    "taint_ppm": n.taint_ppm,
                    "tainted_in": str(n.tainted_in),
                    "total_in": str(n.total_in),
                    "first_tainted_ts": n.first_tainted_ts,
                    "first_tainted_block": n.first_tainted_block,
                    "breakpoint": n.breakpoint,
                }
                for a, n in sorted(self.nodes.items())
            },
            "breakpoint_totals": {k: str(v) for k, v in sorted(self.breakpoint_totals.items())},
        }


def _base(txhash):
    return txhash.split(":", 1)[0]  # internal transfers carry ":traceId"


class Tracer:
    """Incremental haircut tracer. `feed(edges)` may be called many times with later and later edges (for
    example one block at a time); the state after feeding everything equals `propagate(all edges)`.
    Edges of one transaction must arrive in the same feed. Re-fed edges are ignored."""

    def __init__(self, seeds, hops, tau_ppm, classify, swap_aware=True):
        self.hops, self.tau_ppm, self.classify, self.swap_aware = hops, tau_ppm, classify, swap_aware
        self.seed_set = set(seeds)
        self.nodes: dict[str, Node] = {s: Node(hop=0, is_seed=True) for s in sorted(self.seed_set)}
        self.plain_in: dict[str, int] = {}  # inflow of addresses that are not (yet) tainted nodes
        self.bp_totals: dict[str, int] = {}
        self.class_cache: dict[str, dict | None] = {}
        # X -> list of [counterparty, base tx, tainted amount not yet returned, counterparty breakpoint type, hop]
        self.sent: dict[str, list] = {}
        self.by_tx: dict[str, list] = {}  # base tx -> the same records, for swaps paying a different address
        self.seen: set = set()
        self.last_block = -1
        self.version = 0  # bumps whenever a node is created, gains taint or becomes a breakpoint

    def kind(self, a):
        if a not in self.class_cache:
            self.class_cache[a] = self.classify(a)
        return self.class_cache[a]

    def take_return(self, x, y, base, want):
        """Consume up to `want` of x's outstanding tainted outflows: same tx first, then same counterparty."""
        got = 0
        for match in (lambda r: r[1] == base, lambda r: r[0] == y):
            for r in self.sent.get(x, []):
                if got >= want:
                    return got
                if r[2] > 0 and match(r):
                    t = min(r[2], want - got)
                    r[2] -= t
                    got += t
                    if r[3]:  # it came back, so it did not stop at that service
                        self.bp_totals[r[3]] = self.bp_totals.get(r[3], 0) - t
        return got

    def step(self, e):
        nodes, hops, seed_set = self.nodes, self.hops, self.seed_set
        src = nodes.get(e.frm)
        passed = 0
        src_hop = None
        if src is not None and not src.is_seed and not src.classified:
            # Classified only when it is about to pass taint on (a leaf never needs a lookup).
            src.classified = True
            c = self.kind(e.frm)
            if c:
                src.breakpoint = c["type"]
                self.version += 1
                self.bp_totals[src.breakpoint] = self.bp_totals.get(src.breakpoint, 0) + src.tainted_in
        if src is not None and src.breakpoint is None and src.hop < hops:
            ratio_ppm = PPM if src.is_seed else (src.tainted_in * PPM // src.total_in if src.total_in else 0)
            if ratio_ppm >= self.tau_ppm and ratio_ppm > 0:
                if src.is_seed:
                    passed = e.value
                else:
                    passed = min(e.value * src.tainted_in // src.total_in, src.tainted_in - src.tainted_out)
                if passed > 0:
                    src.tainted_out += passed
                    src_hop = src.hop

        # A DEX-like contract paying out in a transaction that received tainted funds (swap to any wallet).
        swapped, swap_hop = 0, None
        base = _base(e.txhash)
        if passed == 0 and self.by_tx.get(base) and e.to not in seed_set and e.frm not in self.sent:
            src_kind = self.kind(e.frm) if (src is None or src.breakpoint) else None
            dst_known = nodes.get(e.to)
            if swap_like(src_kind) and not (dst_known and dst_known.breakpoint) and not swap_like(self.kind(e.to)):
                want = e.value
                for r in self.by_tx[base]:
                    if want == 0:
                        break
                    if r[2] > 0 and r[0] != e.to:
                        t = min(r[2], want)
                        r[2] -= t
                        want -= t
                        swapped += t
                        swap_hop = r[4] + 1 if swap_hop is None else min(swap_hop, r[4] + 1)
                        if r[3]:
                            self.bp_totals[r[3]] = self.bp_totals.get(r[3], 0) - t

        dst = nodes.get(e.to)
        if dst is None and swapped > 0 and swap_hop <= hops:
            dst = Node(hop=swap_hop)
            dst.total_in = self.plain_in.pop(e.to, 0)
            nodes[e.to] = dst
        elif dst is not None and swapped > 0 and swap_hop < dst.hop:
            dst.hop = swap_hop
        if dst is None:
            if passed > 0:
                dst = Node(hop=src_hop + 1)
                dst.total_in = self.plain_in.pop(e.to, 0)
                nodes[e.to] = dst
            else:
                self.plain_in[e.to] = self.plain_in.get(e.to, 0) + e.value
                return
        if passed > 0:
            rec = [e.to, _base(e.txhash), passed, dst.breakpoint, src_hop]
            self.sent.setdefault(e.frm, []).append(rec)
            self.by_tx.setdefault(rec[1], []).append(rec)
        # Value coming back to a tainted address from a swap or a counterparty it paid with tainted funds.
        returned = (
            self.take_return(e.to, e.frm, _base(e.txhash), e.value - passed)
            if self.swap_aware and dst.breakpoint is None
            else 0
        )
        dst.total_in += e.value
        gain = passed + returned + swapped
        if gain > 0:
            self.version += 1
            dst.tainted_in += gain
            if dst.first_tainted_ts is None:
                dst.first_tainted_ts, dst.first_tainted_block = e.ts, e.block
                dst.via = (e.frm, e.txhash, e.asset, e.value, e.log_index, e.block, e.ts)
            if passed > 0 and src_hop + 1 < dst.hop:
                dst.hop = src_hop + 1
            if dst.breakpoint and passed > 0:
                self.bp_totals[dst.breakpoint] = self.bp_totals.get(dst.breakpoint, 0) + passed

    def classify_pending(self):
        """Classify every tainted address now. The batch path classifies lazily, when an address first passes
        taint on; a live follower must know the moment money arrives at an exchange, before it moves on."""
        for a, n in self.nodes.items():
            if not n.is_seed and not n.classified and n.tainted_in > 0:
                n.classified = True
                c = self.kind(a)
                if c:
                    n.breakpoint = c["type"]
                    self.version += 1
                    self.bp_totals[n.breakpoint] = self.bp_totals.get(n.breakpoint, 0) + n.tainted_in

    def feed(self, edges):
        fresh = {}
        for e in edges:
            if e.value > 0 and e.frm != e.to and e.key() not in self.seen:
                fresh[e.key()] = e
        self.seen.update(fresh)
        ordered = sorted(fresh.values(), key=lambda e: (e.block, _base(e.txhash), e.txhash, e.frm, e.to, e.asset, e.value))
        # One transaction at a time; inside it, edges from tainted addresses first (repeat until stable).
        i = 0
        while i < len(ordered):
            j = i
            key = (ordered[i].block, _base(ordered[i].txhash))
            while j < len(ordered) and (ordered[j].block, _base(ordered[j].txhash)) == key:
                j += 1
            pending = ordered[i:j]
            while pending:
                ready = [e for e in pending if e.frm in self.nodes]
                if not ready:
                    ready = pending
                for e in ready:
                    self.step(e)
                done = {id(e) for e in ready}
                pending = [e for e in pending if id(e) not in done]
            i = j
        if ordered:
            self.last_block = max(self.last_block, ordered[-1].block)
        return self

    def result(self):
        return Result(nodes=self.nodes, breakpoint_totals={k: v for k, v in self.bp_totals.items() if v > 0})


def propagate(edges, seeds, hops, tau_ppm, classify, swap_aware=True):
    """edges: iterable of Edge. seeds: list of addresses. classify(addr) -> None or {"type": ..., ...}.
    swap_aware=False gives the plain haircut model (kept for benchmarking). Batch form of Tracer."""
    return Tracer(seeds, hops, tau_ppm, classify, swap_aware).feed(edges).result()

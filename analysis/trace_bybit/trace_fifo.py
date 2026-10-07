"""FIFO taint propagation, kept only as a comparison baseline for the haircut model in trace_core.

Every address keeps a queue of lots (value, tainted part), oldest first. An outflow consumes lots from the front,
taking the tainted part pro rata inside a lot. The result is exact when the order of money in an account is
known, but an account does not record that order, so an attacker can choose it: deposit clean funds first and the
next hop looks clean (the weakness Tironsakkul et al. note for UTXO chains, here shown on the account model).

Plain model on purpose: no swap awareness, so it is compared against plain haircut (swap_aware=False).
Integers only, same Edge, Node and Result types as trace_core.
"""

from collections import deque

from trace_core import PPM, Node, Result, _base


def propagate_fifo(edges, seeds, hops, tau_ppm, classify):
    uniq = {e.key(): e for e in edges if e.value > 0 and e.frm != e.to}
    ordered = sorted(uniq.values(), key=lambda e: (e.block, _base(e.txhash), e.txhash, e.frm, e.to, e.asset, e.value))

    seed_set = set(seeds)
    nodes = {s: Node(hop=0, is_seed=True) for s in sorted(seed_set)}
    lots: dict[str, deque] = {}
    total_in: dict[str, int] = {}
    class_cache = {}

    def kind(a):
        if a not in class_cache:
            class_cache[a] = classify(a)
        return class_cache[a]

    for e in ordered:
        src = nodes.get(e.frm)
        # 1. consume the sender's oldest lots (for every address, so the order stays right)
        taken_taint = 0
        if src is not None and src.is_seed:
            taken_taint = e.value
        else:
            q = lots.get(e.frm)
            remaining = e.value
            while q and remaining > 0:
                lot = q[0]
                take = min(lot[0], remaining)
                part = lot[1] * take // lot[0] if lot[0] else 0
                lot[0] -= take
                lot[1] -= part
                taken_taint += part
                remaining -= take
                if lot[0] == 0:
                    q.popleft()
        # 2. only an eligible tainted address passes taint on
        passed = 0
        src_hop = None
        if src is not None and taken_taint > 0:
            if not src.is_seed and not src.classified:
                src.classified = True
                c = kind(e.frm)
                if c:
                    src.breakpoint = c["type"]
            if src.breakpoint is None and src.hop < hops and taken_taint * PPM // e.value >= tau_ppm:
                passed = taken_taint
                src_hop = src.hop
                src.tainted_out += passed
        # 3. the receiver gets a lot and its totals are updated
        lots.setdefault(e.to, deque()).append([e.value, passed])
        total_in[e.to] = total_in.get(e.to, 0) + e.value
        dst = nodes.get(e.to)
        if dst is None and passed > 0:
            dst = Node(hop=src_hop + 1)
            nodes[e.to] = dst
        if dst is not None:
            dst.total_in = total_in[e.to]
            if passed > 0:
                dst.tainted_in += passed
                if dst.first_tainted_ts is None:
                    dst.first_tainted_ts, dst.first_tainted_block = e.ts, e.block
                dst.hop = min(dst.hop, src_hop + 1)
    return Result(nodes=nodes, breakpoint_totals={})

"""Trek: policy, evidence chain, read budget, backfill, and the live source with a fake RPC."""

import pytest

from evidence import NATIVE_LOG_INDEX, evidence_hash
from trace_core import Edge, propagate
from trek import ZERO32, Policy, ReplaySource, RpcSource, Trek, evaluate, replay

E = 10**18
TRIGGER = "0x" + "11" * 32


def tx(n):
    return "0x" + f"{n:064x}"


def edge(block, frm, to, value, n, asset="ETH", log=-1):
    return Edge(block, tx(n), frm, to, asset, value, block * 12, log)


def run_trek(edges, policy=None, classify=lambda a: None, members=(), seeds=("s",)):
    return replay(edges, list(seeds), classify, policy or Policy(floor=E // 10), members=members, trigger=TRIGGER)


def test_hop1_wallet_gets_a_delay_proposal_with_registry_fields():
    _, props, _ = run_trek([edge(1, "s", "a", 10 * E, 1, log=4, asset="stETH")])
    assert len(props) == 1
    p = props[0]
    assert p["action"] == "delay" and p["kind"] == "edge" and p["hop"] == 1
    assert p["edge"] == {"parent": "s", "child": "a", "txHash": tx(1), "logIndex": 4, "native": False, "asset": "stETH", "amount": str(10 * E), "block": 1}
    t = p["threat"]
    assert t["suspect"] == "a" and t["parentEvidence"] == TRIGGER and t["proof"] == "0x" and t["fingerprintHash"] == ZERO32
    assert t["evidenceHash"] == evidence_hash(1, tx(1), 4)
    assert t["expiresAt"] == 12 + 72 * 3600  # block time + THREAT_TTL


def test_native_transfer_uses_the_agreed_native_log_index():
    _, props, _ = run_trek([edge(1, "s", "a", 10 * E, 1)])
    assert props[0]["edge"]["logIndex"] == NATIVE_LOG_INDEX and props[0]["edge"]["native"] is True
    assert props[0]["threat"]["evidenceHash"] == evidence_hash(1, tx(1), NATIVE_LOG_INDEX)


def test_token_transfer_with_unknown_log_index_has_no_evidence_hash_yet():
    _, props, _ = run_trek([edge(1, "s", "a", 10 * E, 1, asset="USDT")])
    assert props[0]["edge"]["logIndex"] is None and props[0]["threat"]["evidenceHash"] is None


def test_below_the_floor_nothing_is_proposed():
    _, props, _ = run_trek([edge(1, "s", "a", E // 20, 1)])
    assert props == []


def test_small_splits_are_proposed_only_where_they_add_up():
    edges = [edge(1, "s", "a", E // 2, 1)] + [edge(2, "a", f"b{i}", E // 20, 10 + i) for i in range(10)]
    edges += [edge(3, f"b{i}", "m", E // 20, 30 + i) for i in range(10)]
    _, props, _ = run_trek(edges)
    names = {p["edge"]["child"] for p in props}
    assert "m" in names and not any(n.startswith("b") for n in names)


def test_evidence_chain_links_each_hop_to_its_parent():
    _, props, _ = run_trek([edge(1, "s", "a", 10 * E, 1), edge(2, "a", "b", 10 * E, 2)])
    by = {p["edge"]["child"]: p for p in props}
    assert by["a"]["threat"]["parentEvidence"] == TRIGGER
    assert by["b"]["threat"]["parentEvidence"] == by["a"]["threat"]["evidenceHash"]


def test_each_wallet_is_proposed_once_even_if_replayed():
    edges = [edge(1, "s", "a", 10 * E, 1), edge(2, "a", "b", 10 * E, 2)]
    trek, props, src = run_trek(edges)
    again = []
    for b in src.blocks():
        again += trek.on_block(b)
    assert again == [] and len(props) == 2


def test_weak_taint_is_watch_and_upgrades_to_delay_once():
    # a holds 10 clean first, so it is only 50% tainted: watch. Later more tainted money arrives: delay.
    edges = [edge(1, "clean", "a", 10 * E, 1), edge(2, "s", "a", 10 * E, 2), edge(3, "s", "a", 90 * E, 3)]
    _, props, _ = run_trek(edges, Policy(floor=E // 10, tau_ppm=400_000))
    acts = [p["action"] for p in props if p["edge"]["child"] == "a"]
    assert acts == ["watch", "delay"]


def test_exit_is_notify_for_others_and_hold_deposit_for_members():
    cls = lambda a: {"type": "exchange"} if a == "ex" else None  # noqa: E731
    edges = [edge(1, "s", "a", 10 * E, 1), edge(2, "a", "ex", 10 * E, 2)]
    _, props, _ = run_trek(edges, classify=cls)
    ex = next(p for p in props if p["kind"] == "exit")
    assert ex["action"] == "notify" and ex["exit"]["type"] == "exchange"
    _, props, _ = run_trek(edges, classify=cls, members=["ex"])
    assert next(p for p in props if p["kind"] == "exit")["action"] == "hold_deposit"


def test_no_proposal_is_ever_a_hard_freeze():
    edges = [edge(1, "s", "a", 10 * E, 1), edge(2, "a", "b", 10 * E, 2), edge(3, "b", "ex", 10 * E, 3)]
    _, props, _ = run_trek(edges, classify=lambda a: {"type": "exchange"} if a == "ex" else None)
    assert {p["action"] for p in props} <= {"delay", "watch", "notify", "hold_deposit"}


def test_backfill_uses_earlier_clean_inflow_so_the_ratio_is_not_inflated():
    # x got 10 clean at block 1; s sends 10 at block 2. Without history x would look 100% tainted.
    edges = [edge(1, "clean", "x", 10 * E, 1), edge(2, "s", "x", 10 * E, 2), edge(3, "x", "y", 10 * E, 3)]
    trek, props, _ = run_trek(edges, Policy(floor=E // 10, tau_ppm=0))
    batch = propagate(edges, ["s"], 4, 0, lambda a: None).nodes
    assert trek.tracer.nodes["x"].taint_ppm == batch["x"].taint_ppm == 500_000
    assert trek.tracer.nodes["y"].tainted_in == batch["y"].tainted_in == 5 * E
    assert next(p for p in props if p["edge"]["child"] == "x")["action"] == "watch"  # 50% is below the delay bar


class Recording(ReplaySource):
    def __init__(self, edges):
        super().__init__(edges)
        self.asked = []

    def edges(self, block, tracked):
        self.asked.append(set(tracked))
        return super().edges(block, tracked)


def test_track_cap_limits_which_wallets_are_followed():
    edges = [edge(1, "s", "big", 100 * E, 1), edge(1, "s", "small", 1 * E, 2), edge(2, "big", "big2", 50 * E, 3), edge(2, "small", "small2", E, 4)]
    src = Recording(edges)
    trek = Trek(["s"], src, lambda a: None, Policy(floor=E // 10, track_cap=1), trigger_evidence=TRIGGER)
    props = []
    for b in src.blocks():
        props += trek.on_block(b)
    assert src.asked[-1] == {"s", "big"}  # only the most tainted wallet is read, plus the seed
    names = {p["edge"]["child"] for p in props}
    assert "big2" in names and "small2" not in names


def test_replay_evaluation_counts_lead_time_before_a_wallet_moves_on():
    edges = [edge(1, "s", "a", 10 * E, 1), edge(5, "a", "z", 10 * E, 2)]
    _, props, _ = run_trek(edges)
    ev = evaluate(props, edges, {"a"}, ["s"])
    assert ev["fbi_proposed"] == 1 and ev["fbi_that_moved_on_after_flag"] == 1
    assert ev["lead_seconds_p10_median_p90"][1] == 5 * 12 - 1 * 12  # flagged at block 1, moved on at block 5


# ---- live source with a fake RPC
class FakeEs:
    def __init__(self):
        self.calls = []

    @staticmethod
    def _unit(cfg):
        return lambda sym, v: v

    def rpc(self, method, params, chain_id=1):
        self.calls.append(method)
        if method == "eth_getBlockByNumber":
            return {"timestamp": hex(1000), "transactions": [
                {"hash": tx(1), "from": "0xaa", "to": "0xbb", "value": hex(5 * E)},
                {"hash": tx(2), "from": "0xaa", "to": "0xcc", "value": hex(7 * E)},  # reverted below
                {"hash": tx(3), "from": "0xdd", "to": "0xee", "value": hex(9 * E)},  # not watched
                {"hash": tx(4), "from": "0xaa", "to": None, "value": hex(1)},  # contract creation
            ]}
        if method == "eth_getTransactionReceipt":
            return {"status": "0x0" if params[0] == tx(2) else "0x1"}
        if method == "eth_getLogs":
            return [{"address": "0xtoken", "topics": ["0xddf", "0x" + "00" * 12 + "aa" * 20, "0x" + "00" * 12 + "bb" * 20], "data": hex(3 * E), "transactionHash": tx(5), "logIndex": hex(7)}]
        raise AssertionError(method)


def test_rpc_source_builds_edges_skips_failed_and_unwatched_and_reads_log_index():
    src = RpcSource({"tokens": {"WETH": "0xTOKEN"}, "chain_id": 1})
    src.es = FakeEs()
    src.conv = src.es._unit(None)
    watched = {"0xaa", "0x" + "aa" * 20}
    got = src.edges(100, watched)
    kinds = sorted((e.asset, e.value, e.log_index) for e in got)
    assert ("ETH", 5 * E, -1) in kinds
    assert not any(e.value == 7 * E for e in got)  # failed tx moves no value
    assert not any(e.value == 9 * E for e in got)  # nobody we watch
    tok = [e for e in got if e.asset == "WETH"]
    assert len(tok) == 1 and tok[0].log_index == 7 and tok[0].frm == "0x" + "aa" * 20
    assert pytest.approx(1) == 1


def test_verify_queue_rate_limit_decides_who_is_caught():
    from trek import verify_queue

    # a, b, c are flagged at once and z, which they pay, one block later: 4 delay proposals. One verification slot
    # per tick, largest tainted amount first. a and c move on at the same time; only a is verified before that.
    edges = [edge(1, "s", "a", 30 * E, 1), edge(1, "s", "b", 20 * E, 2), edge(1, "s", "c", 10 * E, 3), edge(2, "a", "z", 30 * E, 4), edge(2, "c", "z", 10 * E, 5)]
    _, props, _ = run_trek(edges)
    r = verify_queue(props, edges, per_tick=1, tick_s=30)
    assert r["delay_proposals"] == 4 and r["moved_on_after_flag"] == 2
    # a (largest) is done at t0; c waits behind b and z and is done long after it moved at t0+12
    assert r["verified_before_moving_on"] == 1 and r["peak_backlog"] == 2
    assert verify_queue(props, edges, per_tick=12, tick_s=30)["share_caught_pct"] == 100.0


def test_verify_queue_sends_parent_before_child():
    from trek import verify_queue

    # The registry rejects a derived entry whose parent is not valid yet, so with one slot per tick a child must
    # never overtake its parent, even when it carries the larger amount (b is paid 40 by a, x only 10; with several tainted parents a child can outweigh one of them).
    edges = [edge(1, "s", "a", 50 * E, 1), edge(1, "s", "x", 10 * E, 2), edge(2, "a", "b", 40 * E, 3)]
    _, props, _ = run_trek(edges)
    order = verify_queue(props, edges, per_tick=1, tick_s=30)["order"]
    assert len(order) == 3 and order.index("a") < order.index("b")

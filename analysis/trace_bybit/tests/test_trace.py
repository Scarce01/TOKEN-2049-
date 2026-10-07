"""Unit tests for the tracing core. Every expected value is computable by hand.

Edge = (block, txhash, frm, to, asset, value_wei, ts). Addresses are plain strings here.
"""

import ast
import random
from pathlib import Path

import pytest

from trace_core import Edge, propagate

E = 10**18


def edge(block, frm, to, value, h=None, asset="ETH"):
    return Edge(block=block, txhash=h or f"0x{block:04x}{frm}{to}", frm=frm, to=to, asset=asset, value=value, ts=block * 12)


def run(edges, seeds=("S",), hops=2, tau=0.1, breakpoints=None):
    return propagate(edges, list(seeds), hops=hops, tau_ppm=int(tau * 1_000_000), classify=lambda a: (breakpoints or {}).get(a))


def test_seed_to_one_receiver_is_fully_tainted():
    r = run([edge(1, "S", "A", 10 * E)])
    assert r.nodes["A"].taint_ppm == 1_000_000
    assert r.nodes["A"].hop == 1
    assert r.nodes["A"].tainted_in == 10 * E


def test_mixed_inflow_halves_the_taint():
    # A gets 10 from the seed and 10 from a clean address: taint 0.5
    r = run([edge(1, "S", "A", 10 * E), edge(2, "CLEAN", "A", 10 * E)])
    assert r.nodes["A"].taint_ppm == 500_000
    assert r.nodes["A"].tainted_in == 10 * E


def test_taint_propagates_in_proportion_to_next_hop():
    # A is 50% tainted (10 of 20) and sends 8 on to B: B receives 4 tainted of 8, so B is 50% tainted
    r = run([edge(1, "S", "A", 10 * E), edge(2, "CLEAN", "A", 10 * E), edge(3, "A", "B", 8 * E)])
    assert r.nodes["B"].tainted_in == 4 * E
    assert r.nodes["B"].taint_ppm == 500_000  # 4 tainted of B's only inflow of 8
    assert r.nodes["B"].hop == 2


def test_below_tau_is_not_expanded():
    # A is 5% tainted (1 of 20): below tau 0.1, so its outflow does not taint B
    r = run([edge(1, "S", "A", 1 * E), edge(2, "CLEAN", "A", 19 * E), edge(3, "A", "B", 10 * E)], tau=0.1)
    assert "B" not in r.nodes


def test_outflow_before_first_tainted_inflow_does_not_count():
    # A sends to B at block 1, only receives from the seed at block 5
    r = run([edge(1, "A", "B", 10 * E), edge(5, "S", "A", 10 * E)])
    assert "B" not in r.nodes


def test_hop_limit():
    chain = [edge(1, "S", "A", 10 * E), edge(2, "A", "B", 10 * E), edge(3, "B", "C", 10 * E)]
    assert "C" not in run(chain, hops=2).nodes
    assert run(chain, hops=3).nodes["C"].hop == 3


def test_breakpoint_receives_taint_but_is_not_expanded():
    edges = [edge(1, "S", "X", 10 * E), edge(2, "X", "B", 10 * E)]
    r = run(edges, breakpoints={"X": {"type": "exchange", "source": "test"}})
    assert r.nodes["X"].breakpoint == "exchange"
    assert "B" not in r.nodes
    assert r.breakpoint_totals["exchange"] == 10 * E


def test_cycle_terminates_and_taint_stays_bounded():
    edges = [edge(1, "S", "A", 10 * E), edge(2, "A", "B", 10 * E), edge(3, "B", "A", 10 * E), edge(4, "A", "B", 10 * E)]
    r = run(edges, hops=5)
    for n in r.nodes.values():
        assert 0 <= n.taint_ppm <= 1_000_000
        assert n.tainted_in <= n.total_in


def test_tainted_out_never_exceeds_tainted_in():
    # A holds 5 tainted + 5 clean; sends out 10 twice. Second send cannot be fully tainted.
    edges = [edge(1, "S", "A", 5 * E), edge(1, "CLEAN", "A", 5 * E), edge(2, "A", "B", 10 * E), edge(3, "A", "C", 10 * E)]
    r = run(edges)
    assert r.nodes["B"].tainted_in + r.nodes.get("C", type("x", (), {"tainted_in": 0})).tainted_in <= 5 * E


def test_deterministic_under_shuffle():
    edges = [edge(b, f, t, v * E) for b, f, t, v in [(1, "S", "A", 6), (1, "S", "B", 4), (2, "A", "C", 3), (2, "B", "C", 2), (3, "C", "D", 4)]]
    ref = run(edges)
    for seed in range(20):
        shuffled = edges[:]
        random.Random(seed).shuffle(shuffled)
        assert run(shuffled).as_json() == ref.as_json()


def test_seed_is_never_a_candidate_with_partial_taint():
    r = run([edge(1, "S", "A", 10 * E), edge(2, "A", "S", 10 * E)])
    assert r.nodes["S"].hop == 0
    assert r.nodes["S"].taint_ppm == 1_000_000


def test_duplicate_edges_are_counted_once():
    e = edge(1, "S", "A", 10 * E, h="0xsame")
    r = run([e, e])
    assert r.nodes["A"].total_in == 10 * E


def test_no_floats_in_core():
    src = (Path(__file__).parent.parent / "trace_core.py").read_text()
    tree = ast.parse(src)
    floats = [n for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, float)]
    divs = [n for n in ast.walk(tree) if isinstance(n, ast.BinOp) and isinstance(n.op, ast.Div)]
    assert not floats and not divs


@pytest.mark.parametrize("seeds_on_list", [0, 3])
def test_recall_denominator_excludes_seeds_on_the_list(seeds_on_list):
    from score import recall_denominator

    fbi = {f"f{i}" for i in range(51)}
    seeds = {f"f{i}" for i in range(seeds_on_list)} | {f"x{i}" for i in range(7 - seeds_on_list)}
    assert recall_denominator(fbi, seeds) == 51 - seeds_on_list


def test_score_flags_only_addresses_at_or_above_tau():
    from score import score

    nodes = {"a": {"hop": 1, "taint_ppm": 900_000}, "b": {"hop": 2, "taint_ppm": 50_000}, "s": {"hop": 0, "taint_ppm": 1_000_000}}
    fbi = {"a", "b"}
    assert score(nodes, fbi, {"s"}, 2, 100_000)["found_fbi"] == ["a"]
    assert score(nodes, fbi, {"s"}, 2, 0)["found_fbi"] == ["a", "b"]
    assert score(nodes, fbi, {"s"}, 1, 0)["flagged"] == 1


def test_is_contract_raises_on_rpc_error(monkeypatch, tmp_path):
    import etherscan

    monkeypatch.setattr(etherscan, "CACHE", tmp_path)
    monkeypatch.setattr(etherscan, "call", lambda p: {"error": {"code": -32000, "message": "historical state is not available"}})
    with pytest.raises(RuntimeError):
        etherscan.is_contract("0xabc", 1)


def test_zero_address_is_labelled_as_a_breakpoint():
    from classify import load_labels

    assert load_labels()["0x0000000000000000000000000000000000000000"]["type"] == "burn / redeem"


# ---- swap awareness: converting a tainted asset does not launder it ----


def test_same_tx_swap_return_keeps_taint():
    # A (fully tainted) swaps 10 stETH at a DEX and gets 10 ETH back from a pool in the same tx
    edges = [
        edge(1, "S", "A", 10 * E, asset="stETH"),
        Edge(2, "0xswap", "A", "DEX", "stETH", 10 * E, 24),
        Edge(2, "0xswap", "POOL", "A", "ETH", 10 * E, 24),
        edge(3, "A", "B", 10 * E),
    ]
    r = run(edges, hops=3)
    assert r.nodes["A"].taint_ppm == 1_000_000  # the returned ETH is A's own converted funds
    assert r.nodes["B"].tainted_in == 10 * E
    assert r.nodes["B"].hop == 2  # the swap is not a hop


def test_round_trip_from_same_counterparty_keeps_taint():
    # A sends 10 tainted to C (a redemption contract), later C pays 9 back to A
    edges = [edge(1, "S", "A", 10 * E), edge(2, "A", "C", 10 * E), edge(5, "C", "A", 9 * E), edge(6, "A", "B", 9 * E)]
    r = run(edges, hops=3, breakpoints={"C": {"type": "dex", "source": "test"}})
    assert r.nodes["A"].tainted_in == 19 * E
    assert r.nodes["B"].tainted_in == 9 * E


def test_return_is_capped_by_what_was_sent():
    # A sent 10 tainted to C; C later pays back 30 (20 of it is someone else's money)
    edges = [edge(1, "S", "A", 10 * E), edge(2, "A", "C", 10 * E), edge(5, "C", "A", 30 * E)]
    r = run(edges, hops=3, breakpoints={"C": {"type": "dex", "source": "test"}})
    assert r.nodes["A"].tainted_in == 20 * E  # 10 from the seed + 10 returned
    assert r.nodes["A"].total_in == 40 * E


def test_stranger_paying_a_tainted_address_is_not_a_return():
    edges = [edge(1, "S", "A", 10 * E), edge(2, "X", "A", 10 * E)]
    r = run(edges)
    assert r.nodes["A"].taint_ppm == 500_000


def test_usd_conversion_is_integer_and_exact():
    from etherscan import _unit

    conv = _unit({"prices": {"ETH": {"decimals": 18, "usd_micro": 2_682_691_075}, "USDT": {"decimals": 6, "usd_micro": 1_000_000}}})
    assert conv("ETH", 10**18) == 2_682_691_075  # 1 ETH = 2,682.691075 USD in micro-USD
    assert conv("USDT", 5_000_000) == 5_000_000  # 5 USDT
    assert _unit(None)("ETH", 123) == 123  # Bybit: raw wei unchanged


def test_breakpoints_are_never_counted_as_flagged():
    from score import score

    nodes = {"pool": {"hop": 1, "taint_ppm": 1_000_000, "breakpoint": "dex/pool"}, "w": {"hop": 1, "taint_ppm": 1_000_000}}
    assert score(nodes, {"pool", "w"}, set(), 1, 0)["found_fbi"] == ["w"]


def test_eip7702_delegated_eoa_is_not_a_contract():
    from etherscan import has_contract_code

    assert not has_contract_code("0x")
    assert not has_contract_code("0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b")  # Bitget Exploiter 2
    assert has_contract_code("0x6080604052348015600f57600080fd5b50")  # ordinary bytecode
    assert has_contract_code("0xef0100" + "ab" * 21)  # wrong length: not a 7702 designator


# ---- transaction-level swaps: output paid to a different (fresh) address ----


def test_swap_output_to_a_new_wallet_inherits_taint():
    # X (tainted) pays 10 USDT into a DEX; in the same tx the pool pays 10 ETH-eq to fresh wallet Y
    edges = [
        edge(1, "S", "X", 10 * E, asset="USDT"),
        Edge(2, "0xswap", "X", "ROUTER", "USDT", 10 * E, 24),
        Edge(2, "0xswap", "POOL", "Y", "ETH", 10 * E, 24),
        edge(3, "Y", "Z", 10 * E),
    ]
    bps = {"ROUTER": {"type": "dex/bridge router"}, "POOL": {"type": "dex/pool"}}
    r = run(edges, hops=4, breakpoints=bps)
    assert r.nodes["Y"].tainted_in == 10 * E
    assert r.nodes["Y"].hop == 2  # a transfer to another wallet through a swap is one hop
    assert r.nodes["Z"].tainted_in == 10 * E


def test_swap_pool_is_shared_and_capped():
    # X puts 10 tainted into the swap; the tx pays 6 to Y and 6 to W: only 10 in total can be tainted
    edges = [
        edge(1, "S", "X", 10 * E),
        Edge(2, "0xswap", "X", "ROUTER", "ETH", 10 * E, 24),
        Edge(2, "0xswap", "POOL", "W", "USDT", 6 * E, 24),
        Edge(2, "0xswap", "POOL", "Y", "USDT", 6 * E, 24),
    ]
    bps = {"ROUTER": {"type": "dex"}, "POOL": {"type": "dex/pool"}}
    r = run(edges, hops=4, breakpoints=bps)
    assert r.nodes["W"].tainted_in + r.nodes["Y"].tainted_in == 10 * E


def test_unrelated_swap_in_another_tx_does_not_taint():
    edges = [
        edge(1, "S", "X", 10 * E),
        Edge(2, "0xswapA", "X", "ROUTER", "ETH", 10 * E, 24),
        Edge(3, "0xswapB", "POOL", "Y", "USDT", 10 * E, 36),  # someone else's swap later
    ]
    bps = {"ROUTER": {"type": "dex"}, "POOL": {"type": "dex/pool"}}
    r = run(edges, hops=4, breakpoints=bps)
    assert "Y" not in r.nodes


def test_exchange_deposit_is_not_a_swap():
    # Paying into an exchange then the exchange paying someone else in the same tx is not a conversion
    edges = [edge(1, "S", "X", 10 * E), Edge(2, "0xt", "X", "CEX", "ETH", 10 * E, 24), Edge(2, "0xt", "CEX", "Y", "ETH", 10 * E, 24)]
    r = run(edges, hops=4, breakpoints={"CEX": {"type": "exchange"}})
    assert "Y" not in r.nodes


def test_dust_senders_do_not_make_an_attacker_wallet_a_service():
    from run import count_senders

    big = [Edge(1, f"0x{i}", f"s{i}", "W", "ETH", 10 * E, 12) for i in range(3)]
    dust = [Edge(1, f"0xd{i}", f"d{i}", "W", "ETH", 1, 12) for i in range(80)]  # address-poisoning dust
    assert count_senders(big + dust, "W", 10**17) == 3  # not 83
    assert count_senders(big + dust, "W", 0) == 83


# ---- Trek: FIFO comparison and the small-split (peel) case ----


def test_fifo_can_be_gamed_by_depositing_clean_funds_first():
    # X holds 10 clean first, then receives 10 tainted. It sends 10 out (to Y), later 10 (to Z).
    from trace_fifo import propagate_fifo

    edges = [
        edge(1, "CLEAN", "X", 10 * E),
        edge(2, "S", "X", 10 * E),
        edge(3, "X", "Y", 10 * E),
        edge(4, "X", "Z", 10 * E),
    ]
    fifo = propagate_fifo(edges, ["S"], hops=3, tau_ppm=0, classify=lambda a: None)
    assert "Y" not in fifo.nodes  # FIFO spends the clean lot first: Y looks clean
    assert fifo.nodes["Z"].tainted_in == 10 * E
    hair = run(edges, hops=3, tau=0)
    assert hair.nodes["Y"].tainted_in == 5 * E  # haircut does not let the order hide the taint
    assert hair.nodes["Z"].tainted_in == 5 * E


def test_fifo_matches_haircut_when_there_is_nothing_to_game():
    from trace_fifo import propagate_fifo

    edges = [edge(1, "S", "A", 10 * E), edge(2, "A", "B", 4 * E), edge(3, "A", "C", 6 * E)]
    fifo = propagate_fifo(edges, ["S"], hops=3, tau_ppm=0, classify=lambda a: None)
    hair = run(edges, hops=3, tau=0)
    for a in ("A", "B", "C"):
        assert fifo.nodes[a].tainted_in == hair.nodes[a].tainted_in


def test_fifo_is_deterministic_under_shuffle():
    from trace_fifo import propagate_fifo

    edges = [edge(b, f, t, v * E) for b, f, t, v in [(1, "S", "A", 6), (1, "CLEAN", "A", 4), (2, "A", "C", 3), (3, "A", "D", 7)]]
    ref = propagate_fifo(edges, ["S"], 3, 0, lambda a: None).as_json()
    for seed in range(10):
        sh = edges[:]
        random.Random(seed).shuffle(sh)
        assert propagate_fifo(sh, ["S"], 3, 0, lambda a: None).as_json() == ref


def test_small_splits_are_caught_by_cumulative_taint_at_the_merge_point():
    # 10 branches of 0.05 each, below a 0.1 per-edge floor, merge into M: M holds 0.5 tainted.
    from score import score

    edges = [edge(1, "S", "A", E // 2)] + [edge(2, "A", f"B{i}", E // 20) for i in range(10)]
    edges += [edge(3, f"B{i}", "M", E // 20) for i in range(10)]
    res = run(edges, hops=3, tau=0)
    nodes = res.as_json()["nodes"]
    floor = E // 10  # 0.1 ETH
    per_edge = score(nodes, {f"B{i}" for i in range(10)} | {"M"}, {"S"}, 3, 0, min_tainted=floor)
    assert per_edge["found_fbi"] == ["m"]  # no single branch passes the floor; the merge point does
    assert score(nodes, {"b0"}, {"S"}, 3, 0, min_tainted=0)["found_fbi"] == ["b0"]  # floor off: branch counted


def test_cumulative_floor_ignores_dust_that_never_adds_up():
    from score import score

    edges = [edge(1, "S", "A", E)] + [edge(2, "A", f"D{i}", 1) for i in range(5)]  # 5 wei each
    nodes = run(edges, hops=2, tau=0).as_json()["nodes"]
    out = score(nodes, {f"d{i}" for i in range(5)}, {"S"}, 2, 0, min_tainted=E // 10)
    assert out["found_fbi"] == [] and out["flagged"] == 1  # only A is flagged


# ---- Tracer: feeding block by block equals feeding everything at once ----


def _blocks(edges):
    out = {}
    for e in edges:
        out.setdefault(e.block, []).append(e)
    return [out[b] for b in sorted(out)]


def test_incremental_feed_equals_batch_on_a_swap_scenario():
    from trace_core import Tracer

    edges = [
        edge(1, "S", "X", 10 * E, asset="stETH"),
        Edge(2, "0xswap", "X", "ROUTER", "stETH", 10 * E, 24),
        Edge(2, "0xswap", "POOL", "Y", "ETH", 10 * E, 24),
        edge(3, "Y", "Z", 6 * E),
        edge(3, "CLEAN", "Z", 6 * E),
        edge(4, "Z", "W", 5 * E),
    ]
    bps = {"ROUTER": {"type": "dex/bridge router"}, "POOL": {"type": "dex/pool"}}
    batch = run(edges, hops=4, tau=0, breakpoints=bps).as_json()
    t = Tracer(["S"], 4, 0, lambda a: bps.get(a))
    for blk in _blocks(edges):
        t.feed(blk)
    assert t.result().as_json() == batch


def test_incremental_feed_equals_batch_on_random_graphs():
    from trace_core import Tracer

    rng = random.Random(7)
    names = ["S"] + [f"n{i}" for i in range(12)]
    for trial in range(15):
        edges = [edge(rng.randint(1, 8), rng.choice(names), rng.choice(names), rng.randint(1, 9) * E, h=f"0x{trial}{k}") for k in range(30)]
        batch = run(edges, hops=3, tau=0).as_json()
        t = Tracer(["S"], 3, 0, lambda a: None)
        for blk in _blocks(edges):
            t.feed(blk)
        assert t.result().as_json() == batch, trial


def test_refeeding_the_same_edges_changes_nothing():
    from trace_core import Tracer

    edges = [edge(1, "S", "A", 10 * E), edge(2, "A", "B", 4 * E)]
    t = Tracer(["S"], 3, 0, lambda a: None).feed(edges)
    ref = t.result().as_json()
    t.feed(edges)
    assert t.result().as_json() == ref


# ---- evidence hash: pure-Python keccak must equal the chain's ----


def test_keccak256_known_vectors():
    from evidence import keccak256

    assert keccak256(b"").hex() == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    assert keccak256(b"abc").hex() == "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"
    assert keccak256(b"a" * 200).hex() == "96ea54061def936c4be90b518992fdc6f12f535068a256229aca54267b4d084d"  # two blocks, from cast


def test_evidence_hash_matches_cast_and_ids_ts():
    from evidence import evidence_hash

    # cast keccak $(cast abi-encode "f(uint256,bytes32,uint256)" 84532 0xab..ab 3)
    assert evidence_hash(84532, "0x" + "ab" * 32, 3) == "0xbdc807dc7050bfc911c38f840118410fc71b302129c8e8bb44b0c4fb879d9feb"
    assert evidence_hash(1, "0x" + "ab" * 32 + ":t5", 0) == evidence_hash(1, "0x" + "ab" * 32, 0)  # trace suffix ignored


def test_classify_pending_flags_an_exit_that_has_only_received():
    from trace_core import Tracer

    t = Tracer(["S"], 3, 0, lambda a: {"type": "exchange"} if a == "EX" else None)
    t.feed([edge(1, "S", "A", 10 * E), edge(2, "A", "EX", 10 * E)])
    assert t.nodes["EX"].breakpoint is None  # lazy: EX never sent anything, so it was never looked up
    t.classify_pending()
    assert t.nodes["EX"].breakpoint == "exchange"
    assert t.result().breakpoint_totals == {"exchange": 10 * E}

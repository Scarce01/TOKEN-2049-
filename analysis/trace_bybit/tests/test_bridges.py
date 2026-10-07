"""bridges.py: event decoding, nonce bisection, the origin-chain trace and cross-chain edges, with a fake chain."""

import bridges
from bridges import FILLED_RELAY, FUNDS_DEPOSITED, OFT_RECEIVED, OFT_SENT, TRANSFER, OriginTrace, decode_deposits, decode_fill, pad, sent_txs

E = 10**18


def a(n):
    return "0x" + f"{n:040x}"


def w(x):
    return f"{x:064x}"


def h(n):
    return "0x" + f"{n:064x}"


def test_topics_match_the_verified_events():
    # topics read from real logs (Across SpokePool and StargatePoolNative on Ethereum, Across SpokePool on Arbitrum)
    assert FUNDS_DEPOSITED == "0x32ed1a409ef04c7b0227189c3a103dc5ac10e775a15b785dcc510201f7c25ad3"
    assert FILLED_RELAY.startswith("0x44b559f101")
    assert OFT_RECEIVED.startswith("0xefed6d3500")
    assert OFT_SENT == "0x85496b760a4b7f8d66384b9df21b381f5d1b1e79f229a47aaf4c232edc2fe59a"


def test_deposits_to_ethereum_are_decoded_and_other_destinations_ignored():
    across = {"topics": [FUNDS_DEPOSITED, h(1), h(4687579), pad(a(6))], "data": "0x" + "".join(w(0) for _ in range(7)) + w(int(a(9), 16)) + w(0) * 5}
    across_to_base = {"topics": [FUNDS_DEPOSITED, h(8453), h(5), pad(a(6))], "data": across["data"]}
    stargate = {"topics": [OFT_SENT, h(77), pad(a(7))], "data": "0x" + w(30101) + w(10) + w(10)}
    stargate_to_bsc = {"topics": [OFT_SENT, h(78), pad(a(7))], "data": "0x" + w(30102) + w(10) + w(10)}
    out = decode_deposits({"logs": [across, across_to_base, stargate, stargate_to_bsc, {"topics": [], "data": "0x"}]})
    assert [(d["bridge"], d.get("deposit_id"), d.get("guid")) for d in out] == [("across", 4687579, None), ("stargate", None, h(77))]
    assert out[0]["depositor"] == a(6) and out[0]["recipient"] == a(9)


def test_fills_are_decoded():
    data = "0x" + w(0) + w(int(a(0xEE), 16)) + w(0) + w(5 * E) + "".join(w(0) for _ in range(5)) + w(int(a(9), 16)) + w(0) * 5
    f = decode_fill({"topics": [FILLED_RELAY, h(42161), h(4687579), pad(a(3))], "data": data})
    assert f == {"bridge": "across", "origin_chain_id": 42161, "deposit_id": 4687579, "recipient": a(9), "output_token": a(0xEE), "amount": 5 * E}
    g = decode_fill({"topics": [OFT_RECEIVED, h(77), pad(a(9))], "data": "0x" + w(30184) + w(3 * E)})
    assert g == {"bridge": "stargate", "guid": h(77), "src_eid": 30184, "recipient": a(9), "amount": 3 * E}
    assert decode_fill({"topics": [TRANSFER, h(1), h(2)], "data": "0x" + w(1)}) is None


class Chain:
    """A tiny chain: blocks with transactions, receipts, nonces and code. Answers the RPC calls bridges.py makes."""

    def __init__(self):
        self.blocks, self.receipts, self.code = {}, {}, {}

    def send(self, block, frm, to, value=0, logs=()):
        txs = self.blocks.setdefault(block, [])
        nonce = sum(1 for b in self.blocks.values() for t in b if t["from"] == frm)
        t = {"hash": h(len(self.receipts) + 1), "from": frm, "to": to, "value": hex(value), "nonce": hex(nonce)}
        txs.append(t)
        self.receipts[t["hash"]] = {"status": "0x1", "logs": list(logs)}
        return t["hash"]

    def __call__(self, method, params, cache=True):
        if method == "eth_getTransactionCount":
            who, b = params[0], int(params[1], 16)
            return hex(sum(1 for blk, txs in self.blocks.items() if blk <= b for t in txs if t["from"] == who))
        if method == "eth_getBlockByNumber":
            return {"transactions": self.blocks.get(int(params[0], 16), []), "timestamp": hex(int(params[0], 16) * 2)}
        if method == "eth_getTransactionReceipt":
            return self.receipts[params[0]]
        if method == "eth_getCode":
            return self.code.get(params[0], "0x")
        raise AssertionError(method)


def test_nonce_bisection_finds_every_transaction_an_address_sent():
    c = Chain()
    c.send(5, a(1), a(2), E)
    c.send(9, a(3), a(2), E)  # someone else
    c.send(40, a(1), a(4), 2 * E)
    c.send(41, a(1), a(5), 3 * E)
    got = sent_txs(c, a(1), 10, 100)
    assert [t["to"] for t in got] == [a(4), a(5)]  # the one before the window is not included


def test_origin_trace_follows_native_and_tokens_and_collects_deposits():
    c = Chain()
    usdt = a(0xD0)
    c.code[usdt] = "0x60"
    c.code[a(0xBB)] = "0x60"  # a contract recipient: not followed
    c.code[a(8)] = "0xef0100" + "00" * 20  # EIP-7702 delegated EOA: followed
    seed = a(1)
    c.send(20, seed, a(2), 5 * E)  # native, above the minimum
    c.send(21, seed, a(3), E // 2)  # native, below the minimum
    c.send(22, seed, a(0xBB), 9 * E)
    c.send(23, seed, usdt, 0, [{"address": usdt, "topics": [TRANSFER, pad(seed), pad(a(8))], "data": "0x" + w(5000 * 10**6)}])
    c.send(24, seed, usdt, 0, [{"address": usdt, "topics": [TRANSFER, pad(a(99)), pad(a(7))], "data": "0x" + w(9000 * 10**6)}])  # not sent by seed
    dep = {"address": a(0xBB), "topics": [FUNDS_DEPOSITED, h(1), h(55), pad(a(2))], "data": "0x" + "".join(w(0) for _ in range(7)) + w(int(a(2), 16)) + w(0) * 5}
    c.send(30, a(2), a(0xBB), 4 * E, [dep])
    tr = OriginTrace(c, {"native_min": str(E), "tokens": {usdt: {"min": str(2000 * 10**6)}}}, 10, 100)
    reached, deposits = tr.run([seed], hops=2)
    assert {k: v["hop"] for k, v in reached.items()} == {seed: 0, a(2): 1, a(8): 1}
    assert [(d["sender"], d["deposit_id"], d["hop"]) for d in deposits] == [(a(2), 55, 1)]


def test_cross_edges_value_the_fill_and_skip_unknown_assets():
    cfg = {"tokens": {"WETH": "0x" + "c0" * 20}, "prices": {"WETH": {"decimals": 18, "usd_micro": 2_000_000_000}, "ETH": {"decimals": 18, "usd_micro": 2_000_000_000}}}
    links = [
        {"chain": "arbitrum", "sender": a(6), "fill": {"bridge": "across", "output_token": "0x" + "c0" * 20, "amount": 3 * E, "recipient": a(6), "tx": h(1), "block": 7, "ts": 70, "log_index": 4}},
        {"chain": "base", "sender": a(21), "fill": {"bridge": "stargate", "emitter": a(0x51), "amount": E, "recipient": a(21), "tx": h(2), "block": 8, "ts": 80, "log_index": 1}},
        {"chain": "base", "sender": a(22), "fill": {"bridge": "across", "output_token": a(0xDD), "amount": E, "recipient": a(22), "tx": h(3), "block": 9, "ts": 90, "log_index": 1}},
    ]
    es = bridges.cross_edges(links, cfg, {a(0x51): "ETH"})
    assert [(e.frm, e.to, e.asset, e.value // 10**6, e.log_index) for e in es] == [("arbitrum:" + a(6), a(6), "WETH", 6000, 4), ("base:" + a(21), a(21), "ETH", 2000, 1)]

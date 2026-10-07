import json

from evidence import evidence_hash
from fork_source import follow
from trek import TRANSFER

CHAIN = 84532
QUSD = "0x" + "66" * 20
VAULT = "0x" + "44" * 20
S, H1, H2, C = ("0x" + c * 20 for c in ("11", "22", "33", "99"))
ROOT = "0x" + "77" * 32
DEP = {"qUSD": QUSD, "qETH": "0x" + "65" * 20, "startBlock": 1, "orgA": {"receiver": "0x" + "45" * 20, "hotVault": VAULT, "warmVault": "0x" + "46" * 20, "coldVault": "0x" + "47" * 20}}


def pad(a):
    return "0x" + "0" * 24 + a[2:]


def log(block, n, frm, to, amount, idx=0):
    return {"address": QUSD, "topics": [TRANSFER, pad(frm), pad(to)], "data": hex(amount), "blockNumber": hex(block), "transactionHash": "0x" + f"{block:02x}{n:02x}" * 16, "logIndex": hex(idx)}


# seed S pays H1 5 qUSD; clean C pays H2 1 qUSD; H1 pays H2 4 qUSD and the vault 1 qUSD
LOGS = [log(9, 1, C, H2, 1_000_000), log(10, 1, S, H1, 5_000_000, 3), log(11, 1, H1, H2, 4_000_000), log(11, 2, H1, VAULT, 1_000_000, 1)]


def fake_rpc(method, params):
    if method == "eth_chainId":
        return hex(CHAIN)
    if method == "eth_getBlockByNumber":
        return {"timestamp": hex(1_000 + int(params[0], 16) * 2)}
    if method == "eth_getLogs":
        f = params[0]
        lo, hi = int(f["fromBlock"], 16), int(f["toBlock"], 16)
        want_to = f["topics"][2] if len(f["topics"]) > 2 else None
        return [lg for lg in LOGS if lo <= int(lg["blockNumber"], 16) <= hi and (want_to is None or lg["topics"][2] == want_to)]
    raise AssertionError(method)


def test_fork_trek_uses_real_chain_id_and_chains_parents():
    props = {p["edge"]["child"]: p for p in follow(fake_rpc, DEP, [S], ROOT, 9, 11)}
    h1, h2 = props[H1], props[H2]
    ev1 = evidence_hash(CHAIN, "0x" + "0a01" * 16, 3)
    # the evidence hash is the one CRE verify-edge recomputes on chain 84532, not chainId 1
    assert h1["threat"]["evidenceHash"] == ev1 and h1["chainId"] == CHAIN
    assert h1["threat"]["parentEvidence"] == ROOT and h1["action"] == "delay" and h1["hop"] == 1
    assert h1["edge"]["logIndex"] == 3 and h1["edge"]["amount"] == "5000000" and h1["edge"]["parent"] == S
    # H2 is 80% tainted (4 of 5 qUSD): followed, but below the 90% delay tier, and its parent is H1's entry
    assert h2["threat"]["parentEvidence"] == ev1 and h2["action"] == "watch" and h2["taintPpm"] == 800_000
    # our own vault is an exit, never an edge proposal
    assert VAULT not in props or props[VAULT]["kind"] == "exit"
    json.dumps(list(props.values()))  # proposals stay plain JSON

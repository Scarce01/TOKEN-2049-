import json

import numpy as np
import pytest

from commit import build_tree, decoy_leaf, decoy_salt, decoy_tag, user_id_hash, verify
from lifecycle import LIFE, epoch_window, rotate_at, run_epoch
from model import CFG, Population, consistent, generate, monte_carlo, p_first, place, synthetic_population

K = bytes(range(1, 33))  # test key, not a real secret
SALT = bytes.fromhex("5a" * 32)
H = lambda b: "0x" + b.hex()  # noqa: E731


REAL = synthetic_population(1000, 4049)


def test_commit_matches_typescript():
    # vectors from packages/shared (decoySalt, decoyLeaf, buildTree, userIdHash, decoyTag) with the same inputs
    s0, s7 = decoy_salt(K, 0), decoy_salt(K, 0x00070003)
    assert H(s0) == "0xa72759cf43f43d5a6b0c81732afbc35734317a597df2ba9bc205fea6f054010a"
    assert H(s7) == "0x8c8eee2c61f945eb2f775134838ae5c7184a2488c73f1215e41dd8365c1d0d96"
    id1, id2 = bytes(12) + bytes.fromhex("11" * 20), bytes.fromhex("ab" * 32)
    leaves = [decoy_leaf(84532, id1, s0), decoy_leaf(84532, id2, s7), bytes.fromhex("01" * 32), bytes.fromhex("02" * 32)]
    assert H(leaves[0]) == "0xe8ad0dbf215cda8159334cf4b90806df6128e45bf2b08c675012541defddf67b"
    assert H(leaves[1]) == "0x1fe8ee95d5f93a2af51f3834af4f6b37a0d6046a413712a9028244a9512aa836"
    root, proofs = build_tree(leaves)
    assert H(root) == "0xcdf51cbfa700997d2eff60792933ac6ca29aa5e40e80b549bf43748f55730e72"
    assert [H(p) for p in proofs[1]] == [H(leaves[0]), "0x346d8c96a2454213fcc0daff3c96ad0398148181b9fa6488f7ae2c0af5b20aa0"]
    assert all(verify(root, leaves[i], proofs[i]) for i in range(4))
    h = user_id_hash(SALT, "ua-123456")
    assert H(h) == "0x4d28fb660ea9e0b97044eec186253faf1a4fc1f7ab8c89262cd2f6e85d30fdc8"
    assert H(user_id_hash(SALT, "")) == "0xc58d705f49eaba32f11014b98d76464336ff708a5a17c48ef976fd1a1abc4990"
    assert H(decoy_tag(K, "acct", h)) == "0x26a0bc82a1182344"


def test_consistency_rules():
    assert all(consistent(a) for a in REAL)
    bad = dict(REAL[0], deposits={"qUSD": "0", "qETH": "0"})
    assert not consistent(bad)


def test_plackett_luce_closed_form_matches_monte_carlo():
    pop = Population(REAL)
    decoys = generate(pop, np.random.default_rng(1), 3000)[:6]
    closed, mc = p_first(pop, decoys), monte_carlo(pop, decoys, np.random.default_rng(2))
    for s in closed:
        assert abs(closed[s] - mc[s]["pFirst"]) < 0.015, s


def test_generated_candidates_are_admissible_and_pass_the_gate():
    pop = Population(REAL)
    from model import adversarial

    cands = generate(pop, np.random.default_rng(3), 3000)
    assert len(cands) >= 100 and all(pop.admissible(c) for c in cands)
    g = adversarial(pop, cands, 3)
    assert g["gate"], g["aucUpper"]


def test_placement_respects_rho_max_and_budget():
    pop = Population(REAL)
    cands = generate(pop, np.random.default_rng(4), 3000)
    chosen = place(pop, [], cands, 20, 50_000, np.random.default_rng(5))
    assert chosen and sum(c["balanceUsd"] for c in chosen) <= 50_000
    for s, idx in pop.segment.items():
        n = sum(s in pop.segments_of(c) for c in chosen)
        assert n / (len(idx) + n) <= CFG["rhoMax"], s


def _epochs(k=K, n=4, burn_at=None):
    state, out = None, []
    for e in range(1, n + 1):
        burned = {state["active"][0]["tag"]} if state and e == burn_at else set()
        state, plan, feed, report = run_epoch(json.loads(json.dumps(state)) if state else None, REAL, k, "a", 84532, e, SALT, {a["userId"] for a in REAL}, burned)
        out.append((plan, feed, report, burned))
    return state, out


@pytest.fixture(scope="module")
def run():
    return _epochs(burn_at=3)


def test_lifecycle_commit_rotation_and_burn(run):
    state, out = run
    roots = {p["root"] for p, _, _, _ in out}
    assert len(roots) == len(out)  # new salts every epoch, so a new root every epoch
    for plan, feed, report, burned in out:
        s, e = plan["window"]
        assert s <= plan["rotateAt"] < e
        assert 0 < len(plan["active"]) <= LIFE["target"]
        for r in plan["active"]:
            leaf = decoy_leaf(84532, bytes.fromhex(r["ident"][2:]), decoy_salt(K, r["commit"]["i"]))
            assert verify(bytes.fromhex(plan["root"][2:]), leaf, [bytes.fromhex(p[2:]) for p in r["commit"]["path"]])
            assert r["commit"]["i"] >> 16 == plan["epoch"]
        if burned:
            assert not burned & {r["tag"] for r in plan["active"]}
            assert any(ev["kind"] == "burn" for ev in feed["events"])
    assert out[0][0]["bootstrap"] and not out[-1][0]["bootstrap"]
    retired = {r["tag"] for r in state["retired"]}
    assert not retired & {r["tag"] for r in state["active"] + state["pool"]}  # never reused
    assert len(set(state["usedIds"])) == len(state["usedIds"])
    assert not {a["userId"] for a in REAL} & {r["account"]["userId"] for r in state["active"] + state["pool"]}


def test_feed_and_report_do_not_leak_identities(run):
    state, out = run
    secrets = {r["account"]["userId"] for r in state["active"] + state["pool"]} | {r["ident"] for r in state["active"] + state["pool"]}
    for plan, feed, report, _ in out:
        f, rp = json.dumps(feed), json.dumps(report)
        assert not any(x in f or x in rp for x in secrets)
        assert "userId" not in f and "displayName" not in f
        assert not any(r["tag"] in rp for r in plan["active"] + plan["pool"])  # report: statistics only


def test_deterministic_with_k_and_different_without():
    a = run_epoch(None, REAL, K, "a", 84532, 1, SALT, set())
    b = run_epoch(None, REAL, K, "a", 84532, 1, SALT, set())
    c = run_epoch(None, REAL, bytes(32), "a", 84532, 1, SALT, set())
    assert a[1]["root"] == b[1]["root"] and a[1]["rotateAt"] == b[1]["rotateAt"]
    assert a[1]["root"] != c[1]["root"] and a[1]["rotateAt"] != c[1]["rotateAt"]
    with pytest.raises(ValueError):
        run_epoch(a[0], REAL, K, "a", 84532, 1, SALT, set())


def test_rotate_time_varies_by_epoch():
    times = [rotate_at(K, e) - epoch_window(e)[0] for e in range(1, 9)]
    assert len(set(times)) == len(times)

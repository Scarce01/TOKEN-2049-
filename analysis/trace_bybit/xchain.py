"""Bitget backtest with cross-chain tracing (Across and Stargate). Usage:
    python xchain.py --case bitget        network: NOWNodes (origin chains) + Etherscan (Ethereum); cached
    TRACE_OFFLINE=1 python xchain.py ...   offline: every read must already be in the cache

Same seed as run.py. On every origin chain in cases/<case>.json "xchain", the seed is followed forward (bridges.py);
each bridge deposit to Ethereum that is matched to its Ethereum fill becomes a cross-chain edge from
'<chain>:<sender>' to the fill recipient. Then the usual Ethereum expansion and scoring run (run.py), and the result
is written next to the single-chain one: results/<case>_xchain_result.json.
"""

import argparse
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor

import bridges
import etherscan
from run import OUT, evaluate, load, run_levels

SYMBOL, DECIMALS = "0x95d89b41", "0x313ce567"


def token_info(rpc, addr):
    # symbol and decimals do not change, so read them at latest (some nodes keep no historical state)
    sym = bytes.fromhex(rpc("eth_call", [{"to": addr, "data": SYMBOL}, "latest"])[2:])
    n = int.from_bytes(sym[32:64], "big") if len(sym) >= 64 else 0
    return sym[64 : 64 + n].decode("utf-8", "replace") or sym.rstrip(b"\0").decode("utf-8", "replace"), int(rpc("eth_call", [{"to": addr, "data": DECIMALS}, "latest"]), 16)


def stargate_pools(addrs):
    """Asset of each Stargate pool that emitted a fill, from its verified contract name on Etherscan."""
    out = {}
    for a in sorted(addrs):
        j = etherscan._cached(f"src2:{a}", lambda a=a: etherscan.call({"module": "contract", "action": "getsourcecode", "address": a}))["v"]
        res = j.get("result") if isinstance(j, dict) else None
        name = res[0].get("ContractName", "") if isinstance(res, list) and res else ""
        for key, sym in (("Native", "ETH"), ("USDC", "USDC"), ("USDT", "USDT")):
            if name.startswith("StargatePool") and key in name:
                out[a] = sym
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", default="bitget")
    args = ap.parse_args()
    cfg, truth, seed_sets = load(args.case)
    seeds = seed_sets["A"]
    x = cfg["xchain"]
    key = etherscan.env("NOWNODES_KEY")
    summary, links = {"rpc": x["rpc"], "hops": x["hops"], "chains": {}}, []
    def one_chain(chain):
        try:
            return trace_chain(chain)
        except RuntimeError as ex:  # e.g. a node without historical state: record it, keep the other chains
            print(f"{chain}: skipped ({str(ex)[:120]})", flush=True)
            return [], {"skipped": str(ex)[:200]}

    def trace_chain(chain):
        c = x["chains"][chain]
        rpc = bridges.Rpc(chain, c["url"].format(key=key), etherscan.CACHE / "xchain")
        head = int(rpc("eth_blockNumber", [], cache=False), 16)
        start = bridges.block_at(rpc, cfg["attack_ts"], head, c["lookback"])
        end = bridges.block_at(rpc, cfg["attack_ts"] + x["window_s"], head, c["lookback"]) - 1
        tokens = {}
        for addr, min_units in sorted(c["tokens"].items()):
            sym, dec = token_info(rpc, addr)
            tokens[addr] = {"symbol": sym, "min": str(min_units * 10**dec)}
        tr = bridges.OriginTrace(rpc, {"native_min": c["native_min"], "tokens": tokens}, start, end)
        reached, deposits = tr.run(seeds, x["hops"])
        matched = []
        for d in deposits:
            fill = bridges.find_fill(d, c["chain_id"], cfg)
            if fill:
                matched.append({"chain": chain, "sender": d["sender"], "bridge": d["bridge"], "origin_tx": d["origin_tx"], "origin_hop": d["hop"], "fill": fill})
        print(f"{chain}: reached {len(reached)}, deposits to Ethereum {len(deposits)}, matched fills {len(matched)}, rpc calls {rpc.calls}", flush=True)
        return matched, {
            "blocks": [start, end],
            "tokens": {a: t["symbol"] for a, t in sorted(tokens.items())},
            "reached": {a: r["hop"] for a, r in sorted(reached.items())},
            "deposits_to_ethereum": len(deposits),
            "matched_fills": len(matched),
        }

    chains = sorted(x["chains"])
    with ThreadPoolExecutor(len(chains)) as pool:  # one thread per chain; map keeps the chain order
        for chain, (matched, info) in zip(chains, pool.map(one_chain, chains)):
            links += matched
            summary["chains"][chain] = info

    # A fill paid to a pass-through contract (e.g. AcrossAdapter) is forwarded in the same tx: the real recipient
    # is the wallet that contract pays in that tx.
    for lk in links:
        f = lk["fill"]
        if etherscan.is_contract(f["recipient"], cfg["end_block"]):
            out = [e for e in etherscan.edges_from_raw(etherscan.tx_transfers(f["tx"], cfg), cfg) if e.frm == f["recipient"] and not etherscan.is_contract(e.to, cfg["end_block"])]
            if out:
                f["via_contract"], f["recipient"] = f["recipient"], max(out, key=lambda e: (e.value, e.to)).to

    pools = stargate_pools({lk["fill"]["emitter"] for lk in links if lk["bridge"] == "stargate"})
    extra = bridges.cross_edges(links, cfg, pools)
    replaced = {(e.txhash, e.to) for e in extra}
    sources = sorted({e.frm for e in extra})

    def drop(e):  # the bridge contract's own payout in a fill tx: the cross-chain edge stands for it
        return (e.txhash.split(":", 1)[0], e.to) in replaced and ":" not in e.frm

    edges, state = run_levels(cfg, seeds + sources, cfg["tau_fetch_ppm"], fetch=True, extra_edges=extra, drop=drop)
    out = evaluate(cfg, truth, seeds + sources, "A+xchain", edges, state)
    summary["cross_edges"] = [
        {"from": e.frm, "to": e.to, "asset": e.asset, "usd": e.value // 10**6, "ethereum_fill_tx": e.txhash, "log_index": e.log_index}
        for e in sorted(extra, key=lambda e: (e.block, e.txhash, e.log_index))
    ]
    summary["links"] = [{k: v for k, v in lk.items() if k != "fill"} | {"fill_tx": lk["fill"]["tx"], "recipient": lk["fill"]["recipient"], "via_contract": lk["fill"].get("via_contract")} for lk in links]
    out["xchain"] = summary
    body = json.dumps(out, indent=1, sort_keys=True)
    (OUT / f"{args.case}_xchain_result.json").write_text(body)
    r = out["ranking"]
    n = r["truth_size"]
    print(f"found {r['found_anywhere']} of {n}; in top {n}: {r[f'hits_in_top_{n}']}; missed {r['missed']}")
    print(f"sha256 {hashlib.sha256(body.encode()).hexdigest()}")


if __name__ == "__main__":
    main()

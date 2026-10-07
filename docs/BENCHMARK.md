# Qu3ee benchmark report

How far a single decoy touch gets you: tracing stolen funds from one address, following them across bridges, and
raising the alarm before an exchange notices. Measured on three real incidents with public chain data.

Version 2026-10-07. Every number carries its source:
**public on-chain** = real chain data, **testnet fork** = local fork of Base Sepolia driven by the real CRE CLI,
**test** = automated test suite, **assumed** = model or assumed parameter.

Some results come from code in open pull requests: cross-chain tracing (#4) and the spike rule (#3).

## Headline

| Result | Number | Source |
| --- | --- | --- |
| Bybit wallets on the FBI list, traced from one address | **51 of 51** within 3 hops; the FBI published 5 days later | public on-chain |
| Bitget attacker wallets, once Across and Stargate are followed | **8 to 12 of 14** | public on-chain |
| Spike rule alarm on Bitget's hot wallet | **18:58**, the minute of the first large theft; Bitget noticed at 19:05 | public on-chain |
| Flagged wallets still holding the money if the flag lands within 60 s | **94.7%** (Trek replay on Bybit) | public on-chain |

## 1. What we measured

Qu3ee plants decoys inside an exchange. When an attacker touches one, Chainlink CRE nodes tighten withdrawals on chain
and the attacker's address is shared with other exchanges. This report covers what happens next: can we follow the
money from that one address, how fast, and does the alarm fire before the exchange's own monitoring?

Every case starts from **one seed address** and uses only public chain data. Answers are scored against an outside list
the method never sees.

| Incident | Seed | Scored against | List size |
| --- | --- | --- | --- |
| Bybit, Feb 2025 | `0x47666…` | FBI PSA I-022625-PSA | 51 |
| Stake.com, Sep 2023 | `0x3130…` | FBI release, the addresses active on Ethereum | 4 |
| Bitget, Sep 2026 | `0x770b…` (Exploiter 1) | Analyst labels with at least 2 independent sources (Bitquery, Etherscan, TRM) | 14 |

## 2. Tracing back from one address

Taint spreads in time order with the **haircut** rule: a wallet that receives stolen and clean money passes on the
stolen share in proportion. The tracer understands swaps (a DEX trade that pays a fresh wallet), stops at exchanges,
bridges and contracts, and only follows wallets that are at least 50% tainted. All amounts are integers, so every run
gives the same bytes.

| Incident | Found | In top N by tainted amount | First reached after the attack | Source |
| --- | --- | --- | --- | --- |
| Bybit | **51 / 51** | 49 in top 51, 51 in top 102 | 16 min earliest, 97 min median | public on-chain |
| Stake | **4 / 4** | 4 in top 8 | 14 min earliest, about 26 min median | public on-chain |
| Bitget, Ethereum only | 8 / 14 | 8 in top 14 | 34 min earliest | public on-chain |
| Bitget, cross-chain | **12 / 14** | 12 in top 28 | new finds at 80, 192, 209 min | public on-chain |

Model comparison on Bybit (FBI wallets found by hop limit):

| Model | 1 hop | 2 hops | 3 hops | 4 hops |
| --- | --- | --- | --- | --- |
| FIFO | 40 | 40 | 40 | 40 |
| Haircut | 40 | 41 | 50 | 50 |
| **Haircut with swap awareness (used)** | 41 | 42 | **51** | **51** |

FIFO stalls at 40 of 51: the order of money inside an account is not recorded, so an attacker can choose it.

## 3. Following money across bridges

On Bitget the Ethereum-only trace stopped at 8 of 14. The missing wallets were funded by theft on Arbitrum, Optimism,
Base and BSC that the attacker bridged back to Ethereum. Those inflows looked clean, and they diluted the hub wallet
below the 50% follow line, so its children were lost too.

Method (`analysis/trace_bybit/bridges.py`, `xchain.py`):

- The same seed address is followed on every origin chain (attackers reuse one key across EVM chains), using plain
  JSON-RPC from NOWNodes.
- Every transaction an address sent is found by **bisecting its nonce** (about 21 calls per transaction). Native
  transfers are visible without an indexer.
- Bridge deposits are decoded from receipts: Across `FundsDeposited`, Stargate `OFTSent`.
- A deposit only counts after its Ethereum fill is found by the same identifier: Across by origin chain and deposit id,
  Stargate by message guid. A fill paid to a pass-through contract (AcrossAdapter) follows to the wallet it pays in
  the same transaction.
- Each matched fill becomes an edge with the Ethereum transaction and log index, the same shape the CRE verify-edge
  handler reads.

| Origin chain | Addresses reached | Bridge links |
| --- | --- | --- |
| BSC | 3 | 49 (Across) |
| Optimism | 3 | 7 (6 Stargate, 1 Across) |
| Arbitrum | 4 | 5 (Across) |
| Base | 2 | 4 (Stargate) |
| Avalanche | skipped | the node keeps no historical state |
| **Total** | **12** | **65** |

Cost: 2,671 distinct JSON-RPC calls, all cached (the free NOWNodes plan allows 100,000 a month). Two runs give the
same sha256.

**Still missed: 2 of 14.** Both sit under the hub wallet, which is now 40% tainted, still under the follow line. The
remaining clean-looking inflows come from intent bridges whose solvers pay from their own wallets (Relay, deBridge
style; about 26.8M of one wallet's 34.7M), USDC minted from the zero address (likely CCTP) and 3 Mayan fills (possibly
from Solana). None of these are decoded yet.

## 4. Following in real time (Trek)

Trek follows tainted money block by block and only **proposes** actions; it never writes to the chain. Each proposal
carries the transfer that explains the taint, so CRE can re-read it before anything is listed. Replayed on the Bybit
data (1,256 addresses, 32,690 transfers):

| Watch budget | Proposals | Delay tier | FBI wallets proposed | Lead time p10 / median / p90 | CRE queue (12 edges per 30 s) |
| --- | --- | --- | --- | --- | --- |
| 10 wallets | 57 | 52 | 51 / 51 | 79 min / 2.8 d / 4.7 d | 100% verified in time |
| 50 wallets | 1,015 | 1,010 | **51 / 51** | 96 s / 312 s / 41 min | 100%, wait 24 s max |
| Unlimited | 4,166 | 3,103 | 51 / 51 | 84 s / 216 s / 31 min | 99.8%, wait 24 s max |

Share of delay-tier wallets that have not moved the money yet, by how long the flag takes:

| Flag lands within | 12 s | 60 s | 10 min | 1 h |
| --- | --- | --- | --- | --- |
| Watch budget 50 | 100% | **94.7%** | 32.4% | 7.9% |
| Unlimited | 100% | 92.9% | 25.7% | 6.0% |

Laundering hops after the first one move money on within minutes (median 2 to 5 min), so the flag has to land in
about a minute. Source: public on-chain.

## 5. Raising the alarm: CUSUM and the spike rule

Patrol watches each hot vault's outflow per minute with CUSUM, which catches a slow rise. On Bitget it never fired at
any threshold: idle minutes inflate the baseline spread, so the 34.75M USDT minute scored only about 1.7 standard
deviations, and eight transfers over 2.5 hours never added up. The spike rule (Shewhart) is its classic companion: one
minute above a cap raises the alarm at once. The action stays soft (refill halved); raising the alert level still
needs a second signal.

Bitget, 24 Sep 2026 (UTC): test transfer 18:31, first large theft 18:58, Bitget noticed 19:05.

| Rule (cap per minute) | USDT first alarm | ETH first alarm | False alarms per day (USDT, ETH) |
| --- | --- | --- | --- |
| CUSUM only (h = 5) | none | none | 1.86 |
| Spike, 5x p99 | 18:58 | 19:01 | 0.80, 0.80 |
| **Spike, 10x p99 (suggested)** | **18:58** | **19:01** | 0.53, 0.27 |
| Spike, 20x p99 | 18:58 | 19:01 | 0, 0 |

p99 is per active minute from Bitget 6's own 4 weeks before the hack. False alarms are counted on only 3.8 days, and
20x has a thin margin (34.75M against a 28.1M cap), so 10x is the suggested default. Source: public on-chain
(`analysis/bitget_spike.py`).

## 6. System tests from the build

| What | Result | Source |
| --- | --- | --- |
| Decoy touched to freeze, end to end | alert 4, warm vault frozen, hot quota 0, receiver listed; 15 s including about 14 s of CLI compile | testnet fork |
| Decoy hit on a public chain | Ethereum Sepolia run: NOWNodes confirmed the log, trap tripped, a later approval reverted | testnet |
| Prevention layer, 8 cases through the CRE CLI | 8 / 8 | testnet fork |
| Tracing on chain (Trek proposes, CRE verifies) | 11 / 11 checks; last hop listed in 14 s | testnet fork |
| Contracts | 146 tests, 5 invariants over 262,144 random calls | test |
| CRE workflow logic | 84 tests (87 with the spike rule); the same event twice gives byte-identical reports | test |
| Decoy hit probability (10 decoys, 200 wallets, 20 probes) | 66.02% formula, 66.07% Monte Carlo | assumed |
| Quota bucket vs the Bitget theft | 6 of 7 theft transfers above the fast-lane cap | public on-chain, cap assumed |

## 7. Limits

- **Decoys can still be told apart** (AUC 0.71, target 0.65 or lower). Only 10 decoys; the generator may leak through
  activity features.
- **The quota bucket slows a split drain, it does not stop it**: by 19:05 the fast lane allows at most 16.9M against
  47.6M taken.
- **Bridges are partly covered**: Across and Stargate are decoded; intent solvers, CCTP and Mayan are not. Past those,
  tracing firms take over.
- **Bitget's truth set is analyst labels**, weaker than the FBI lists used for Bybit and Stake.
- **Trek's replay classifies with hindsight**; live it classifies as money arrives.
- **No public Base Sepolia or DON run yet**: system results come from a local fork plus one Ethereum Sepolia run.
- **Bitget's 18:31 test transfer came from a real hot wallet, not a decoy.** Any "what if it hit a decoy" is a
  hypothetical replay.

## 8. Deployment plan

None of these steps changes a contract.

Now, for the demo:

1. Merge #2 (product name), #3 (spike rule) and #4 (cross-chain tracing). The spike rule is a recorded design change
   and needs the team's yes.
2. Set the spike cap: each token's p99 per active minute from the exchange hot wallet's history (same BigQuery query as
   the Bitget baseline), times 10, in the Patrol config under `phase6.cusum.spikeMax`. Check with
   `cre workflow simulate ./patrol -T fork-settings`, then redeploy Patrol.
3. Public Base Sepolia: decide the CRE mode (DON or sim-runner), fund the deployer, run `pnpm deploy:base-sepolia`,
   commit the decoy root through the timelock ([TODO.md](TODO.md) section 1).
4. AWS: [38_phase8_aws.md](38_phase8_aws.md).

Next, cross-chain tracing in real time (about 3 to 4 days):

1. Trek on several chains: real time scans each block, so nonce bisection is not needed; plug in the Across and
   Stargate decoders from `bridges.py`.
2. A bridge edge for CRE verify-edge: read the origin receipt (deposit) and the destination receipt (fill), check the
   identifiers match, then write the derived threat. Two receipts per edge halve the batch to 6 edges per call.
   ThreatRegistry already keys entries by chain id.
3. Native transfers: verify-edge rejects them today (a receipt carries no value), yet most stolen funds on L2s moved as
   native ETH. Open question for Chainlink: can the CRE EVM client read a transaction's value by hash?
4. A paid data source: real-time scanning is about two calls per block; Arbitrum alone is roughly 700,000 a day, far
   above the free 100,000 a month.
5. Testnet demo over Across testnet (Sepolia, Base Sepolia, Arbitrum Sepolia); no mainnet funds needed.

## 9. Reproduce

```sh
cd analysis/trace_bybit
python3 run.py score --seeds A            # Bybit
python3 run.py score --case stake         # Stake
python3 run.py score --case bitget        # Bitget, Ethereum only
python3 xchain.py --case bitget           # Bitget, cross-chain (PR #4)
python3 trek.py replay                    # Trek replay
python3 ../bitget_spike.py                # spike rule (PR #3)
```

With the team's cache package unzipped into `analysis/out/`, no API keys are needed and the outputs match byte for
byte. Without it, put `ETHERSCAN_API_KEY` and `NOWNODES_KEY` in `analysis/trace_bybit/.env`.

Sources: FBI PSA I-022625-PSA (Bybit); FBI release on Stake.com (Sep 2023); Bitquery, Etherscan labels, TRM Labs,
BlockSec (Bitget); public chain data via Etherscan, BigQuery and NOWNodes.

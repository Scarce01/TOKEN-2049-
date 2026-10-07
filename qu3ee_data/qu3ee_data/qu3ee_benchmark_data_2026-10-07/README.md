# Qu3ee benchmark data (2026-10-07)

Everything here is public chain data or derived from it. No API keys are included.

## Results (`results/`)

| File | What |
| --- | --- |
| `result_A.json` | Bybit (2025-02) trace from one seed, scored against FBI PSA I-022625-PSA (51 addresses) |
| `stake_result_A.json` | Stake (2023-09) trace, scored against the FBI's 4 Ethereum addresses |
| `bitget_result_A.json` | Bitget (2026-09) trace on Ethereum only, scored against 14 analyst-labelled attacker wallets |
| `bitget_xchain_result.json` | Bitget with cross-chain tracing (Across, Stargate). Key `xchain` holds the origin-chain trace, every matched bridge link and every cross-chain edge |
| `trek_replay.json` | Trek (real-time follower) replayed on the Bybit data at watch budgets 10, 50 and unlimited |
| `trek_eval.json` | Haircut vs FIFO, minimum-edge floor, dwell time per hop |
| `bitget_spike.json` | CUSUM spike rule (Shewhart) on Bitget 6's per-minute outflow |
| `bitget_incident_labels.json` | Bitget wallets and attacker addresses with their public sources |

## Tables (`csv/`)

| File | What |
| --- | --- |
| `tracing_headline.csv` | One row per case: found, hits in the top N, candidates |
| `bitget_truth_found.csv` | The 14 Bitget attacker wallets: found single-chain or cross-chain, hop, taint |
| `bitget_xchain_links.csv` | 65 bridge links: origin chain, bridge, sender, origin tx, Ethereum fill tx, recipient |
| `bitget_xchain_edges.csv` | The same links as tracing edges with USD value |
| `bitget_origin_chains.csv` | Addresses reached on each origin chain (Avalanche skipped, reason included) |
| `bitget_spike_rule.csv` | Spike threshold vs first alarm and false alarms per day |

## Headline numbers

| Case | Found | Source |
| --- | --- | --- |
| Bybit | 51 of 51 FBI addresses within 3 hops | public on-chain |
| Stake | 4 of 4 within 2 hops | public on-chain |
| Bitget, Ethereum only | 8 of 14 | public on-chain |
| Bitget, cross-chain | 12 of 14 | public on-chain |
| Spike rule, 10x p99 | Bitget alarm at 18:58 (USDT) and 19:01 (ETH); Bitget noticed 19:05; 0.53 and 0.27 false alarms per day | public on-chain, 3.8 days of false-alarm data |
| Trek, watch budget 50 | 51 of 51 FBI wallets proposed; if the flag takes 60 s, 94.7% of delay-tier wallets have not moved on yet | public on-chain replay |

## Re-run

Code is in the repo (`analysis/trace_bybit`). From the repo root:

```
cd analysis/trace_bybit
python3 run.py score --case bitget        # Ethereum only, offline
python3 xchain.py --case bitget           # cross-chain
python3 ../bitget_spike.py                # spike rule
```

With the optional cache package (`qu3ee_trace_cache_2026-10-07.zip`) unzipped into `analysis/out/`, every run works without API keys and gives the same sha256 as the files here. Without it, put `ETHERSCAN_API_KEY` and `NOWNODES_KEY` in `analysis/trace_bybit/.env`.

## Limits

- Bitget truth is analyst labels (Bitquery, Etherscan, TRM), not an official list.
- Cross-chain: intent solvers (Relay, deBridge style), CCTP mints and Mayan are not decoded; Avalanche skipped (no historical state on the node).
- Spike false alarms are counted on only 3.8 days before the hack.
- Trek replay classifies with hindsight; live classification happens as money arrives.

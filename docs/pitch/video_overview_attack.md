# Video script: Overview tab, attack simulation (about 35 s)

Recorded on the Overview tab after a fresh Reset. Technical voiceover, about 86 words. No em dash.

| Time | On screen | Voiceover |
| --- | --- | --- |
| 0:00 to 0:05 | Calm map, bees on patrol. Caption: **Bybit, 2025-02-21: USD 1.46B** `[on-chain]`. Cursor clicks **Attack**. | Bybit, February 2025: 1.46 billion dollars gone after its signing infrastructure was compromised. |
| 0:05 to 0:11 | Timeline: *Hot wallets scanned*, *Probe transfers sent*. The hornet heads for the wallets. | Here the attacker owns the backend, scans the hot wallets, sends probes. One is a decoy only the CRE workflow knows. |
| 0:11 to 0:20 | *Decoy tripwire touched*. Hornet on the decoy, ripple from the CRE tower, then the NOWNodes tower. (Verify cut, see notes.) | Its Transfer log fires the Trap workflow: nodes re-read the receipt, NOWNodes cross-checks on public chains, CRE broadcasts one signed report. |
| 0:20 to 0:28 | *Report accepted on chain*, *Defence tightened*. Hornet caged. | QuorumReceiver executes: warm vault frozen, hot quota zero, alert CONFIRMED, attacker on the shared ThreatRegistry. |
| 0:28 to 0:35 | Reserve rises gold, red wall along the river bank, camera pulls back. Caption: **Decoy touch to freeze: 10 s · Chainlink DON, Base Sepolia, 1 run**. | No single admin key reverses it. On the live DON: ten seconds, decoy to freeze. |

## Continuous read (same words, one take)

Bybit, February 2025: 1.46 billion dollars gone after its signing infrastructure was compromised. Here the attacker owns the backend, scans the hot wallets, sends probes. One is a decoy only the CRE workflow knows. Its Transfer log fires the Trap workflow: nodes re-read the receipt, NOWNodes cross-checks on public chains, CRE broadcasts one signed report. QuorumReceiver executes: warm vault frozen, hot quota zero, alert CONFIRMED, attacker on the shared ThreatRegistry. No single admin key reverses it. On the live DON: ten seconds, decoy to freeze.

## What each technical line refers to

| Line | In the code |
| --- | --- |
| decoy only the CRE workflow knows | decoy addresses live only in CRE secrets and the Trap log-trigger config (CLAUDE.md rule 2) |
| Transfer log fires the Trap workflow | EVM log trigger at LATEST on a Transfer out of a decoy (`workflows/trap/workflow.ts`) |
| nodes re-read the receipt | `getTransactionReceipt`: the log must really exist before anything tightens |
| NOWNodes cross-checks on public chains | `eth_getTransactionReceipt` from `eth-sepolia.nownodes.io`, identical consensus; not called on the fork or Base Sepolia |
| CRE broadcasts one signed report | `writeReport` to the forwarder (real KeystoneForwarder on the DON; `cre workflow simulate --broadcast` on the fork) |
| QuorumReceiver executes | `onReport`: FREEZE warm, QUOTA_ZERO hot, ALERT 4 (CONFIRMED), THREAT to ThreatRegistry |
| No single admin key reverses it | no owner; lowering the alert takes two of three officers; config only through the timelock |

## Production notes

- On the local fork the verify step takes 40 s to 2 min (the CRE CLI compiles the workflow). Cut from *CRE verifying* to *Attack verified*, with a small caption on the cut: "verification shortened in edit".
- Caption for the whole clip: "Local fork of Base Sepolia, real contracts and CRE workflows (cre workflow simulate --broadcast)". The 10 s figure is the DON run, not this recording (README Results, testnet (DON), 1 run).
- Bybit lost its funds through a compromised signing flow, not through a decoy. The line only sets the scene: same starting point, an attacker inside the exchange. Do not say Qu3ee would have caught Bybit.
- On the fork the NOWNodes tower is visual only: a public node cannot see fork transactions. Keep "on public chains".
- The stolen-trail animation and the reserve are illustrative; do not narrate them as live tracing.
- Before recording: press Reset, reload the page, wait for the bees to resume, then click Attack.

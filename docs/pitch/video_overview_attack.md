# Video script: Overview tab, attack simulation (about 35 s)

Recorded on the Overview tab after a fresh Reset. Technical voiceover, about 88 words. No em dash.
Bybit and Bitget are the simulation's exchanges (map orgs A and B), not the 2025 incident.

| Time | On screen | Voiceover |
| --- | --- | --- |
| 0:00 to 0:05 | Calm map, bees on patrol, camera on the Bybit island. Caption: **Simulated exchanges, names illustrative**. Cursor clicks **Attack**. | This is Bybit in our simulation. The attacker owns its backend. |
| 0:05 to 0:11 | Timeline: *Hot wallets scanned*, *Probe transfers sent*. The hornet heads for Bybit's wallets. | It scans Bybit's hot wallets and sends probes. One is a decoy only the CRE workflow knows. |
| 0:11 to 0:20 | *Decoy tripwire touched*. Hornet on the decoy, ripple from the CRE tower, then the NOWNodes tower. (Verify cut, see notes.) | Its Transfer log fires the Trap workflow: nodes re-read the receipt, NOWNodes cross-checks on public chains, CRE broadcasts one signed report. |
| 0:20 to 0:28 | *Report accepted on chain*, *Defence tightened*, *Attacker shared to the network*. Hornet caged. | QuorumReceiver executes: Bybit's warm vault frozen, hot quota zero, alert CONFIRMED, attacker on the shared ThreatRegistry, so Bitget holds payouts to it too. |
| 0:28 to 0:35 | Reserve rises gold, red wall along Bybit's river bank, camera pulls back. Caption: **Decoy touch to freeze: 10 s · Chainlink DON, Base Sepolia, 1 run**. | No single Bybit admin key reverses it. On the live DON: ten seconds, decoy to freeze. |

## Continuous read (same words, one take)

This is Bybit in our simulation. The attacker owns its backend. It scans Bybit's hot wallets and sends probes. One is a decoy only the CRE workflow knows. Its Transfer log fires the Trap workflow: nodes re-read the receipt, NOWNodes cross-checks on public chains, CRE broadcasts one signed report. QuorumReceiver executes: Bybit's warm vault frozen, hot quota zero, alert CONFIRMED, attacker on the shared ThreatRegistry, so Bitget holds payouts to it too. No single Bybit admin key reverses it. On the live DON: ten seconds, decoy to freeze.

## What each technical line refers to

| Line | In the code |
| --- | --- |
| decoy only the CRE workflow knows | decoy addresses live only in CRE secrets and the Trap log-trigger config (CLAUDE.md rule 2) |
| Transfer log fires the Trap workflow | EVM log trigger at LATEST on a Transfer out of a decoy (`workflows/trap/workflow.ts`) |
| nodes re-read the receipt | `getTransactionReceipt`: the log must really exist before anything tightens |
| NOWNodes cross-checks on public chains | `eth_getTransactionReceipt` from `eth-sepolia.nownodes.io`, identical consensus; not called on the fork or Base Sepolia |
| CRE broadcasts one signed report | `writeReport` to the forwarder (real KeystoneForwarder on the DON; `cre workflow simulate --broadcast` on the fork) |
| QuorumReceiver executes | `onReport`: FREEZE warm, QUOTA_ZERO hot, ALERT 4 (CONFIRMED), THREAT to ThreatRegistry |
| Bitget holds payouts to it | org B's Cosign gate 4: a recipient on the shared list goes to PENDING |
| No single admin key reverses it | no owner; lowering the alert takes two of three officers; config only through the timelock |

## Production notes

- On the local fork the verify step takes 40 s to 2 min (the CRE CLI compiles the workflow). Cut from *CRE verifying* to *Attack verified*, with a small caption on the cut: "verification shortened in edit".
- Caption for the whole clip: "Local fork of Base Sepolia, real contracts and CRE workflows (cre workflow simulate --broadcast)". The 10 s figure is the DON run, not this recording (README Results, testnet (DON), 1 run).
- Bybit and Bitget are the map's exchange names (orgs A and B), not the real companies. Keep the caption "Simulated exchanges, names illustrative" on the opening shot: the public UI uses neutral org names so nobody reads it as Bybit being hit or being a member.
- On the fork the NOWNodes tower is visual only: a public node cannot see fork transactions. Keep "on public chains".
- The stolen-trail animation and the reserve are illustrative; do not narrate them as live tracing.
- Before recording: press Reset, reload the page, wait for the bees to resume, then click Attack.

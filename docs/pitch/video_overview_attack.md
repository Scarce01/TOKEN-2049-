# Video script: Overview tab, attack simulation (about 35 s)

Recorded on the Overview tab after a fresh Reset. About 85 spoken words. No em dash.

| Time | On screen | Voiceover |
| --- | --- | --- |
| 0:00 to 0:04 | Calm map, bees on patrol. Cursor clicks **Attack**. | An attacker has taken over this exchange's backend. Full admin access. |
| 0:04 to 0:09 | Timeline: *Hot wallets scanned*, *Probe transfers sent*. The hornet heads for the wallets. | First, they probe the hot wallets. One of them is a decoy, and only the Chainlink network knows which. |
| 0:09 to 0:17 | *Decoy tripwire touched*. Camera: hornet on the decoy, ripple from the CRE tower, then the NOWNodes tower. | The probe touches it. Chainlink CRE nodes verify the transaction independently, with NOWNodes as a second witness on public chains. |
| 0:17 to 0:24 | *Report accepted on chain*, *Defence tightened*: warm vault frozen, hot quota 0, alert CONFIRMED, attacker shared. Hornet caged. | The network writes its response on chain: warm vault frozen, hot quota zero, the attacker's address shared with every member exchange. |
| 0:24 to 0:32 | Ground flattens, the reserve rises and turns gold, coin above, red wall along the river bank. Camera holds on the reserve, then pulls back. | The hacked backend cannot undo any of it. The funds stay in reserve, the exchange sealed. |
| 0:32 to 0:35 | Whole map. Side tab: *Attack contained, Open incident*. Caption: **Decoy touch to freeze: 10 s · measured on the Chainlink DON, Base Sepolia**. | On the live Chainlink network: decoy touch to freeze in ten seconds. |

## Production notes

- On the local fork the verify step takes 40 s to 2 min (the CRE CLI compiles the workflow). Cut from *CRE verifying* to *Attack verified*, and put a small caption on the cut: "verification shortened in edit".
- Caption for the whole clip: "Local fork of Base Sepolia, real contracts and CRE workflows". The 10 s figure is the DON run, not this recording (source: README Results, testnet (DON), 1 run).
- On the fork the NOWNodes tower is visual only: a public node cannot see fork transactions. Keep the "on public chains" wording; do not say NOWNodes checked this run.
- The stolen-trail animation and the reserve are illustrative; do not narrate them as live tracing.
- Before recording: press Reset, reload the page, wait for the bees to resume, then click Attack.

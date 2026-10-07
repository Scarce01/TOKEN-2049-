# Video script, Chainlink CRE + NOWNodes flow (about 20 s)

49 spoken words, over the slide cre_nownodes_flow.png. No colons, semicolons or em dashes in the voiceover.

| Time | On screen | Voiceover |
| --- | --- | --- |
| 0:00 to 0:04 | Decoy transfer, then the "Log in CRE receipt?" diamond | A transfer out of a decoy fires the Trap workflow. CRE re-reads the receipt. |
| 0:04 to 0:09 | "NOWNodes endpoint?" then the blue "Each DON node asks NOWNodes" box | Then every DON node asks NOWNodes too, and their answers must match. |
| 0:09 to 0:13 | "NOWNodes verdict?" then the red CONTRADICTS arrow to "No action, forged event rejected" | A contradiction stops everything, so a forged event changes nothing. |
| 0:13 to 0:20 | MATCH OR DOWN into the gold "Signed CRE report", then KEYSTONE FORWARDER into "QuorumReceiver executes" | Otherwise one signed report goes through the Keystone forwarder, and QuorumReceiver freezes the vault. |

## Continuous read

A transfer out of a decoy fires the Trap workflow. CRE re-reads the receipt. Then every DON node asks NOWNodes too, and their answers must match. A contradiction stops everything, so a forged event changes nothing. Otherwise one signed report goes through the Keystone forwarder, and QuorumReceiver freezes the vault.

## What each line refers to

| Line | In the code |
| --- | --- |
| a transfer out of a decoy fires the Trap workflow | EVM log trigger at LATEST on a Transfer from a decoy wallet (`workflows/trap/workflow.ts`) |
| CRE re-reads the receipt | `getTransactionReceipt`, the trigger log must be in it, otherwise no action |
| every DON node asks NOWNodes, answers must match | `runInNodeMode` with `consensusIdenticalAggregation`, each node canonicalizes `eth_getTransactionReceipt` from NOWNodes |
| a contradiction stops everything | `secondSourceVerdict` returns contradiction, the Trap returns without a report |
| a forged event changes nothing | a trigger log that NOWNodes does not see cannot freeze anything |
| one signed report goes through the Keystone forwarder | `writeReport` to the forwarder, `QuorumReceiver.onReport` accepts only the forwarder |
| QuorumReceiver freezes the vault | FREEZE warm, QUOTA_ZERO hot, SWEEP, ALERT 4, COLD_DELAY, THREAT to the shared ThreatRegistry |

## Production notes

- "Otherwise" covers both grey paths on the slide. MATCH OR DOWN means a NOWNodes outage does not block a real hit, and NO ENDPOINT means chains without NOWNodes act on the CRE receipt alone. Say so if a judge asks.
- NOWNodes is the second source on Ethereum Sepolia (`eth-sepolia.nownodes.io`). The DON-deployed Trap on Base Sepolia takes the NO ENDPOINT path.
- "Freezes the vault" is shorthand for the whole report in the gold box. Do not add numbers to this clip. The 10 s DON figure belongs to the Overview clip.

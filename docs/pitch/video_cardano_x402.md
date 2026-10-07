# Video script, Cardano x402 paid trace (about 23 s)

59 spoken words. No colons, semicolons or em dashes in the voiceover.

| Time | On screen | Voiceover |
| --- | --- | --- |
| 0:00 to 0:04 | Sequence slide (cardano_x402_flow.png), the GET arrow highlighted | After containment, Qu3ee's Investigator agent requests a trace. |
| 0:04 to 0:09 | The 402 return arrow highlighted | The Trace Agent answers HTTP 402, one test ADA on Cardano Preprod. |
| 0:09 to 0:12 | Policy note and the gold retry arrow | Under its spend cap, the agent signs and retries. |
| 0:12 to 0:19 | Facilitator note, then submit and confirmed | The Cardano Foundation facilitator checks the signature, the amount and an unspent input, so the payment cannot be replayed. |
| 0:19 to 0:23 | Cardanoscan page of the payment, then the Cardano card on the Replay Network tab | It settles on chain and the trace arrives with its receipt. |

## Continuous read

After containment, Qu3ee's Investigator agent requests a trace. The Trace Agent answers HTTP 402, one test ADA on Cardano Preprod. Under its spend cap, the agent signs and retries. The Cardano Foundation facilitator checks the signature, the amount and an unspent input, so the payment cannot be replayed. It settles on chain and the trace arrives with its receipt.

## What each line refers to

| Line | In the code |
| --- | --- |
| requests a trace | `GET /api/trace/:address` on the Trace Agent (`services/trace-market/src/server.ts`) |
| answers HTTP 402, one test ADA on Cardano Preprod | `PAYMENT-REQUIRED` with scheme exact, `cardano:preprod`, 1,000,000 lovelace, payTo, 300 s |
| under its spend cap | `policy.ts` (1 tADA automatic, up to 10 only for a CONFIRMED case) and the SDK cap of 10 tADA per payment |
| signs and retries | `@x402/fetch` builds and signs the Cardano transaction from Koios UTxOs, retries with `PAYMENT-SIGNATURE` |
| checks the signature, the amount and an unspent input | facilitator verify (network, witnesses, TTL, nonce in inputs and unspent, fee, value, min UTxO, recipient, asset, amount) |
| cannot be replayed | the nonce is one of the transaction's own inputs, and a UTxO can be spent once |
| settles on chain and the trace arrives with its receipt | facilitator settle, then HTTP 200 with the trace and `PAYMENT-RESPONSE` (transaction hash) |

## Production notes

- The last shot needs the real Preprod payment. Fund the Investigator's payer address at the Cardano faucet (Preprod), run `pnpm cardano:investigate`, then record the Cardanoscan page and the Replay Network card it produces.
- Until then, end on the sequence slide and leave out the Cardanoscan shot.
- The trace returned is replay data (Bybit, Bitget, Stake). Do not call it a live investigation.

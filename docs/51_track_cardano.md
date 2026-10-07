# QUBEE Phase 2A: Cardano Agentic Commerce

## Track objective
Build a real Agentic Commerce vertical slice that is native to QUBEE.

Product:
**QUBEE Investigator Agent**

Primary integration:
**Cardano x402**

Optional P1:
**Masumi identity / discovery / escrow / refunds / decision logging**

Do not modify the existing Ethereum / CRE / NOWNodes containment path.

## Why Cardano belongs
QUBEE already does:

Decoy hit → confirmed receiver → containment → begin tracing.

The next real problem is that deeper investigation may require specialist services QUBEE does not own:
- chain-specific tracing
- bridge analysis
- address enrichment
- OSINT
- sanctions intelligence
- specialist forensic scoring

So QUBEE should be able to buy these services autonomously.

## P0 demo
Expose one paid forensic route:

```http
GET /api/trace/:address
```

First request without payment:

```http
402 Payment Required
```

Then:
1. QUBEE Investigator Agent reads payment terms.
2. Agent pays on Cardano Preprod.
3. Agent retries with x402 payment proof.
4. Service returns HTTP 200.
5. Service returns existing QUBEE trace output.

Example response:

```json
{
  "seed": "0x6364...",
  "linked": [
    {
      "address": "0xabc...",
      "relation": "FUNDED_BY",
      "hop": 1,
      "confidence": "LINKED",
      "evidenceTx": "0x..."
    }
  ]
}
```

## Important boundary
Cardano does NOT decide if the Ethereum attack is real.

That remains:
Ethereum + CRE + NOWNodes.

Cardano begins after QUBEE has a case worth investigating.

Correct:
CONFIRMED threat → buy deeper intelligence.

Incorrect:
Cardano payment → determines whether trap is valid.

## Architecture

```text
QUBEE Incident
      ↓
Investigator Agent
      ↓
GET /trace/:address
      ↓
HTTP 402
      ↓
Cardano x402 payment
      ↓
retry with proof
      ↓
Trace Service
      ↓
existing QUBEE/NOWNodes/Trek trace
      ↓
Trace result
      ↓
QUBEE Network / Trace Origin UI
```

## Official primitives
Use the current Cardano x402 stack:
- `@x402/cardano`
- Cardano Preprod
- official facilitator/starter where practical

Do not invent a custom x402 wire format if the SDK already provides it.

## Spend policy
Example:

```text
≤ 1 test USDM
AUTO PAY

>1 and ≤10
AUTO only for CONFIRMED incident

>10
HUMAN APPROVAL REQUIRED
```

Later, high-cost jobs can use YubiKey approval.

## Masumi P1
Only after direct x402 PASS.

Suggested flow:

```text
QUBEE Investigator
→ discover Trace Agent
→ create job
→ fund escrow
→ agent performs trace
→ result delivered
→ input/output hashes logged
→ escrow released
```

Failed delivery:
refund/dispute path.

## Suggested repo layout

```text
services/
  cardano-investigator/
    src/
      agent.ts
      x402-client.ts
      policy.ts

  trace-market/
    src/
      server.ts
      trace-route.ts
      x402-server.ts

packages/shared/
  agentic-commerce.ts

apps/console/
  components/
    PaidInvestigationCard.tsx
```

Reuse existing tracing logic. Do not duplicate it.

## Data model

```ts
type InvestigationJob = {
  caseId: string
  seedAddress: string
  requestedDepth: number
  price: string
  asset: string
  cardanoNetwork: "preprod"
  paymentTxHash?: string
  status:
    | "REQUESTED"
    | "PAYMENT_REQUIRED"
    | "PAID"
    | "RUNNING"
    | "DELIVERED"
    | "FAILED"
    | "REFUNDED"
  resultHash?: string
}
```

## Security rules
1. Agent signing keys never enter LLM prompts.
2. Never log seed phrases/private keys.
3. Preprod only during hackathon.
4. Agent spend is bounded.
5. Paid trace output does not automatically make linked addresses CONFIRMED.
6. Keep classifications:
   - CONFIRMED
   - LINKED
   - BEHAVIOR
7. Payment success is not evidence quality.

## Tests
### C01 No payment
Expected: HTTP 402 + terms.

### C02 Valid payment
Expected: payment accepted → retry → HTTP 200 → trace delivered.

### C03 Insufficient amount
Expected: no resource.

### C04 Wrong network/asset
Expected: reject.

### C05 Duplicate proof
Expected: idempotent/no double charge.

### C06 Spend policy
Expected: over-budget job does not auto-pay.

### C07 Trace evidence
Expected: evidence tx hashes present, no unsupported hacker identity claim.

### C08 UI
Expected card:
- Cardano Preprod
- provider
- amount
- payment tx
- delivered result

## Masumi tests if implemented
- M01 identity registered
- M02 discovery finds Trace Agent
- M03 escrow created
- M04 result delivered
- M05 input/output hashes logged
- M06 escrow releases after completion
- M07 failed job supports refund path

## UI
Network → Trace Origin:

```text
FORENSIC INVESTIGATION

Provider
QUBEE Trace Agent

Commerce
Cardano x402

Network
Preprod

Price
0.10 test USDM

Payment
SETTLED

Trace result
2 linked addresses

Evidence
View Cardano payment
View trace evidence
```

If Masumi:

```text
Agent identity   VERIFIED
Job              COMPLETE
Escrow           RELEASED
Decision log     RECORDED
```

## Demo script
1. Open an existing confirmed QUBEE incident.
2. Click "Deepen investigation".
3. Show price.
4. Agent calls trace API.
5. API returns 402.
6. Agent pays on Cardano Preprod.
7. Payment confirms.
8. Agent retries.
9. Trace result returns.
10. Graph adds LINKED FUNDER / UPSTREAM CANDIDATE.
11. Open Cardano explorer tx.

Pitch:
**QUBEE can automatically buy specialist forensic intelligence from other agents without a human opening accounts or managing API subscriptions.**

## Evidence to save
- network: Preprod
- payer address
- payee address
- payment tx hash
- route
- amount
- asset
- HTTP 402 summary
- HTTP 200 summary
- trace output hash

## Definition of Done
- [ ] real Cardano Preprod payment
- [ ] triggered by x402 402 flow
- [ ] retry returns real QUBEE trace data
- [ ] bounded agent spend policy
- [ ] tx hash recorded
- [ ] UI shows payment + delivered result
- [ ] no private key committed/logged

## Time budget
- 0:00–0:30 inspect starter + repo integration
- 0:30–1:30 paid trace API
- 1:30–2:30 paying client/agent
- 2:30–3:00 real Preprod payment
- 3:00–4:00 existing trace integration
- 4:00–5:00 UI + evidence
- after P0 PASS: Masumi

## Kill rules
If setup blocks >90 minutes:
- use official working starter
- keep route minimal
- do not invent custom wallet/payment infrastructure

If Masumi takes too long:
- ship direct x402 first
- keep Masumi as P1

## Codex first task

```text
PHASE 2A CARDANO: INSPECTION ONLY

Read this file and the current QUBEE repository.

Do not modify QUBEE core.

Return:
1. Exact existing trace function/API reusable behind a paid route.
2. Minimum new Cardano files.
3. Whether @x402/cardano is installed.
4. Current Preprod starter/facilitator path.
5. Required env/secrets names only.
6. Minimum wallet/payment asset setup.
7. How signing keys stay outside LLM/logs.
8. Smallest path: 402 → payment → 200 → trace.
9. Blockers.

Do not implement yet.
Do not add Masumi until direct x402 is proven.
```

## Implementation prompt

```text
Implement only Cardano P0:

existing QUBEE confirmed case
→ Investigator Agent
→ paid /trace route
→ HTTP 402
→ real Cardano Preprod x402 payment
→ retry
→ HTTP 200
→ existing QUBEE trace result
→ UI evidence card

Do not redesign tracing.
Do not modify CRE.
Do not modify NOWNodes.
Do not add Masumi until PASS.

Return:
- changed files
- commands
- payment tx
- payer/payee
- amount/asset
- 402 summary
- 200 summary
- trace result summary
- UI screenshot
- PASS/FAIL
```

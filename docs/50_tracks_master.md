# QUBEE Phase 2: Cardano + Solana Master Plan

## Goal
Extend the already-working QUBEE core without changing its security semantics.

Existing core to preserve:

Decoy → Ethereum event → Chainlink CRE → NOWNodes verification → QuorumReceiver/Vault tightening → ThreatRegistry → Trace/verify-edge → UI

Phase 2 adds:
1. Cardano Agentic Commerce: QUBEE Investigator Agent buys deeper forensic intelligence with x402.
2. Solana Enforcement: QUBEE Guard enforces confirmed threat state on Solana.

## Component roles
- CRE = security brain / orchestration
- NOWNodes = independent evidence + tracing data
- Ethereum = current protected vault environment
- Cardano = agentic investigation marketplace
- Solana = real-time cross-chain enforcement
- AWS = operations plane
- YubiKey = human recovery

## Order
### P0 Cardano
- paid `/trace/:address` route
- HTTP 402
- real Cardano Preprod payment
- retry → HTTP 200
- return existing QUBEE trace result
- show payment + trace result in UI

### P1 Cardano
- Masumi agent identity/discovery
- escrow
- refund
- input/output decision logging

### P0 Solana
- Devnet QUBEE Guard program
- Guard PDA
- Token-2022 qUSD-S mint
- Transfer Hook
- NORMAL transfer succeeds
- CONTAINED transfer fails
- Explorer evidence

### P1 Solana
- Chainlink CRE Solana Write
- Ethereum confirmed threat → CRE report → Solana Guard PDA

## Shared threat event
Use a normalized event rather than custom per-integration state:

```ts
type QubeeThreatEvent = {
  caseId: string
  sourceChain: string
  sourceTxHash: string
  suspectAddress: string
  classification: "CONFIRMED" | "LINKED" | "BEHAVIOR"
  evidenceHash: string
  issuedAt: number
}
```

Policy:
- Cardano investigation may start from CONFIRMED or LINKED.
- Solana full containment must require CONFIRMED.
- BEHAVIOR must never hard-freeze Solana.

## Non-negotiable rules
- Do not change existing Trap/Cosign/Patrol semantics.
- Do not break the current Ethereum Sepolia E2E.
- Every integration must be independently disable-able.
- No private keys/API keys in Git or UI.
- Test networks only.
- UI data must be marked LIVE TESTNET / REPLAY / SYNTHETIC.
- Stop after each acceptance milestone and record tx/program IDs.

## UI
### Network → Trace Origin
Cardano card:
- Paid Investigation
- Cardano x402
- Preprod tx
- provider
- price
- returned linked addresses

### Controls → Cross-chain enforcement
Solana card:
- Devnet
- Program ID
- Guard PDA
- NORMAL → CONTAINED
- before transfer success
- after transfer rejected

## Success
Cardano PASS:
- real Preprod x402 payment
- 402 → pay → 200
- real QUBEE trace result
- tx hash
- UI evidence

Solana PASS:
- real Devnet program
- Program ID
- Token-2022 mint
- Transfer Hook
- before succeeds
- after containment fails
- Explorer links

## Time budget
Cardano: 4–5h for direct x402; Masumi only after PASS.
Solana: 5–6h for Guard + Transfer Hook; CRE Solana Write only after PASS.

## Final story
An attacker hits a QUBEE decoy on Ethereum.
CRE verifies with NOWNodes and contains the exchange.
QUBEE then:
1. autonomously buys deeper forensic intelligence over Cardano x402;
2. propagates confirmed threat state to Solana, where protected transfers are enforced on-chain.

Machines investigate and contain automatically. Humans remain responsible for recovery.

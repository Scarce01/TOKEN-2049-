# QUBEE Phase 2B: Solana Guard

## Track objective
Build a real Solana Devnet product where QUBEE threat state is enforced on-chain.

Product:
**QUBEE Solana Guard**

Core primitive:
**Token-2022 Transfer Hook**

Optional P1:
**Chainlink CRE Solana Write**

Do not modify the existing Ethereum/CRE/NOWNodes containment path.

## Why Solana belongs
QUBEE already detects and contains an Ethereum-side incident.

The Solana extension proves:
**A threat discovered on Ethereum can change how protected money behaves on Solana.**

This must be chain-native enforcement, not a read-only dashboard.

## Qualification target
The build should:
- deploy a real Solana program or meaningful on-chain integration
- work on Devnet
- publish Program ID
- include Explorer/Solscan transactions
- have an end-to-end runnable demo
- disclose pre-existing QUBEE work
- keep Solana-specific hackathon work clearly identified

## P0 product
Create a test asset:

**qUSD-S**

Properties:
- Token-2022 mint
- Transfer Hook enabled
- QUBEE Guard program called on every transfer

Guard modes:

```text
NORMAL
CONTAINED
```

Behavior:

```text
NORMAL
→ transfer allowed

CONTAINED
→ transfer rejected
```

## Architecture

```text
qUSD-S Transfer
      ↓
Token-2022 Program
      ↓ CPI
QUBEE Transfer Hook
      ↓
Guard PDA
   ┌──┴──┐
NORMAL  CONTAINED
 allow    reject
```

Threat state path:

### P0
```text
authorized QUBEE demo authority
→ Guard PDA = CONTAINED
```

### P1
```text
Ethereum decoy
→ CRE confirms
→ CRE Solana Write
→ Keystone Forwarder
→ QUBEE Solana Program
→ Guard PDA = CONTAINED
```

## Why Transfer Hook
A Token-2022 mint configured with a Transfer Hook invokes the hook program on every transfer.

This creates a real enforcement point.

If the hook rejects:
**the transfer fails on-chain.**

Do not claim this can be retrofitted onto existing USDC.

The demo asset is qUSD-S, a new Token-2022 test mint created with QUBEE's hook.

## Guard PDA
Suggested state:

```text
version
orgId
mode
threatCaseHash
sourceChain
sourceEvidenceHash
updatedSlot
authority
```

P0 modes only:

```text
NORMAL = 0
CONTAINED = 1
```

## Minimum program instructions
- initialize_guard
- set_guard_contained
- set_guard_normal (demo reset only)
- initialize_extra_account_meta_list
- execute_transfer_hook

If Anchor is used, follow the official Transfer Hook interface and fallback instruction handling.

## Authorization
Only configured authority may change Guard state.

Required test:
wrong signer → reject.

P1:
only the expected Chainlink forwarder/report path should be able to update QUBEE threat state.

Do not allow arbitrary users to fake a cross-chain incident.

## Transfer Hook logic
On each qUSD-S transfer:
1. verify proper Token-2022 hook invocation
2. load Guard PDA
3. if NORMAL → allow
4. if CONTAINED → return program error

Do not run tracing or external API calls in the hook.

The hook enforces a decision already made elsewhere.

## P0 demo

### Before
```text
Guard = NORMAL
Alice → Bob
10 qUSD-S
SUCCESS
```

Save tx.

### Threat applied
```text
Guard → CONTAINED
```

Save tx.

### After
```text
Alice → Bob
10 qUSD-S
REJECTED
```

Same asset, same sender, same recipient.

Judge line:
**The exact same transfer works before QUBEE containment and fails after QUBEE threat state reaches Solana.**

## P1: CRE Solana Write
Only after P0 PASS.

Desired flow:

```text
Ethereum trap
→ CRE verifies
→ DON-signed threat report
→ Solana Keystone Forwarder
→ QUBEE Guard
→ Guard PDA = CONTAINED
```

This creates:
**Ethereum evidence → Chainlink CRE → Solana enforcement**

If this becomes unstable, preserve P0.

## Suggested repo layout

```text
solana/
  programs/
    qubee-guard/
      src/lib.rs
  tests/
    qubee-guard.ts
  scripts/
    create-protected-mint.ts
    transfer-before.ts
    set-contained.ts
    transfer-after.ts

packages/shared/
  solana-threat-report.ts

apps/console/
  components/
    SolanaGuardCard.tsx
```

## Demo artifact
Create:

```text
demo/solana-latest-run.json
```

Example:

```json
{
  "cluster": "devnet",
  "programId": "...",
  "mint": "...",
  "guardPda": "...",
  "before": {
    "mode": "NORMAL",
    "transferSignature": "...",
    "result": "SUCCESS"
  },
  "containment": {
    "caseId": "QRM-...",
    "sourceChain": "ethereum-sepolia",
    "stateTx": "..."
  },
  "after": {
    "mode": "CONTAINED",
    "transferSignature": "...",
    "result": "REJECTED"
  }
}
```

## P0 tests
### S01 normal transfer
Guard NORMAL → transfer succeeds.

### S02 contained transfer
Guard CONTAINED → transfer fails.

### S03 unauthorized state update
Wrong signer cannot set Guard.

### S04 unrelated mint
Non-QUBEE token unaffected.

### S05 unrelated org
Org A threat cannot freeze Org B.

### S06 idempotent containment
Applying same threat twice leaves stable state.

### S07 stale report
If P1 exists, older evidence cannot override newer state.

### S08 reset authority
Unauthorized reset fails.

## Transfer Hook integration tests
Verify:
- hook extension exists on mint
- ExtraAccountMetaList exists
- client resolves required accounts
- NORMAL transfer succeeds
- CONTAINED transfer fails
- omitting hook-required accounts cannot bypass enforcement

## Judge criteria mapping
### Technical Execution
Show:
- real Solana Program
- Guard PDA
- Token-2022
- Transfer Hook
- Devnet txs
- optional CRE Solana Write

### Innovation
Cross-chain security evidence changes asset behavior on Solana.

### Product/UX
Use existing QUBEE UI and Explorer links.

### Real-world Impact
Relevant to:
- treasuries
- payment processors
- custodians
- stablecoin issuers
- autonomous agents

### Demo
Live before/after transfer.

## UI
Controls → Cross-chain Enforcement:

```text
SOLANA GUARD
DEVNET

Program
<program id>

Asset
qUSD-S

Before threat
TRANSFER ALLOWED

Threat source
Ethereum Sepolia · QRM-...

Current state
CONTAINED

After threat
TRANSFER REJECTED
```

P1:

```text
Propagation authority
Chainlink CRE

Forwarder
...

Report
...
```

## Demo command UX
Target:

```bash
pnpm solana:setup
pnpm solana:demo
```

Expected:

```text
[01] Program ...
[02] Mint qUSD-S ...
[03] Guard NORMAL
[04] Before transfer SUCCESS
[05] Apply QUBEE threat SUCCESS
[06] Guard CONTAINED
[07] After transfer REJECTED
```

P1 adds:
`CRE Solana Write SUCCESS`

## Evidence checklist
- [ ] Devnet cluster
- [ ] Program ID
- [ ] public repo/judge access
- [ ] pre-existing QUBEE disclosed
- [ ] Solana-specific code identified as hackathon work
- [ ] normal transfer tx
- [ ] guard update tx
- [ ] blocked transfer evidence
- [ ] end-to-end demo
- [ ] README steps

## Security rules
1. No private keys in Git.
2. Devnet only.
3. BEHAVIOR similarity never causes full containment.
4. Full containment requires CONFIRMED QUBEE threat.
5. Guard state is org-scoped.
6. Program does not trust frontend state.
7. Transfer Hook does not call external APIs.
8. Cross-chain evidence is verified before enforcement.

## Time budget
- 0:00–0:30 toolchain/wallet/Devnet SOL
- 0:30–2:00 Guard program + PDA
- 2:00–4:00 Token-2022 + Transfer Hook
- 4:00–5:00 before/after Devnet transfer
- 5:00–6:00 UI + Explorer evidence
- after P0 PASS: 6:00–8:00 CRE Solana Write

## Kill rules
If Transfer Hook takes too long:
do NOT fall back to read-only Solana.

Instead build a QUBEE protected vault program that actually holds/transfers SPL assets and enforces Guard state.

If CRE Solana Write is unstable:
preserve Devnet Guard and label CRE propagation incomplete.

## Codex first task

```text
PHASE 2B SOLANA: INSPECTION ONLY

Read this file and the current QUBEE repository.

Do not modify Ethereum/CRE/NOWNodes core.

Return:
1. Solana CLI/Rust/Anchor availability.
2. Existing Solana code, if any.
3. Minimum files for Guard PDA + Transfer Hook.
4. Current official Transfer Hook packages/interfaces.
5. Steps to create qUSD-S Token-2022 mint on Devnet.
6. Minimum before/after transfer client.
7. Required Devnet SOL/accounts.
8. Whether current CRE CLI supports Solana Write here.
9. Minimum path to P0 PASS without CRE Solana Write.
10. Extra steps for P1 CRE Solana Write.
11. Blockers.

Do not implement yet.
```

## Implementation prompt

```text
Implement Solana P0 only:

Devnet Guard Program
→ Guard PDA
→ qUSD-S Token-2022 mint
→ Transfer Hook
→ NORMAL transfer succeeds
→ Guard CONTAINED
→ same transfer fails
→ Explorer evidence
→ QUBEE UI card

Do not start CRE Solana Write until all P0 tests pass.

Return:
- changed files
- Program ID
- Guard PDA
- mint
- normal transfer tx
- containment tx
- failed transfer evidence
- commands
- UI screenshot
- PASS/FAIL
```

## Definition of Done
A judge can see:

```text
same asset
same sender
same recipient

before QUBEE threat:
SUCCESS

after QUBEE threat:
REJECTED ON-CHAIN
```

and open the Devnet program/transactions in an explorer.

# QUBEE Solana Guard (devnet)

A threat QUBEE confirms on Ethereum changes how protected money behaves on Solana.

`qUSD-S` is a Token-2022 mint with a transfer hook. Every transfer calls `qubee-guard`, which reads the mint's
Guard PDA (`["guard", mint]`): NORMAL lets the transfer through, CONTAINED makes it fail on-chain. The hook only
enforces a decision made elsewhere; it never calls out. This cannot be retrofitted onto existing tokens such as
USDC: qUSD-S is a new test mint created with the hook.

## What is new for this track

Everything under `solana/`, `apps/observatory/src/components/SolanaGuardCard.tsx`, and the `solana:*` scripts in
the root `package.json`. The Ethereum side (contracts, Chainlink CRE workflows, NOWNodes verification, the
ThreatRegistry event the demo reads) existed before the hackathon track and is unchanged.

## Program

| Instruction | Who | What |
| --- | --- | --- |
| `initialize_guard(org_id)` | mint authority | creates the Guard, NORMAL |
| `initialize_extra_account_meta_list` | mint authority | tells Token-2022 to pass the Guard PDA on every transfer |
| `set_guard_contained(classification, case, chain, evidence, issued_at)` | guard authority | CONTAINED; only CONFIRMED; older evidence rejected |
| `set_guard_normal` | guard authority | demo reset |
| `execute` | Token-2022 | the hook: rejects with `GuardContained` when CONTAINED |

After setup the mint's hook authority is removed, so nobody can point the hook elsewhere and switch enforcement off.
The program's upgrade authority is the deployer key (devnet only).

## Run

Needs Docker Desktop running (the Rust/Solana toolchain runs in `solanafoundation/anchor:v1.0.2`) and bun.
Keys live in `secrets/solana/` (git-ignored).

```bash
pnpm solana:build                 # anchor build in Docker, syncs the program id
pnpm solana:validator             # local validator with the program (leave it running)
GUARD_PROGRAM_ID=<id> pnpm solana:test   # S01-S08 + bypass and authority checks, against the local validator
pnpm solana:deploy                # devnet, paid by secrets/solana/deployer.json (about 2.5 SOL)
pnpm solana:setup                 # qUSD-S mint, Guard, Alice and Bob; writes solana/devnet.json
pnpm solana:demo                  # before SUCCESS, contain, after REJECTED; writes the UI evidence
```

`pnpm solana:demo [sepoliaReportTx]` reads that Ethereum Sepolia receipt first and refuses to contain unless it
emitted `ThreatAdded`; the Guard stores that event's evidence hash. Default: the CRE trap report in
`docs/STATUS.md` (S7).

Next (P1): Chainlink CRE Solana Write, so the Guard accepts reports only from the production Keystone forwarder.

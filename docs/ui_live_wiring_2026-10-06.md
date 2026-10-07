# Figma UI (localhost:8443) ↔ backend: what is live, what is not

Date: 2026-10-06. UI: `C:\Users\xuziy\Downloads\Quorum` (Vite SPA). Backend: the Base Sepolia fork deployed from
this repo (`deployments/base-sepolia-fork.json`), read directly over viem from the browser.

New file `src/live/chain.ts` holds a viem public client, the fork addresses, minimal ABIs, `readLive()` /
`readThreats()` and a `useLive()` hook. It reads **public chain state only**; the decoy/trap list stays
officer-only (CLAUDE.md rule 2) and is never read from this unauthenticated bundle. Every read falls back to the
existing mock so the design still renders when the chain is offline.

## Wired to live now

| Where | Backend read | Shown |
| --- | --- | --- |
| Sidebar badge (every page) | `getBlockNumber`, Receiver `mode` | green/red/amber dot, `backend live · block N`, SIM/PROD |
| Vaults — 4 metric cards | hot/warm/cold `balanceOf(qUSD,qETH)`, `quota`, cold `delay`, Receiver `alert` | real per-org-A balances, quota, release delay, alert level |
| Vaults — selected vault panel | `balanceOf`, `quota`/`cap` ratio, `frozenUntil` | real balance line, quota meter, "frozen" tag |
| (adapter ready, not yet placed on a page) | `hourCap`/`dayCap`, `alertExpiresAt`, `lastPing`, `activeConfirmedCount`, `ThreatAdded` logs | — |

Verified against the fork: block 47.75M, alert Normal, mode SIM, hot vault 96,900 qUSD, quota 2,000 / cap 5,000.

## Not visualized (still mock data on the page)

These pages exist but show invented numbers; the backend data is available but not wired.

| Page | Backend that should feed it (events / views) |
| --- | --- |
| Overview | step timeline, live event feed (`WithdrawalRequested`, `VerdictRecorded`, `Tightened`, SSE) |
| Incidents / Case detail | `ponder_quorum.cases`, `chain_events` per case; sealed-reason decrypt |
| Requests (RequestBoard) | `WithdrawalRequested`, `VerdictRecorded`/`Held`/`Cancelled`, `signerKindOf`, gate reasons |
| Traps & Decoys | `quorum_index.traps` (officer-auth route only — not from this bundle) |
| Workflows | `ReportProcessed`, `Ping` per workflow; run durations (CRE side) |
| Execution | `ReportProcessed`, `Tightened`, `ActionFailed` |
| Approvals | `officer_signatures` + `ManualQueued`/`QueuedCancelled`/`QueuedExecuted` from OfficerDesk |
| Registry | `ThreatAdded` (adapter has `readThreats()`, not yet bound to the drawer shape) |
| Network | per-org state (live), member acks (no backend) |
| Config & Timelock | `ConfigQueued/Executed/Cancelled`, `WorkflowSet`, `ThresholdCommitted/Revealed`, `CapSet`, `WindowCapsSet` |
| Reports & Audit | no generator exists |

## Backend functions with NO page anywhere in this UI

- **User keys / recovery (docs/47 3.4, 3.6, 3.7):** `KeyRegistered`, `KeyRotated`, `KeyChangeRequested`,
  `RecoveryApproved`, `FactorRegistered/Queued/Cancelled`, `LargeNewFloor`, `PasskeyNewFloor`, `UserCancelled`.
- **Deposits:** `Deposited`, DepositVault balances.
- **Keeper service:** delayed approvals it pays when due.
- **Notifier service:** the user-facing messages it composes.
- **Trek tracing:** the forward trace proposals and the back-trace to source (no incident-tracing page here).
- **Reconciliation / patrol detail:** `AssetCheckpoint`, `AssetResetQueued/Executed`, `PlannedOpRegistered`,
  CUSUM checkpoints (the Vaults "reconciliation" block is mock).
- **Red-team ranking / scanner:** attacker-visible wallet ranking (`services/redteam`).

## Why the rest is not wired in one pass

The Figma UI holds its data as per-page inline constants (invented members, node names, case numbers) plus
`src/components/mock.ts`, not a single data layer. Binding each page means reshaping live data into those exact
shapes and, for officer-only data (traps, metrics, cases), running the Console API with an auth bypass or a
dev endpoint. The two cleanest, non-secret, chain-only pages (Vaults, global status) are done; the rest are
listed above in priority order.

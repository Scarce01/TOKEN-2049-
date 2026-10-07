# Figma UI (Downloads/Quorum) vs backend: link map and gaps

Date: 2026-10-06. UI source: Figma Make export (Vite + React SPA, `src/pages/*`, all data from `src/components/mock.ts`,
`data.ts` and inline arrays). Backend: this repo (contracts, QuorumLens, Ponder `ponder_quorum`, Supabase
`quorum_index`, Console API routes in `apps/console/app/api/*`).

Status key: **have** = backend already serves it; **route** = data exists on chain or in Ponder, only an API route or
query is missing; **missing** = backend does not produce it; **conflict** = showing it breaks a design rule.

## 0. Architecture point first

The UI is a client-only SPA. Every officer-only read (traps, sealed reasons, metrics) must go through a server route
that checks the officer JWT (CLAUDE.md rule 2: no decoy identifier in any frontend bundle). Today `mock.ts` ships
decoy refs inside the bundle; with real data that would fail D29.

Recommended: port the UI pages into `apps/console` (Next.js, existing auth, existing `/api/*`). Alternative: keep Vite
and call the Console's `/api/*` with the Supabase session token (needs CORS and the same `requireOfficer`).

## 1. Page by page

| UI page | What it shows | Backend source | Status |
| --- | --- | --- | --- |
| Overview (3D hive, steps, events) | Attack story steps with times, live event feed | `/api/timeline`, `/api/stream` (SSE of `chain_events`) | have (needs mapping: node lights from event names) |
| Overview KPIs (Panels) | counts, levels | Lens `patrolView` + `/api/cases` | route |
| Incidents | case list with Active / Investigating / Contained / Resolved | `/api/cases` (`ponder_quorum.cases`) | have list; **missing** case status workflow (no status column) |
| Case detail | story, actions done, audit log, related | `/api/cases/[id]` (events + trap), `Tightened`, `ReportProcessed` | have; audit log of officer actions = `officer_signatures` (route) |
| Requests | withdrawal list, state, gate, reason, account panel | `WithdrawalRequested` + `VerdictRecorded` in `chain_events` | **route** (`/api/requests` not built) |
| Requests: account panel | key status, notBefore, last key change, deposit, proof | `KeyRegistered`, `KeyChangeRequested`, `Deposited` (indexed) | route |
| Requests: invalid / forged detail | recovered signer vs registered key | RequestBoard stores signer (0 if invalid); KeyRegistry `keyOf` | route |
| Traps | decoy list, type, state, hits, last hit, commit | `/api/traps` (`quorum_index.traps`) | have list; **missing** hits count, deployed date, per-decoy commit (DecoyCommit not indexed) |
| Vaults | balance, quota, cap, freeze, timelock, reconciliation history | Lens `patrolView` (balances, quotas, caps, frozenUntil, checkpoints, assets), ColdVault `delay` | route; USD needs price feed; reconciliation history **missing** (PatrolState not indexed) |
| Workflows | 3 workflows, runs, checks, inputs, outputs | `ReportProcessed` / `Ping` events per workflow | partial; run duration, p50, per-node results **missing** |
| Execution | report received, routed to modules, tx | `ReportProcessed(caseId, kinds)`, `Tightened`, `ActionFailed` | route |
| Approvals | two-person actions, signed by, required, expiry | `officer_signatures` + `ManualQueued` / `ConfigQueued` / `QueuedExecuted` | route; officer display names **missing** (no address to name table) |
| Registry | threat entries, fingerprint, expiry, source | `ThreatAdded` (indexed), `entryOf` | route; "consumed by N members" **missing** |
| Network | members, ack time, enforcement level | 2 orgs in Lens (`receiverOf`) + `activeConfirmedCount` | partial; acks **missing** |
| Config | change history, policies, integrity | `ConfigQueued/Executed/Cancelled`, `Tightened`, vault `configHash`, threshold commit/reveal | route |
| Reports | downloadable reports | none | **missing** |
| DesignSystem | colour swatches | n/a | n/a |

## 2. Lacking: UI needs it, backend does not provide it yet

Ordered by how much of the UI it unblocks.

1. **API routes** (data already indexed): `/api/requests` (request + verdict + account), `/api/vaults` (Lens
   `patrolView`), `/api/registry` (ThreatAdded), `/api/config` (timelock + Tightened), `/api/approvals`
   (officer_signatures + queued actions), `/api/execution` (ReportProcessed + Tightened + ActionFailed).
2. **Ponder does not index DecoyCommit, PatrolState, OfficerSet** (also flagged in the alignment review). Needed for
   trap commits, reconciliation history, threshold commit/reveal, planned ops.
3. **Case status** (Active / Investigating / Contained / Resolved): new `quorum_index.case_status` table written by
   officers. On-chain state cannot express it.
4. **Officer names**: table mapping officer address to display name (Supabase, officer-readable only).
5. **Trap stats**: hit count, deployed date, last hit, per-decoy commitment. trap-sync can fill `hits`, `deployed_at`.
6. **USD values**: price feed read per token (Lens already returns `priceAnswer` for Cosign; vault view does not).
7. **Workflow run log**: per-run duration, result, ref. Option: sim-runner writes one row per simulate run into
   `quorum_index.metrics` or a new `workflow_runs` table. A DON deploy exposes this only in the CRE UI, not on chain.
8. **Reports**: no generator. Smallest version: export a case (events + actions + signatures) as Markdown or PDF.

## 3. Excess: UI shows it, backend does not have it (decide: cut, relabel, or build)

| UI element | Why it is excess | Recommendation |
| --- | --- | --- |
| 38 network members, Kestrel Custody, Meridian DAO, Sable Agents, Orbit, Vela Prime, ack times, "consumed 36/38" | Backend has 2 orgs; ThreatRegistry has no acknowledgement mechanism | Show the 2 exchanges; label others "illustrative" or cut |
| DON node names (Kraken-CRE, Figment...), "7/7 nodes", per-node results | Contracts only see the Forwarder; node list not available; Mode B has no DON | Cut, or show "DON report accepted" only |
| Decoy types API key and Credential (DK-03, DC-09), "lure" score, "Rotating" state | D07 decoy credentials is P2 and cut; no lure score anywhere | Cut or mark "planned" |
| Warm vault "40% flow", "Cosign-only 6h" | No such modes; vaults have freeze, quota, cap | Replace with frozenUntil and quota/cap |
| Gate list: Destination age, Velocity, Patrol reconciliation | Our 7 gates: 1 txHash, 2 Safe tx / token / vault, 3 signer / fields / expiry, 4 decoys and shared list, 5 approved and deposit, 6 price, 7 hidden cap x level | Rename to the real gates (10_interfaces.md) |
| Reason codes THREAT_MATCH, QUOTA_ZERO, KEY_DELAY, RETRO_MATCH, TIMELOCK_HOLD, BOARD_MISMATCH, SIG_REPLAY | Real codes are numeric (11, 21, 31, 42, 43, 51, 61, 62, 71) | Map to real codes |
| States Escalated and Held | Chain has APPROVE / PENDING / REJECT plus manual release | Collapse into PENDING (with manual-release status) |
| RETRO_MATCH rejection, cluster tracking, "6 chains", bridge and DEX traces | Tracing (D31) not built; non-EVM reconciliation (D38) out of scope | Cut |
| Request sources "Agent wallet", "DAO Treasury", "multisig 3/5" | Only exchange submitters exist | Cut |
| Report ids like "#78452", "Entry #4,118", "RB-310944" | Real ids are bytes32 (caseId, requestId); registry has no sequence number | Show short hashes, or add a display counter in Ponder |
| Reports page (SOC 2 pack, 42-page PDFs) | No generator | Keep one case export, cut the rest |
| Cold vault "1.84M ETH / $4.77B", balances in ETH, USDC, WBTC, USDT | Testnet tokens are qUSD and qETH only | Use real token set |

## 4. Conflicts with design rules (must change before real data)

1. **Rule 2 / D29**: decoy refs (`0x5c11…`, `acct QA-114 (decoy)`, threshold `cfg.review_eth`) are in the client bundle.
   Real decoy data must only come from an officer-checked server route.
2. **D15**: PENDING reasons are indistinguishable on chain (publicReason 0); the reason is in `sealedReason`, readable
   only after an officer decrypts it. The UI prints reasons for everyone. The Console case page already has an unseal
   box; the Requests page needs the same.
3. **Hidden threshold** (D21): UI shows "band 2 upper 40 → 36 ETH". The current epoch's threshold must never be
   shown; only past, revealed values.
4. **Rule 8**: every number must carry its source (testnet measured / public on-chain / assumed). The UI has no
   source labels.
5. **Rule 9**: check UI strings for em dashes before porting (mock uses `—` for empty values).

## 5. Backend has it, UI does not show it

| Backend feature | Where | Missing in UI |
| --- | --- | --- |
| Officer login and role gate | `/login`, `requireOfficer` | No login page or auth |
| Officer signing (EIP-712, 2 of 3, digest used once) | `/control`, `lib/wallet.ts`, `/api/signatures` | Approvals is read-only, no sign button or wallet connect |
| Sealed reason decryption | `cases/[id]` unseal | Not in Requests or Case detail |
| Evaluation metrics with source | `/evaluation`, `quorum_index.metrics` | No page |
| Controls: threshold commit vs reveal check, vault configHash vs Patrol, Receiver whitelist | `/control` | Config page has static "integrity" rows only |
| Alert level per org with expiry countdown | Lens `alert`, `alertExpiresAt` | Not shown |
| Asset conservation checkpoint (V high-water mark) | PatrolState | Not shown |
| Timeline first point "marked here" (D43) | `/api/timeline` | Overview steps are static |
| Two exchanges side by side | Lens per org | Network shows invented members |
| Mode (SIM / PROD), last Ping (liveness) | reads.ts `mode`, `lastPing` | Not shown |

# STATUS (Claude Code updates this after every task)

## Current phase

**2026-10-07:** `integrate/all-features` (protection-layer + R7, the three feature commits from create-detect-decoy, audit fixes, CRE verify-edge on-chain tracing, end-to-end tests on the simulated chain) was, at the user's request, **pushed directly to main without a PR**. Test and audit results: [AUDIT_2026-10-07.md](AUDIT_2026-10-07.md); remaining work: [TODO.md](TODO.md).

Phase 1 code done (beta repository, not the competition repository). Phase 2 and 3 code for contracts, workflows, backend, Console and user-app is also written.
Testnet deployment, CRE simulate and E2E scenarios are waiting on: `cre login`, Base Sepolia test tokens, email addresses for 3 officers.

`pnpm verify:design --phase 1` (2026-10-05, local): fail 0, not-yet 2 (D28 seed acceptance, D30 DET; both need testnet and CRE login).

| Component | Status | Evidence |
| --- | --- | --- |
| Contracts v0 (contract part of phases 1 to 3, incl. SWEEP, QUOTA_ZERO, COLD_DELAY, THREAT, VERDICT, manual slow lane, refill, topUp) | Done | forge: all 73 tests pass (incl. 5 invariants I1, I2, I3, I6, I7) |
| packages/shared | Done | 15 tests; the four vectors EIP-712, txHash, workflow name, OfficerAction match forge |
| workflows trap / cosign / patrol | Done (not simulated) | 27 WU tests; all three compile to WASM with `cre workflow build` |
| Supabase (cloud qqummzczdiatpagdvkge) | Done | 3 migrations pushed; all 22 permission tests pass |
| exchange-api, decoy-admin, datasets, indexer, trap-sync, sim-runner | Done | Seed flow runs end to end on Anvil; Ponder indexes 172 events on Anvil |
| Console, user-app | Done (not connected to testnet) | `next build` passes |
| verify:design | Done | reports/design-conformance.md |
| Red-team scripts | scan / attack | `pnpm redteam:scan` only reads the local `GET /admin/hot-wallets` (20 rows; fields label, chain, address, kind, status, balance; no privateKey, and no decoy / trap / honeypot). Ranking rule: kind=eoa and qUSD balance at least 1, highest balance first. Probes go through `POST /admin/hot-wallets/transfer`; private keys stay in exchange-api. Does not read secrets, quorum_index or workflow config |
| Round 3.5 integration demo | Single command `pnpm demo:e2e` | New org on Ethereum Sepolia (resetBlock 11854730, receiver `0x223f22DA260598E914DBbb7828a1807017266596`, hot `0xD793dB0588B4AbcB3aED729C31d3D9f268BEc7Ae`). Start state: alert 0, hot quota 5,000 qUSD, warm not frozen, attacker's recipient address not suspect. After scanning 20 wallets, the top three by balance each receive a 1 qUSD probe; one of them trips the Trap (the decoy's label, rank and probe transaction are recorded only in secrets/, rule 2; audit 2026-10-07 H3). CRE report `0xd0346dcf01df2d6015a4c07cb64b56496497f92d5902317ced40ab5354da1896` (block 11854759, NOWNodes and Trap A both pass). Afterwards: alert 4, quota 0, warm frozen, recipient address suspect. Approval report `0xb45f92592c5d90737b2b16a031388c2bc34f2cffa327fe0839757439ba2f1e4e`. The 500 qUSD hot wallet execute `0x12d4c40665ef3733c97535525e2fae97467a9590dfb2b2755e67024a854e2da1` (block 11854763) fails; replay data `0x685a21ef` (AlertConfirmed). Still on PGlite. The public Anvil submitter cannot hold ETH, so the demo uses EIP-7702 with the deployer paying gas; RequestBoard still sees the original submitter |
| Phase 4 to 6 contracts (DecoyCommit, PatrolState, ThreatRegistry requires proof, SCORE compare-and-swap, threshold commit and reveal) | Done | forge: all 91 tests pass (18 new in phases 5 and 6) |
| Phase 5 Cosign (SPRT score, hidden threshold, gate 5 in USD, gate 6, gate 7) | Done (not simulated) | 41 Cosign WU tests, incl. D50 fixed-point vs floating-point reference |
| Phase 6 Patrol (three handlers: epoch, quota, reconcile) | Done (not simulated) | 19 Patrol WU tests; all three workflows still compile to WASM |
| decoy-admin commit (salted Merkle, padded to 2^k) | Done | Measured on Anvil: 10 decoys, 16 leaves; proofs written into trap / cosign config; leaves share vectors with DecoyCommit.leafOf |
| Console Timeline page | Done | `next build` passes |
| Offline analysis | Done | D39 formula 66.02% vs 100,000-run simulation 66.07% (difference 0.05 percentage points); D52 three strategies, 2,000 runs each |

`pnpm verify:design` (all phases, 2026-10-05, local): fail 1 (D28 decoy AUC, see Open decisions); everything else not passing is not-yet (needs testnet or CRE login).

## CRE run mode

- [ ] Mode A (DON deployment)  - [ ] Mode B (sim-runner + SIM mode)
- Basis for decision:

## Contract addresses (Base Sepolia)

| Contract | Address | Deployment block |
| --- | --- | --- |
| | | |

## External addresses

| Item | Value | Source |
| --- | --- | --- |
| ETH/USD Price Feed (Base Sepolia) | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` (8 decimals, heartbeat 1200 seconds, deviation 0.15%) | Chainlink docs and on-chain read, checked 2026-10-05 |
| ETH/USD Price Feed (Ethereum Sepolia, fallback) | `0x694AA1769357215DE4FAC081bf1f309aDC325306` (8 decimals, 3600 seconds, 1%) | Same as above |
| KeystoneForwarder (Base Sepolia) | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | CRE docs; contract code present on chain; still to be cross-checked with `cre workflow supported-chains` (needs login) |
| MockKeystoneForwarder (Base Sepolia) | `0x82300bd7c3958625581cc2f77bc6464dcecdf3e5` | Same as above |
| MockKeystoneForwarder (Ethereum Sepolia, fallback chain) | `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` | CRE docs; not listed in 31_phase1.md; use this one when switching chains |

## Spike results

| # | Conclusion | Notes |
| --- | --- | --- |
| S1 | | |
| S2 | | |
| S3 | | |
| S4 | | |
| S5 | | |
| S6 | Feasible (partial) | Base Sepolia has an ETH/USD feed (see table above); reading latestRoundData over public RPC works; CRE callContract reads wait on simulate |
| S7 | | |
| S8 | | Only needed for Mode A |
| S9 | | Measure how many entries filterLogs returns (BATCH_LOGS) and the patrolView response size; whether state at latest − 40 and latest − 150 can be read |
| S10 | | Whether events over the log trigger rate limit are dropped or queued (Mode A) |
| Bitget backtest | Done | Wallets and the 8 stolen transactions: docs/research/bitget_2026-09.md (cross-checked against multiple sources); baseline and per-minute series in datasets/public/; analysis/bitget_cusum.ts; conclusions in Open decisions |
| S7 NOWNodes | Done | 2026-10-06: the Start plan has no Base Sepolia; `https://base-sepolia.nownodes.io` returns nginx 404. `eth_chainId` on `https://eth-sepolia.nownodes.io` is `0xaa36a7`. The full Ethereum Sepolia contract set has been broadcast; addresses in `deployments/ethereum-sepolia.json`. One decoy sent out 1 qUSD (transaction hash recorded only in secrets/, rule 2; audit 2026-10-07 H3). `cre workflow simulate ./trap --target staging-settings --broadcast` log: `nownodes status=1 logs=1`, `trap A tripped`, report transaction `0x8a16e65f11ebcf65ee21b500af784bf567e680e47fa4677c3d82a7918547b5e5`. On chain: alert=4, hot vault qUSD quota went from 5000000000 to 0, warm vault frozen, ThreatRegistry marked the recipient address suspect. After adding a valid APPROVE, hot vault `execute` `0xf3dffa31fe9476ff0822aa0357c2a3eac756312e45da52d8c84298beb1ae2fe9` reverts with `AlertConfirmed`. No local database, so the `wallets`/`register` table writes were skipped; staging config generated by `configs` from `secrets/decoys.local.json` |
| BigQuery H0 | Done | Project stock-data-484313; each query about 17 to 25 GB (free quota 1 TB / month); results in datasets/public/h0_binance_2026-09.json; 14 metrics written to metrics |
| CRE quotas | | Output of `cre workflow limits export` (verify/cre_limits.json); ask a Chainlink mentor on site whether limits are relaxed for the competition |
| pg_partman | Available | `pg_available_extensions` on Supabase Cloud returns pg_partman 5.3.1 (2026-10-05) |
| S4 (partial) | WASM build passes | noble hashes / curves / ciphers and seal can all be bundled into WASM by `cre workflow build`; runtime behavior can only be confirmed with simulate (needs login) |

## Measured metrics

| Metric | Value | Source type | run_id |
| --- | --- | --- | --- |
| trap_to_freeze_seconds | | testnet_measured | |
| request_to_verdict_seconds | | testnet_measured | |
| lat_include / lat_trigger / lat_exec / lat_report / lat_execute | | testnet_measured | |
| cosign_queue_delay_p95 (load-normal --rate 1.0) | | testnet_measured | |
| sim_runner_max_rate (Mode B) | | testnet_measured | |
| rows_per_day_estimate / db_mb_per_day_estimate | | testnet_measured (extrapolated proportionally) | |

## Open decisions (待决定)

- **Phase 2 tracks: Solana and Cardano (started 2026-10-07):** Plans in docs/50_tracks_master.md, 51_track_cardano.md, 52_track_solana.md. Deviations from the plan, for the team to confirm: (1) paid tracing (services/trace-market) returns "received tainted funds from this address" (RECEIVED_TAINTED_FROM, traced downstream, each entry with an evidence transaction); the tracing engine does not support the plan's FUNDED_BY (upstream funder), and we do not invent it; (2) the two UI cards live in apps/observatory (Replay's Network, Controls page), not apps/console; (3) the shipped Solana Guard is `solana/programs/qu3ee_guard`, built with the locally installed Anchor 1.2.1 (Rust 1.99, Solana CLI 4.3), deployed to devnet, program `HaJ4J8KhE5FGfBFpgrwkqXk6yXfdjNYJpLjJ71KGrEXz`, 16/16 tests pass; `solana/programs/qubee-guard` (Docker image, Anchor 1.0.2) is not deployed (declare_id is still a placeholder); (4) in P0 the Solana Guard is set to CONTAINED by a separate Guard authority key (secrets/solana/authority.json, not in git, separate from the deployer); only in P1 does it switch to accepting only the CRE production forwarder (the simulation forwarder must not be allowed, otherwise anyone could freeze via simulate --broadcast); (5) Solana's containment evidence uses a real DON Trap report on Base Sepolia `0x32ab0635…834f` (block 47,802,234, case `0x83461333…625f`): the demo script first reads the receipt and confirms that KeystoneForwarder's ReportProcessed result is 1 and Receiver's ReportProcessed includes FREEZE and THREAT, and only then writes to the Guard (latest result in demo/solana-latest-run.json, evidence page https://qu3ee-solana-proof.vercel.app)
- **Two Solana versions coexist (2026-10-07, pending Ziyu's decision):** on main, `solana/programs/` contains both `qu3ee_guard` (deployed, submitted) and `qubee-guard` (not deployed). The merge took the qu3ee_guard versions of `solana/scripts/lib.ts`, `demo.ts`, `Anchor.toml`, `package.json`, `README.md`, so `containIx`, `initGuardIx`, `keypair` etc. referenced by `tests/qubee-guard.test.ts` and `scripts/setup.ts` no longer exist, and `bun test tests` errors on that file; `anchor build` also builds both programs (Anchor 1.2.1 and 1.0.2). Recommendation: keep qu3ee_guard (the submitted version), and remove qubee-guard, its tests and setup.ts or move them to `solana/archive/`; any ideas worth keeping (e.g. setup.ts handing over the mint authority) get merged into qu3ee_guard afterwards
- **Receiver contract size:** after 47 stage 2, runtime is 21,431 bytes, about 3.1 KB below the 24,576 limit. Before R7 targeted freeze or any further features, officer actions (HOLD, CANCEL, MANUAL, LOWER_ALERT) must first be split into a separate contract
- **R7 protected lane (47, D112):** Done, off by default (see Design changes). Still for the team to decide: (1) writing the freeze semantics back into proposal section 4; (2) whether Trap's FREEZE or QUOTA_ZERO should also zero the lane quota pBudget (currently Trap cannot shut the lane); (3) whether lane releases should also be bound by the R8 hourly and daily caps (currently not); (4) R7 is not yet in the invariant handler
- **46 two budget classes and trust levels (TRUSTED / GENERAL, T1 to T3):** 3.6 not done. Needs KeyRegistry to record key age, vaults to bucket by class, and Patrol to refill each separately (across three contracts); first set ADDRESS_MATURE_AGE and KEY_TRUST_AGE (46 section 21 suggests 7 days / 7 days; demo 3 minutes / 1 hour). seenAt is already on chain, so mature addresses can be computed at any time
- **47 risk framework (docs/47_risk_framework.md section 8):** L_pub (suggested $4M / 1,300 ETH, demo 5,000 qUSD / 4 qETH) and D_LARGE (suggested 1 hour); when R2 moves from shadow to enforce; stage 2 contract changes (R2 contract floor, targeted freeze, three-tier quota buckets, per-withdrawal HOLD). Stage 1 is implemented, awaiting team confirmation on whether to keep it

- **CUSUM cannot catch Bitget-style "a few huge transfers" (Bitget backtest, public_onchain):** baseline built from Bitget 6's own 4 weeks before the incident; the same Patrol CUSUM run per minute from 2026-09-21 to 09-24 22:00. For h from 5 to 40 there is no alarm after the incident; normal false alarms are 1.86 per day at h = 5 and 0.27 per day at h = 12. Reason: after taking log2 per minute, the minute with $34.75M has z of only about 1.7 (σ is large because of many idle minutes); the 8 stolen transfers are spread over 2.5 hours and the idle minutes in between pull S back to 0. The CUSUM in proposal §6 F is designed for "slow ramp-up" and structurally cannot see this pattern. Should we add a rule "soft tighten when single-minute outflow exceeds H0 p99.99" (or a check on single-transfer amount)? This is a new rule; we do not add it on our own. **Added 2026-10-07 (requested by chunloong):** CUSUM spike rule (36_phase6.md 6.3), see Design changes; disabled by default, spikeMax set by each deployment's config
- **Effect of quota buckets on the Bitget day (public_onchain r_max + assumed C = 5 × r_max):** of 7 stolen transfers, 6 individually exceed C and would go to manual review instead of the fast lane; if the attacker splits into small transfers, by 19:05 (Bitget detection) the fast-lane upper bound is $16.9M + 2,435 ETH, versus actual theft of $47.6M + 7,131 ETH; by 19:16 the upper bound is $32.3M + 4,667 ETH. The team must set the multiple for C
- **Bitget's test transfer (18:31) came from the real hot wallet Bitget 6, not a decoy:** the video and pitch must not say "Quorum would have caught it at 18:31", only "if the attacker had tested on a decoy wallet first, it would have tightened at that moment". Bitquery notes that the stolen transactions used a fixed gas limit of 100,000 / 200,000 while normal withdrawals use about 63,000; this may be another signature (not verified, not implemented)

- **Re-estimating λ with H0 (BigQuery, Binance 2026-09, source = public_onchain):** "new recipient address" accounts for 40.6% (stablecoins) / 61.4% (ETH) of real withdrawals; assuming the attacker always uses a new address, λ = ln(1/0.406) ≈ 900 (consistent with the proposal's assumed value), about 490 for ETH. "Hugging the fake threshold" is only 0.0044% (stablecoins) / 0.026% (ETH) of real withdrawals, far below the 0.5% assumed in the proposal; with P(s|H1) = 50%, λ ≈ 7,560, so a single signal would reach L3 (all PENDING). Should λ change? Until decided, keep 4605
- **H0 comes only from Binance:** of the 9 verified exchange addresses, only Binance 14/15/16 had outflows in 2026-09 (the Coinbase, OKX and Kraken addresses had none), so H0 equals "Binance's withdrawal distribution". Also, only transfers among these 9 addresses were excluded; large internal moves from Binance to its other cold wallets may still be in the tail (above p99.9)
- **The demo scaling is an assumption:** real Binance 14 per-minute outflow p99 is about $2M; the demo hot vault r_max is 1,000 qUSD per minute, so the CUSUM baseline μ is shifted as a whole by log2(1000 / 2,001,780) ≈ −10.97 (ETH −11.52), σ unchanged. This scaling only puts demo-scale flow on the same z scale; it is not a measurement

- ~~**Tracing ground truth incomplete**~~ Resolved (2026-10-06, PR #9): seed set A (only `0x47666`) and B (Verichains' 7) are reported separately, and the seeds themselves are not counted in the denominator. With a single seed, 1 hop finds 41 and 3 hops find all 51, so "underestimates the first hop" does not hold. Details in docs/research/tracing_backtest.md
- **Bitget backtest is missing addresses:** public sources have no complete Bitget hot wallet addresses, so the 6.6 same-day Bitget CUSUM backtest and worst-case loss comparison cannot be done (per the docs: "if no credible label can be found, skip it; do not guess addresses"). A chart can be made from the verified timeline only
- **D44 false positive rate:** synthetic traffic gives A 5.8%, B 12.0%; confirmed to be mainly a problem of the synthetic model (no re-deposits). With real Binance withdrawals from BigQuery scaled by the same ratio, gate 7 at L0 sends about **14 per 10,000 withdrawals** (0.14%) to PENDING; with the L1 account cap halved, about 0.6% (stablecoins) / 0.26% (ETH). At Binance's daily volume (about 21,800 withdrawals) that is about 30 manual reviews per day. These are written to metrics (public_onchain; the scaling is assumed)

- **D28 decoy AUC misses target (synthetic data, source = assumed).** analysis/decoy_auc.py: across all 110 accounts, balance alone separates the decoys (decoys are placed at the top by design, proposal 6 A); comparing only within the top 60 an attacker would pick, logistic regression AUC 0.706, gradient boosting 0.578, bootstrap 95% interval upper bound 0.884, target ≤ 0.65. Two things for the team to decide: (1) with only 10 decoys the interval is inherently wide, and "upper bound ≤ 0.65" is nearly impossible with a single batch of decoys; should it change to "mean AUC over multiple regenerated batches" or a larger sample; (2) the point estimate 0.706 means the generation method still leaks (probably regDays / activity jittered directly at ±20% of top accounts, correlated with balance); should decoy-admin's sampling change. Until decided, D28 stays fail and the assertion is not changed
- **Decoy generator (docs/48_decoy_generation.md, 2026-10-07):** the new generator passes the two-sided threshold 8 / 8 on 1,000 synthetic accounts (max AUC interval upper bound 0.613), but the 100 demo accounts have only 19 rows in the attractive band, so the threshold fails, and at ρ_max 15% only 1 decoy fits. To decide: (1) whether D28 adopts the new generator's criteria (band union, two-sided [0.35, 0.65], honeyword ≤ 0.35) or keeps the old ones; (2) whether to grow the demo exchange's account pool to about 1,000; (3) generator plans are written to `secrets/decoygen/` (not in git, same directory as decoys.local.json); rule 2 only names decoys.local.json, should this directory be listed too; (4) applying a plan (writing exchange_*, registering Trap, ConfigTimelock submitting the new root) replaces the root holding the sample decoys; when to do it; (5) the thresholds and ρ_max, the 2-period warm-up, and 20% monthly rotation are all assumed values
- The SAFE block tag uses -4 (go-ethereum convention); the SDK only exposes finalized (-3); spike S9 must confirm on Base Sepolia
- Second data source for gate 6: S7 confirmed NOWNodes has only Ethereum Sepolia, not Base Sepolia, so on Base gate 6 still only does "price stale"; "data sources agree" stays waived (D14.6)
- **Correction (measured 2026-10-07):** NOWNodes does have a Base Sepolia node (`base-sepolia.nownodes.io`); our key lacks access (response "You do not have access to this node"); the same key works for eth-sepolia and Base mainnet. Base Sepolia must be enabled for the key in the NOWNodes dashboard, then 84532 added to NOWNODES_URL in `workflows/trap/src/logic/nownodes.ts`; only then does the Trap on the public chain have a real second data source. Transactions on the local fork exist only on this machine and no public node can see them, so on the fork the second data source always shows "not applicable" and must never show as agreeing (rule 8)
- A CUSUM alarm currently only halves the refill amount; "one more independent signal raises to L1" (second part of D55) is not done yet; first need to define which signals count as independent (PENDING 51, fingerprint hit)

- exchange-api queueing: the docs say pg-boss; currently the withdrawals table itself serves as the outbox and workers claim rows with `FOR UPDATE SKIP LOCKED`; same effect (no lost orders on crash, no duplicate submissions), one fewer dependency, and no extra schema permissions needed. Switch back to pg-boss?
- The Supabase Cloud project is in us-east-1 (docs say ap-southeast-1). The team decided not to move it; the cost is a database round trip of about 200 to 250 ms, which only affects the Console and backend, not on-chain tightening.

- Gate 5 multiplier: the proposal says 1.5 (to allow for trading profit); the competition version uses 1.0 (1.5 makes the "register first + self-deposit" attack profitable). Write back to the proposal?
- Slow lane during the confirmed level: the fast lane stops entirely; after the warm vault freeze expires, officers can release with two signatures + queue. Consistent with proposal section 5; please confirm
- **Open items from audit 2026-10-07 (docs/AUDIT_2026-10-07.md):**
  - When NOWNodes is "unavailable", Trap tightens as usual based on the CRE receipt (current implementation). The alternative is to throw so the trigger retries, and tighten as usual after N blocks; team to confirm which
  - A decoy that has been tripped can be traced back on the public chain from the suspect recipient address, so it must be rotated before the next demo; old commits still contain the decoy label and probe transaction, and history cannot be rewritten
  - Trap queries NOWNodes by transaction hash only when a decoy is touched, so NOWNodes' access logs could accumulate a decoy list (not confirmed whether NOWNodes logs this); could switch to eth_getBlockReceipts by block number (response size to be measured)
  - Synthetic hot wallets are all new addresses while decoy addresses have older on-chain history; checking nonce and first transaction time tells them apart (fingerprint)
  - Console and user-app treat every chain other than 31337 as Base Sepolia; shared has no CHAIN_ID or CRE chain name for Ethereum Sepolia
- **Open items from verify-edge (implemented 2026-10-07):**
  - Derived chains have no depth limit: on chain we only know "the parent is suspect", not which hop it is; Trek only proposes delay within 3 hops, and CRE cannot verify the hop count
  - Dusting is blocked only by the minimum amount: a suspect can still send an innocent address more than the floor and get it marked as a derived suspect (its withdrawals go PENDING 42, not frozen)
  - Native coin edges not supported (the receipt has no amount); supporting them needs getTransactionByHash or trace
  - Trek's `trek.py watch` only works on mainnet: evidenceHash uses chainId 1 and history goes through Etherscan. Forked chains use fork_source.py; needs chunlong to confirm (handoff not yet sent)
  - Reply to issue #17 (to be sent after user approval): Q1 native coin is currently rejected; Q2 Trap's evidenceHash is in the ThreatAdded event (= keccak256(abi.encode(chainId, txHash, logIndex))), Trek can read it from the event; Q3 payload: see 10_interfaces "patrol verify-edge"; Q4 vault delay is not decided by verify-edge, derived suspects get PENDING 42 from Cosign gate 4; Q5 demo uses `pnpm demo:trace`

## Questions for Chainlink mentors at the event

- Will CRE quotas (log trigger 10 events per 6 seconds, 15 EVM reads per execution, etc.) be relaxed during the competition? Even if relaxed, we only tune parameters (quota buckets, batch size), not the architecture; every number stated publicly is measured under default quotas
- Are events over the log trigger rate limit dropped or queued (S10)
- In a cron handler, is each node's latest aligned beforehand

## Interface change log (接口变更记录)

- OfficerAction nonce: each signed action (EIP-712 digest) can be used only once, as replay protection; no separate per-officer incrementing counter. Signatures must be passed in ascending signer address order; the same officer signing twice counts as one
- `consumeVerdict(txHash, userIdHash, to)` returns `(manual, notBefore)`: userIdHash and to are passed so the Receiver can record seenRecipient
- Manual releases are stored separately in `manualOf[txHash]` and do not overwrite the existing verdict (preserves I2 "decision never changes"); Cosign's APPROVE takes precedence, otherwise the manual release is used
- `VerdictRecorded(txHash, decision, caseId, requestId, publicReason, sealedReason)`: three more fields than the docs, so Ponder and Console need not parse report calldata
- One Receiver per org (orgId fixed at construction); the report envelope's orgId must match
- Circular dependencies in deployment order are resolved with a one-time initialize, in four places, each callable once and only by the deployer: Receiver (vaults, cold wallet, ThreatRegistry), ThreatRegistry (reporter and protected addresses), OfficerSet (ConfigTimelock), ConfigTimelock (manageable target contracts)
- ConfigTimelock can only call registered target contracts; adding a target also has to be queued through ConfigTimelock itself
- ColdVault.raiseDelay does nothing (does not revert) when given a value not greater than the current one, so repeated confirmed-level reports stay idempotent
- KeyRegistry: KeyBinding nonce increments per userIdHash; new `officerCancel` (CANCEL_QUEUED, one officer suffices)
- RequestBoard: when the signature format is invalid, signer is recorded as 0, no revert (Cosign rules REJECT 31)
- sealedReason format: one envelope per officer = ephemeral public key 33 bytes ‖ nonce 12 bytes ‖ ciphertext 254 bytes ‖ tag 16 bytes; plaintext = 2-byte length ‖ JSON ‖ zero padding, so the length is fixed (D15)
- Officer signatures are written through a Console server route: first verify the officer's JWT, then `SET ROLE authenticated` with that JWT's claims, so RLS still decides (migration 20261006000200; console_svc joins authenticated with INHERIT FALSE)
- The Receiver and vaults newly deployed by reset-demo are not in ConfigTimelock's target list: changing their config later requires queueing addTarget first
- Each Trap log trigger holds at most 5 decoy wallets and 10 decoy addresses (enforced by config schema)
- Receiver.initialize now takes one struct: hot, warm, cold, ThreatRegistry, DecoyCommit, PatrolState
- PLANNED_OP (kind 8) and RESET_ASSET_CHECKPOINT (kind 9) live in PatrolState (verifyingContract for officer signatures = PatrolState), not Receiver: Receiver contract size has only about 6 KB headroom left; the PlannedOpRegistered event is also emitted by PatrolState
- DecoyCommit's initial root is written at construction (DECOY_ROOT_A / B, from decoy-admin commit); later root changes go through ConfigTimelock; ThreatRegistry requires proofs only when the DecoyCommit address is passed at construction (deployment env THREAT_REQUIRE_PROOF); phase 2 deployments may skip it
- QuorumLens.cosignView takes an extra parameter scoreKey (computed first by Cosign with K) and returns score; patrolView additionally returns hotCheckpoints and assets per org; new plannedOps(fromHour, toHour)
- Trap log handler adds 1 NOWNodes `eth_getTransactionReceipt` call (HTTPClient, key is secret `NOWNODES_KEY`). If the receipt does not contain the same trigger log, no report is written. `decideTrap` rules unchanged. Read budget: 10_interfaces.md section 9, trap / log row
- Salt salt_i = HMAC(K, "decoy" ‖ uint32 i); THREAT proof = abi.encode(ident, salt, path); ident is the left-zero-padded address for wallets and userIdHash for accounts
- Hidden threshold is per token: T_e = T_min + HMAC(K, "thr" ‖ uint64 e ‖ token) mod (T_max − T_min); nonce_e = HMAC(K, "thrnonce" ‖ e ‖ token)
- Score ciphertext = nonce 12 bytes ‖ AES-GCM(abi.encode(Λ, tLast, pendingCount)); Λ stored in thousandths of a nat; γ^h table stored in ppm (h = 0 to 72, zero afterwards)
- 47 R7 (2026-10-07): QuorumVault protected lane (off by default, enabled by timelock via setProtectedLane). During freeze/confirmed periods, only "mature address (seenAt) + amount ≤ smallCap + separate quota R" is released, with R refilled every minute; SWEEP leaves the reserve in place; two-officer co-signed releases are still blocked by a hard freeze. Trust level T3 skipped (not done). D112. Audit 2026-10-07: matureAge(address) per token; new error BadLane (lane on with matureAge 0 or reserve above cap, or lane off with reserve not 0)
- 47 step 3.7 (2026-10-06): KeyRegistry constructor takes an extra `recoveryDelay`; new rotateKey (co-signed, immediate), approveRecovery, registerSecondFactor / finalizeSecondFactor / cancelSecondFactor, secondFactorOf, pendingFactor; requestKeyChange now waits recoveryDelay; cancelKeyChange also accepts the second factor; KeyAction 4 to 7. See 10_interfaces.md section 3.7
- 47 step 3.6 (2026-10-06): RequestBoard.signerKindOf; Receiver Config adds passkeyNewDelay (immutable after deployment), event PasskeyNewFloor, view seenAt, error KeyChanged (consumeVerdict's APPROVE path checks that the signer is still the registered key). See 10_interfaces.md section 3.6
- 47 step 3.5 (2026-10-06): services/notifier; migration 20261006000400 adds role notifier_svc and table quorum_index.notify_channels (pushed to Supabase Cloud); D108. Limitations: events during downtime are not re-sent; per-user delivery URLs are currently written manually by quorum_svc; user self-registration (signed) is left for later
- 47 step 3.4 (2026-10-06): passkey. lib/WebAuthn.sol; sig in KeyRegistry and RequestBoard accepts a 65-byte ECDSA signature or a WebAuthn blob; RequestBoard adds view `webauthnSigner`; key id = the address of keccak(qx, qy); exchange-api adds `POST /keys/register` (forward only); packages/shared webauthn.ts. See the passkey section of 10_interfaces.md. The browser side (navigator.credentials) has not been tested in a real browser; the contract and software-authenticator paths have tests
- 47 step 3.3 (2026-10-06): Receiver adds `userCancelVerdict(txHash, deadline, sig)` and `cancelDigest`, EIP-712 type CancelWithdrawal (domain QuorumReceiver v1); event UserCancelled; shared vector cancelDigest. See the last section of 10_interfaces.md
- 47 step 3.2 (2026-10-06): Receiver's officer actions moved to OfficerDesk (one per org); Receiver keeps only desk-only primitives; for these actions OfficerAction's verifyingContract becomes the desk; deployments JSON adds `desk` per org; **old deployment files have no desk and must be redeployed**. See the last section of 10_interfaces.md
- 47 stage 2 (2026-10-06, contracts): RequestBoard.recipientOf; Receiver Config adds largeNewDelay, holdMax, largeNewTokens, largeNewMins, setLargeNewMin (timelock), holdVerdict (one officer, OfficerAction kind 10), cancelVerdict (two officers, kind 11), heldUntil; QuorumVault Config adds hourCaps, dayCaps, setWindowCaps (timelock). Details in the last section of 10_interfaces.md
- 47 stage 1 (2026-10-06): Reason adds 73 R7_LARGE_NEW (sealed); Cosign config phase5 adds d2Delay, d3Delay, largeNew {mode, delay, minAmount}; APPROVE expiresAt becomes (notBefore or block time) + VERDICT_TTL; SprtParams adds singleSignalCap
- All 5 Patrol triggers are always registered (0 ping, 1 decoys, 2 epoch, 3 quota, 4 reconcile) and toggled via config, so sim-runner can rely on fixed trigger indexes
- ThreatRegistry: `expiresAt` is at most block.timestamp + MAX_TTL (7 days, which covers THREAT_TTL 72 hours); confirmed-level entries are counted in buckets by expiry hour, and `activeConfirmedCount()` reads at most 169 buckets instead of scanning all history (security review High 2). Entries expiring in the current hour are over-counted until the end of that hour (biased toward tightening, < 1 hour)
- Trap: a Transfer with amount 0 never trips (both A and B; ERC-20 transferFrom(x, y, 0) needs no allowance, so anyone can forge this log. Security review High 1)

## Design changes (设计变更): record when the implementation deviates from the proposal, with D number, reason and approver

Known deviations of the build docs from proposal_v4, pending team confirmation; once confirmed, write them back to the proposal:

| D | Deviation | Reason | Approved by |
| --- | --- | --- | --- |
| D14.5 | Gate 5 multiplier 1.5 → 1.0 | 1.5 makes "register first + self-deposit" profitable | |
| D13 | Video 1:55 "same technique goes straight to L2" → a single fingerprint only reaches L1; only say "same address goes to manual review" | Consistent with the base-rate argument in §6 E: a single weak signal does not raise to L2 | |
| D06 | Decoy address trips only when "the money was paid from our vault" | Otherwise a stranger could remotely freeze the exchange by sending a small amount | |
| D55 (6.3) | CUSUM plus a single-minute spike rule (Shewhart): when x_t > spikeMax, S is set to h + spikeHold; action unchanged (only halves the refill amount) | In the Bitget backtest CUSUM never alarms for any h; the spike rule at 10× p99 alarms at 18:58 (USDT) and 19:01 (ETH), with 0.53 / 0.27 false alarms per day over the 3.8 days before the incident (analysis/bitget_spike.py) | Requested by chunloong; pending team confirmation |
| D03, D28 | Decoy wallets only receive, never send (activity history is inbound only) | Otherwise the decoy's own outbound transfers would trip falsely; the cost is that nonce is always 0, which is a giveaway | |
| D19 | PROD mode does not check workflowId, only owner + encoded name + kind allowlist | The ID changes whenever the workflow config changes | |
| D24 | Automatic quota refill is in phase 6 (proposal lists it as P0) | Phases 1 to 5 use the initial quota set at construction; the demo restores it with reset-demo | |
| D14.6 | Gate 6 "data sources agree" waived, only "price stale" | NOWNodes has no Base Sepolia (confirmed 2026-10-05); 35_phase5.md 5.4 says to record it as waived in this case and not compare data across different chains | |
| D38 | No non-EVM multi-chain reconciliation | Outside the 36-hour scope; only an XRP decoy (P2) | |
| D20 | Receiver and ThreatRegistry use a one-time initialize to resolve circular dependencies | Required by deployment order; locked after the call, noted in the permission list | |
| Demo | Fake threshold "50 ETH" scaled down to 5 qETH, real threshold 1 to 3 qETH | Test token amounts; the video states it is scaled down | |
| D17 | Bytecode scan stops after the last INVALID when the remaining length is a multiple of 32 bytes | via-IR appends 32-byte constants after the code, whose bytes may happen to be 0xf2 / 0xf4; the scanner has unit tests proving a real DELEGATECALL is still caught | |
| D58 | CUSUM state is not written on chain every minute: a checkpoint is written every 10 minutes, and the minutes in between are recomputed from the vault's per-minute buckets (outRing) | Saves storage writes (about 150 per day, not 1,440); report count unchanged (same report as QUOTA_REFILL); result identical to per-minute (D58 check) | |
| D10 | Cosign has only one handler, using LATEST (the build docs earlier described SAFE + a LATEST fast handler for decoys) | log trigger rate limits are per workflow; SAFE adds a few minutes per withdrawal; reorgs are blocked by the contract's three checks (42_performance.md section 2) | |
| D55, D58 | CUSUM baseline is fixed (168 sets in config, recomputed offline) instead of proposal §6 F's EWMA online learning | Checkpoints only need to store S, and recomputation always equals per-minute; a "boiling frog" cannot raise the baseline; the cost is periodic recomputation as business volume grows | |
| D26 | Reconciliation changed from "match each withdrawal against logs" to "asset conservation"; "every Executed has an APPROVE" is left to the contract and invariant I1 | Log reads grow with traffic, the limit is undocumented, and hoarded APPROVEs can overwhelm it; the conservation check reads two numbers. Added vault.fund() and ASSET_CHECKPOINT; seen at the anchor only soft-tightens, seen at SAFE goes to confirmed level (D61, D65) | |
| D29 | Labels for decoy EOAs, real ops EOAs, the real allowlist and decoy recipient addresses all come from the same random generator in datasets/src/labels.ts; the real allowlist is no longer in seed.sql; each new allowlist row rewrites the whole table in random order, so identity ids do not reveal decoys | Labels and insertion order were hard-coded in the repo, so anyone with exchange_a could compare against the repo and mark the decoys (alignment review blocker 1); files 20_data, 32_phase2, 36_phase6 updated to match | |
| D29 | BUNDLE scan now also covers all tracked files and the entire git history, and compares labels; when the local machine has no decoy list it records not-yet instead of pass | Alignment review blocker 3 | |
| Rule 10 | verify:design: D items not registered in 40_verification.md record fail; registered local tests that cannot be found (renamed or deleted) record fail instead of not-yet; registered the missing D04, D05, D07, D14.6, D14.7, D31, D43, D44, D46, D49, D51, D54 | Alignment review blockers 2 and 3, test results review | |
| D14.7, D42, D05, D22 | Gate 7 and score changed from "PENDING to manual review" to "delayed APPROVE, paid automatically when time is up" (D1 / D2 / D3); shared list, balance and price stay PENDING | About 30 manual reviews per day with no deadline (Binance volume, public on-chain data); now every withdrawal has an expiry. Cost: a delayed ticket can only be stopped by freezing the vault; per-withdrawal HOLD added in 47 stage 2. See docs/47 | |
| D05, D22 | thresholdHug λ 4,605 → 7,560, plus a single-signal cap (cannot reach L3) | Real data: the share of normal users hugging the threshold is 0.004% to 0.03%, the original 0.5% setting was too high (one of the Bad results); the single-signal cap prevents one signal alone from reaching L3 | |
| D20, D09 | Officer actions split from Receiver into OfficerDesk | Receiver at 21.4 KB had only 3.1 KB left below the 24 KB limit, not enough for stage 3 contract changes; after the split Receiver is about 14 KB. Security semantics unchanged: signature verification and queueing in the desk, state checks in Receiver, Receiver only accepts the desk fixed at initialize | |
| D105 | New services/keeper: automatically submits payment once a delayed release is due; exchange-api now retries after 60 seconds on NotYetValid, Held, QuotaExceeded, WindowExceeded, Frozen, AlertConfirmed (previously QuotaExceeded was recorded as manual and the rest as failed, so delayed releases never paid out) | Found only after stage 2: "funds arrive automatically when time is up" did not hold in the full system | |
| D103, D104 | New: one officer can hold a single withdrawal (expires, with cooldown), two officers can cancel; vault hourly and daily withdrawal caps (off at deployment, enabled via timelock) | A delayed withdrawal could previously only be stopped by freezing the whole vault; attacks split into small amounts need time-window caps as a backstop | |
| D102 | New 47 R2: delay for large payments to new addresses, running in shadow mode first | Hits all 6 Bitget theft transfers, affects about 0.08% of normal withdrawals (analysis/risk_tradeoff.py, public on-chain data plus assumptions); measure the false-hit rate from shadow logs before going live | |
| D62 | New: per-org submission quota bucket on RequestBoard, resubmit, backlog check (not in the proposal) | An untrusted backend could flood the shared Cosign with junk requests and crowd out decoy account triggers | |
| Demo | `GET /admin/hot-wallets` no longer returns privateKey. The 1 qUSD probe now goes through `POST /admin/hot-wallets/transfer`; private keys are decrypted only inside exchange-api | Round 3.5: avoid the story reading as "all hot wallet private keys leaked". A compromised backend signing path is enough | User request |
| D112 | 47 R7 protected lane: during freeze or confirmed level, "mature address + amount ≤ smallCap + separate quota R (refilled every minute)" is still released; SWEEP leaves the reserve. Off by default, enabled via timelock | User request 2026-10-06: keep a small channel open for normal users while tightened. Worst-case outflow per vault per token: cap + per-minute refill × frozen minutes | Pending team confirmation; proposal section 4 must be updated |
| D112 | Audit 2026-10-07: matureAge now per token; with the lane on, matureAge must be > 0 and reserve ≤ cap; with it off, reserve must be 0 (otherwise revert BadLane); seenAt is read before consumeVerdict | The original matureAge was a global value that any token could overwrite; with matureAge = 0 an address never paid before also counted as mature; reserve had no cap and could weaken SWEEP | |
| D01, D48 | Trap second data source (NOWNodes): endpoint selected by chainId; on a chain without NOWNodes, only the CRE receipt is used. With an endpoint, "contradiction" (receipt exists but the log does not match or status is not 1) still takes no action (D48); "unavailable" (null receipt, HTTP error, non-JSON, inconsistent results across nodes) tightens as usual based on the CRE receipt | Audit H1, H2: in the original implementation a decoy on Base Sepolia never froze anything; NOWNodes lagging one block, going down or rate limiting would all disable tightening (violates rule 6) | Pending team confirmation (see Open decisions) |
| Demo | staging-settings in workflows/project.yaml keeps RPCs for both Base Sepolia and Ethereum Sepolia | create-detect-decoy switched staging entirely to Ethereum Sepolia, so sim-runner could not simulate on Base (alignment review blocker) | |
| D29 | Balances and labels of attacker-visible hot wallets are now generated from secrets/visible-wallets.layout.local.json (same generator as labels.ts) instead of being in the datasets source; e2e reads it only after the probe; STATUS removed the decoy label, rank and probe transaction | Audit H3: the repository revealed directly which wallet was the decoy (rule 2) | |
| D28, 6 A | New analysis/decoygen: strategy library + Plackett-Luce, band SMOTE + jitter + density-ratio resampling, DCR bound, two-sided AUC threshold and honeyword, greedy maximin placement (HMAC randomized), standby pool / promotion / rotation / burn, new salt and new root each period, live mode (127.0.0.1:8791). Produces plans only; does not touch the chain or the sample decoys | Old decoy-admin sampling AUC 0.706, D28 fail; the user asked for a generator following the 5-step design, and to watch decoys being generated and retired in the UI | Pending team confirmation (see Open decisions) |
| D51, 6.4 | Implemented patrol verify-edge (trigger 5, HTTP): each edge proposed by Trek is verified by CRE reading its receipt; besides docs/36 6.4's "transfer exists, from/to/amount match, parent entry valid", also "the parent address itself is suspect at the anchor" and a per-token minimum amount; derived entries last 24 hours, with evidence and expiry computed by the workflow itself; native coin edges not supported yet | Prevents a compromised Trek from pairing any real transfer with a valid parent proof to mark an innocent address; prevents dusting; docs/36 says 24 hours, Trek proposes 72 hours, the design doc prevails | Pending team confirmation |

## Review log (independent review results per phase)

| Phase | Date | High | Medium | Resolution |
| --- | --- | --- | --- | --- |
| All (1 to 6) | 2026-10-05 | 3 (security) + 3 blockers (alignment) + 5 (test results) | Several | Reports in docs/reviews/. Fixed in v1: zero-value transfers tripping the trap, unbounded ThreatRegistry count, hard-coded decoy labels, verify missing registrations and "missing counts as passed", no contract test for D42 notBefore. KeyRegistry key-change hijack (High 3) fixed in 3.7: recovery must wait recoveryDelay, the second factor or the current key can cancel, key rotation requires co-signing; the rest in docs/43_addon_review_fixes.md and the three reports |

## Cut P2 items and roadmap

- XBlock MulDiGraph ranking test
- Shadow mode (ShadowReceiver)
- Full attacker strategy library (Monte Carlo for strategies 3, 5, 6)
- Non-EVM multi-chain reconciliation
- Batched requests + Merkle verdicts (about 60 per second, batch size pending S9); tiered small-amount authorization (42_performance.md section 3)
- Deep tracing: off-chain multi-hop search; CRE's verify-edge handler verifies each edge before writing a derived THREAT (36_phase6.md 6.4)
- Database partitioning (pg_partman or native partitioning + pg_cron), old data converted to Parquet on S3
- eRPC (optional in phase 8); multiple submitter private keys sharded by userIdHash

## External facts to verify before the competition

| Item | Source | Result |
| --- | --- | --- |
| FBI Bybit address list (count, publication date) | https://www.ic3.gov/psa/2025/psa250226 (I-022625-PSA, 2025-02-26) | **51** Ethereum addresses, imported into `datasets.fbi_bybit_addresses` (2026-10-05) |
| Bitget hot and warm wallet list | BlockSec: https://blocksec.com/blog/bitget-hack-laundering-fund-tracing (2026-09-30, incident 2026-09-24, loss about $387.5M) | **BlockSec does not list wallet addresses**; only one truncated hot wallet was found (Scorechain), unusable. Timeline (UTC) verified: test transfer 18:31, large outflow 18:58, detection and withdrawal suspension 19:05, last transfer 21:23, site shutdown 21:44 |
| Bybit attacker seed addresses, malicious Safe transaction hash | Verichains preliminary report, Etherscan | Malicious transaction `0x46deef0f52e3a983b67abf4714448a41dd7ffd6d32d32da69d62081c68ad7882` (block 21895238, 2025-02-21 14:13:35 UTC, operation = 1); Safe `0x1Db92e2EeBC8E0c075a02BeA49a2935BcD2dFCF4`; 7 seed addresses. Details in docs/research/public_data_sources.md |
| Exchange hot wallet labels | Etherscan name tags | 9 addresses in total across Binance, Coinbase, OKX and Kraken, imported into `datasets.benign_labels`; the tags only say which exchange an address belongs to, **not whether it is a hot or cold wallet** |
| Bitget outflow of about $228M in the first 18 minutes | **Source is Arkham** (reported by Bitcoin.com News), not BlockSec | Cite Arkham when quoting |
| Circle's position on USDC freezes | Circle's own words | Not verified |

# TODO (2026-10-07, after `integrate/all-features` was merged into main)

Current state: the protection layer, decoy detection, cross-exchange propagation, on-chain tracing (Trek + CRE verify-edge) and patrol all run end to end on the **simulated chain** (a local anvil fork of Base Sepolia)
with CRE CLI `simulate --broadcast` (see [AUDIT_2026-10-07.md](AUDIT_2026-10-07.md)). Below is what is still missing, in go-live order.
When you tick an item, record the evidence in [STATUS.md](STATUS.md).

## 1. Prerequisites for the AWS deployment (must be in place before 38_phase8_aws.md)

- [ ] **Decide how CRE runs** (the STATUS entry "CRE run mode" is still empty): option A, DON deployment (needs `cre account access`), or option B, sim-runner + SIM mode. The AWS design is written for option B (sim-runner container + `CRE_API_KEY`)
- [ ] **Public Base Sepolia deployment**: `deployments/base-sepolia.json` does not exist yet (there are only fork, anvil and Ethereum Sepolia now). Needs a deployer with test funds; `SIM_OPERATOR` must equal the address of the CRE key in workflows/.env; `pnpm deploy:base-sepolia`
- [ ] Decoys on the public chain: decoy-admin generates them and submits the DecoyCommit root through ConfigTimelock (on the fork, fork-demo/setup.ts does this; the public chain needs the formal process, using only secrets/)
- [ ] NOWNodes has Base Sepolia nodes, but our key does not have access: once access is enabled in the NOWNodes dashboard, add 84532 to NOWNODES_URL, and only then does Trap on the public chain have a second data source (never applies on the local fork, see STATUS)
- [x] The 8443 UI has been moved into the repo: `apps/observatory` (`hexmap.html` is in the repo root). Still to decide: whether Amplify deploys `apps/observatory` or `apps/console`
- [x] `packages/offchain/scripts/fork-demo/` (setup, bridge, patrol) committed

## 2. The AWS deployment itself (38_phase8_aws.md)

- [ ] A Dockerfile for each service: exchange-api (A, B), indexer (Ponder), trap-sync, sim-runner (with the `cre` CLI and Bun installed in the container), **keeper**, **notifier** (these two were added after 47 and are not yet in the architecture table in 38; add them to the design)
- [ ] `infra/` AWS CDK (TypeScript): VPC, ECR, ECS cluster, each Fargate service, ALB, Secrets Manager, CloudWatch
- [ ] Supabase Cloud: `supabase link`; `supabase db push` to push all migrations (`20261006000300_synthetic_withdrawals` and `20261006000400_notifier` have never been pushed to the cloud); recreate roles and passwords (including the keeper and notifier roles); create officer accounts
- [ ] Secrets Manager → each ECS task: exchange-api gets no Quorum role; the Console server side has only `console_svc`; CRE secrets stay only in the sim-runner .env or the Vault DON
- [ ] Amplify: console, user-app, with only the anon key and public addresses
- [ ] CloudWatch alarms (the five in 38): Trap report failure, indexer lagging or stopped (missing data counts as an alarm), sim-runner with no patrol for 5 minutes, ActionFailed, database growth
- [ ] After deployment: `pnpm verify:design --env aws` (the CLI already supports `--env`); security re-check (the anon key cannot read quorum_index or exchange_*; no decoys or service key can be found in the Amplify bundle; in SIM mode the Console shows a persistent banner at the top)
- [ ] Wrap-up: set the Fargate desired count to 0 when not in use; after the hackathon, rotate all passwords and revoke `CRE_API_KEY`

## 3. Acceptance scenarios (34 verify:design items are not-yet; all unit tests pass)

What is missing are the scenarios that actually run on-chain with the CRE CLI, with results written to `reports/scenes/<name>.json`. **Decoy-related ones are not done for now**.

- [ ] Group 1, the seven gates hold on-chain: `forge_fields` (D14.1), `s3_forge` (D14.3), `same_block` (D14.5), `stale_price` (D14.6), `l2_new_recipient` (D14.7); `s6_bybit` (D14.2, needs a mainnet archive RPC)
- [ ] Group 2, resilience and trust boundaries: `s2_wipe` (D01), `stop_cre` (D27), `config_drift` (D37), `threshold_two_epochs` (D21), `det_patrol` (D30)
- [ ] Group 3, cross-exchange and tracing: `s4_hop` (D13), `trace_exclusion` (D31); `trace_bybit` (D51, needs an Etherscan key)
- [ ] Group 4, performance and load: `load_normal` (D41), `load_normal_rate` (D56), `load_normal_fingerprint` (D44), `latency_breakdown` (D57), `db_volume` (D60)
- [ ] Group 5, Console: `console_without_indexer` (D47), `console_rpc_budget` (D59)
- [ ] Deferred (decoy-related): `s1_trap` (D02), `s1_trap_status` (D08), `measure_trap` (D36), `race` (D45), `probe_native` (D03), `forge_decoy` (D04), `probe_threshold` (D05), `stranger_transfer` (D06), `use_api_keys` (D07, P2 not implemented), `s5_timeline` (D43), `ops_replay` (D49)
- [ ] Not doing now: `aws_alerts` (D46) and similar wait until the AWS deployment is done

## 4. For the team to decide (details under "Open decisions (待决定)" in STATUS)

- [ ] D28 decoys are distinguishable (the only fail): the new generator analysis/decoygen is done (docs/48); 1,000 accounts pass the threshold, 100 do not. Need to settle the criterion and the account pool size, then decide how to roll out the plan (write exchange_*, register in Trap, submit a new root)
- [ ] When NOWNodes is unavailable: Trap tightens as usual (implemented), or throw and retry for N blocks
- [ ] Decoys that have been triggered must be rotated; old commits still contain decoy labels and probe transactions, and history cannot be changed
- [ ] R7: whether a freeze also closes the lane; whether the lane is bound by the R8 hourly and daily caps; write back to section 4 of the proposal
- [ ] verify-edge: dusting is blocked only by the minimum amount; derived chains have no depth limit; native-coin edges are not supported
- [ ] issue #17 (Trek's 5 questions): the draft reply is in STATUS; send it once confirmed

## 5. Technical debt and test gaps

- [ ] The R7 lane is not in the invariant handler
- [ ] `services/decoy-admin` (decoy generation) has no unit tests
- [ ] decoy-admin reads `secrets/decoygen/<org>/epoch-<e>.json` and carries out the plan (see docs/48 section 8); the seeder produces the lived-in activity traces
- [ ] The Observatory decoy inventory page (online / offline) connects to 127.0.0.1:8791 (handed to the UI session)
- [x] indexer adds PatrolState, DecoyCommit, OfficerDesk, plus a state snapshot table, the `/history` time-series API and SSE, proxied by serve.ts (docs/49)
- [ ] Observatory switches to `/history`: level, freeze, CUSUM, assets and counts come from the indexer instead, and the hard-coded numbers are removed (handed to the UI session)
- [ ] The invariants drive only attacker calls; ghost checks for the legitimate paths (execute, sweep, topUp, fund) are not added yet
- [ ] notifier starts from the latest block, so events during downtime are not re-sent (needs a persisted cursor)
- [ ] Console and user-app treat every chain other than 31337 as Base Sepolia; shared has no CHAIN_ID for Ethereum Sepolia
- [ ] `trek.py watch` only works on mainnet (evidenceHash hard-codes chainId 1); on the fork use `fork_source.py`; chunlong to confirm (handoff)
- [ ] `packages/offchain/scripts` is outside tsc coverage (`e2e-prevention.ts` has a harmless type assertion error that has gone unnoticed)
- [ ] CRE CLI 1.36.0 → 1.37.0 upgrade available
- [ ] `apps/observatory` uses oxfmt and is not in biome or the pnpm workspace: unify formatting and lint later
- [ ] The two old UI drafts in `archive/`: can be deleted once confirmed there is nothing to salvage
- [ ] `media/2049-tracking-demo.mp4` (27 MB) is not in git: once someone has watched it and confirmed no real decoy address appears on screen (rule 2), decide whether to commit it or store it elsewhere
- [x] The UI's React "duplicate key" warning: the event list key is now `tx hash:log index:position`; a full Attack run (11 steps) gives 0 warnings

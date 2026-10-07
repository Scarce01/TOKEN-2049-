# Environment files

Every `.env` the project uses, what each variable is for, and its state for the public Base Sepolia deployment
(2026-10-07). This file lists names and public addresses only. Private keys, API keys and decoy data never go in git
(CLAUDE.md rule 2). Each folder has a tracked `.env.example`; copy it to `.env` (gitignored) and fill it in.

State: **done** = filled on CL's machine and used on the public chain. **todo** = needed before that part can run on
the public chain. **fork** = only for the local anvil fork. **n/a** = not needed now.

## Already in use on the public chain

### `contracts/.env` (deploy)

| Variable | Purpose | State |
| --- | --- | --- |
| `BASE_SEPOLIA_RPC` | RPC for `forge script` | done, `https://sepolia.base.org` |
| `BASESCAN_API_KEY` | contract verification on Basescan | n/a, contracts not verified |
| `DEPLOYER_PRIVATE_KEY` | deployer `0xb0D0…c309`; no power after deploy, also the faucet seeder | done |
| `OFFICER_1..3` | officers `0x4060…`, `0xb381…`, `0xbfad…` (2 of 3 sign timelock changes) | done |
| `SUBMITTER_A`, `SUBMITTER_B` | exchange backends allowed to post requests: `0x6036…`, `0x6b40…` | done |
| `WORKFLOW_OWNER` | placeholder at deploy; the real owner `0x31ed…29db` was set through the timelock | done |
| `RECEIVER_MODE` | `PROD` (real KeystoneForwarder) | done |
| `PRICE_FEED` | Chainlink ETH/USD on Base Sepolia `0x4aDC…7cb1` | done |
| `SIM_OPERATOR`, `COLLECTOR_A` | SIM mode only | n/a |
| `DEPLOY_NAME` | `base-sepolia` (writes `deployments/base-sepolia.json`) | done |

`contracts/.env.base-sepolia-fork` holds the same variables with anvil accounts: fork only.

### `workflows/.env` (CRE CLI)

| Variable | Purpose | State |
| --- | --- | --- |
| `CRE_API_KEY` | CRE account (`token2049cre`); `cre workflow deploy`, `cre execution` | done |
| `CRE_ETH_PRIVATE_KEY` | only used by `simulate --broadcast` on the fork (anvil key) | fork |
| `QUORUM_K` | workflow HMAC key (secret) | done, uploaded |
| `DECOY_TAGS`, `DECOY_THRESHOLD` | Cosign decoy tags and threshold (secret) | done, uploaded |
| `PATROL_DECOYS` | Patrol native-coin decoys (secret) | done, uploaded |
| `NOWNODES_KEY` | multi-chain reads; NOWNodes has no Base Sepolia | n/a |

`workflows/.env.nokey` is the same file without `CRE_API_KEY`: `cre secrets create … --secrets-auth browser` refuses
API keys, so it needs `cre login` and this file. `workflows/secrets.yaml` (tracked) only maps secret names to these
variables. Secrets are uploaded to the DON (namespace `main`, owner `0x31ed…29db`), so the DON does not read this file.

### `apps/exchange-api/.env` (submitter A key)

Created 2026-10-07 for the public Cosign test. Only `SUBMITTER_PRIVATE_KEY` is used by
`packages/offchain/scripts/e2e-cosign-public.ts`. Running the exchange-api server itself needs the todo rows.

| Variable | Purpose | State |
| --- | --- | --- |
| `SUBMITTER_PRIVATE_KEY` | submitter A `0x6036…` (CL's wallet), posts withdrawal requests | done |
| `ORG`, `DEPLOY_NAME`, `RPC_URL` | `a`, `base-sepolia`, `https://sepolia.base.org` | done |
| `PORT` | 8787 | done |
| `DATABASE_URL` | `exchange_a_app` role on Supabase | todo |
| `ORG_SALT` | 32 bytes; hashes user IDs; must equal `ORG_SALT_A` in decoy-admin | todo |
| `HOT_WALLET_ENC_KEY` | 32 bytes; encrypts hot wallet data; must equal `HOT_WALLET_ENC_KEY_A` in decoy-admin | todo |
| `ADMIN_TOKEN` | admin routes (redteam uses the same value) | todo, still `change-me` |
| `WS_RPC_URL` | optional websocket RPC | n/a |

## Needed for the frontend and services on the public chain

| File | Variables | State |
| --- | --- | --- |
| `apps/observatory` (no .env) | uses `src/deployment.json` and `/rpc`; steps in PR #11's comment | todo (Ziyu) |
| `services/indexer/.env` | `DEPLOY_NAME=base-sepolia`, `PONDER_RPC_URL_1/2`, `DATABASE_URL` (`ponder_svc`), `DATABASE_SCHEMA=ponder_quorum` | todo |
| `apps/user-app/.env` | `NEXT_PUBLIC_EXCHANGE_API`, `NEXT_PUBLIC_RPC_URL`, `DEPLOY_NAME` | todo |
| `apps/console/.env` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_RPC_URL`, `DEPLOY_NAME`, `CONSOLE_DATABASE_URL` (`console_svc`, read only) | todo |
| `services/keeper/.env` | `DEPLOY_NAME`, `KEEPER_PRIVATE_KEY` (any funded wallet; pays delayed withdrawals once due) | todo; the Cosign test paid by `vault.execute` from submitter A instead |
| `services/decoy-admin/.env` | `DEPLOY_NAME`, `RPC_URL`, `DATABASE_URL` (`quorum_svc`), `SEEDER_PRIVATE_KEY`, `ORG_SALT_A/B`, `HOT_WALLET_ENC_KEY_A/B` | todo, only for new decoys |
| `services/trap-sync/.env` | `DEPLOY_NAME`, `DATABASE_URL` (`trap_sync_svc`), `RPC_URL` | todo |
| `services/notifier/.env` | `DEPLOY_NAME`, `NOTIFY_WEBHOOK_URL`, `DATABASE_URL` | n/a for the demo |
| `services/redteam/.env` | `EXCHANGE_API_URL`, `ADMIN_TOKEN`, `DEPLOY_NAME`, `RPC_URL`, `ATTACKER_RECEIVER` (example still says `ethereum-sepolia`) | todo |
| `services/sim-runner/.env` | SIM mode only; the DON replaces it | n/a |

Values that must match across files: `ORG_SALT` (exchange-api) = `ORG_SALT_A` (decoy-admin);
`HOT_WALLET_ENC_KEY` = `HOT_WALLET_ENC_KEY_A`; `ADMIN_TOKEN` in exchange-api = redteam.

## Local secrets outside .env (`secrets/`, gitignored)

| File | Contents |
| --- | --- |
| `secrets/decoys.local.json` | decoy wallets (org B test decoy on the public chain) |
| `secrets/quorum_k.local.json` | source of `QUORUM_K` |
| `secrets/cosign-test-decoy.local.json` | Cosign decoy test data |
| `secrets/base-sepolia-keys.local.json` | anvil keys for the fork E2E (fork only) |

## Rotate after the hackathon

The CRE API key (`token2049cre`), every private key above, including the submitter A key.

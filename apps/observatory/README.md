# Observatory

The live UI for the demo (the hex-world map, the security popup, the attack flow, the pages) plus a single
server that fronts the whole stack on one origin. This folder is self contained: the map source
(`hexmap.html`), the contract ABIs and constants (`src/shared/`) and the fork deployment copy
(`src/deployment.json`, gitignored) all live here, so the UI builds without reaching outside the folder.

## Run it (one server, one origin)

Prerequisite, once: the shared local fork must be up and set up (see "Fork prerequisite" below).

```bash
cd apps/observatory
pnpm install           # first time
pnpm build             # builds dist/
bun serve.ts           # serves the UI and proxies every backend on http://localhost:8443
```

`serve.ts` is one process. It serves the built UI and reverse proxies each backend, and it starts each
backend as a child only if that port is not already up, so it never double starts a running service. Stop it
with Ctrl+C and it stops the children it started. Use `PORT=8080 bun serve.ts` to pick another port.

For UI development with hot reload, `pnpm dev` runs Vite on 8443 with the same proxy paths, so the UI behaves
the same in both modes.

## One origin: what each path maps to

The UI only ever calls its own origin. The server (or the Vite dev proxy) forwards:

| Path (same origin) | Backend | Port | What it does |
| --- | --- | --- | --- |
| `/` | the built UI | 8443 | the Observatory app |
| `/rpc` | anvil fork | 8545 | the Base Sepolia fork chain (viem reads here) |
| `/bridge/*` | fork bridge | 8790 | Patrol scheduler status and the live Attack flow |
| `/decoygen/*` | decoygen | 8791 | live decoy generation and the online/offline inventory |

The exchange API (8797) and PGlite (54329) are not called by the UI. The bridge calls them server side.

## Servers and what they do

| Server | Port | Role | Start |
| --- | --- | --- | --- |
| anvil fork | 8545 | the local Base Sepolia fork chain | `anvil --fork-url https://sepolia.base.org --gas-limit 100000000 --port 8545` |
| exchange-db (PGlite) | 54329 | the hot wallet list the attacker view ranks | `bun scripts/round3-pg.ts` |
| exchange-api | 8797 | signs probe transfers, serves the hot wallet list | `bun --env-file=apps/exchange-api/.env.fork apps/exchange-api/src/index.ts` |
| fork bridge | 8790 | runs Patrol every 60 s and the real decoy to trap to tighten flow (`POST /attack`) | `bun packages/offchain/scripts/fork-demo/bridge.ts` |
| decoygen | 8791 | live decoy generation, epoch rotation, inventory (SSE) | `python analysis/decoygen/serve.py --org a --tick 30` |
| Observatory | 8443 | this app (serves the UI, proxies the four above) | `bun apps/observatory/serve.ts` |

`serve.ts` supervises PGlite, exchange-api, decoygen and the bridge. anvil and the fork deployment are the
one-time prerequisite below.

## Fork prerequisite (one time)

The bridge and the UI read a local anvil fork of Base Sepolia with the contracts deployed and the demo seeded:

```bash
anvil --fork-url https://sepolia.base.org --gas-limit 100000000 --port 8545 --state .tmp/fork-state.json
# deploy the contracts to the fork, then:
bun packages/offchain/scripts/fork-demo/setup.ts    # seeds hot wallets, commits the decoy root, snapshots
```

`setup.ts` writes `deployments/base-sepolia-fork.json` (addresses only, no decoys) and `apps/exchange-api/.env.fork`.
To return the fork to the clean post-setup state: `curl -X POST http://127.0.0.1:8790/reset`.

## Notes

- `src/deployment.json` is a gitignored copy of `deployments/base-sepolia-fork.json` (public contract
  addresses only, no decoys). Refresh it after a redeploy: `cp ../../deployments/base-sepolia-fork.json src/deployment.json`.
- `src/shared/abi.ts` and `src/shared/constants.ts` are derived copies of `packages/shared/src/*`, which is the
  source of truth. Refresh with `cp ../../packages/shared/src/abi.ts src/shared/abi.ts` (same for constants).
- Numbers shown in the UI carry their source. Live chain state is measured on the fork; the cross-chain leg in
  the attack animation is labelled illustrative, not live.
- No decoy address, label or tag is ever bundled into the UI. Decoy inventory is fetched from decoygen at runtime.

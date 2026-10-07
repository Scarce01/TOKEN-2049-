# Public Base Sepolia deployment (mode A, DON)

Deployed 2026-10-07. Contracts on public Base Sepolia (chain 84532) in PROD mode, behind the real
KeystoneForwarder; Patrol runs on the Chainlink DON. Addresses: [deployments/base-sepolia.json](../deployments/base-sepolia.json).

## What is live

| Part | State | Evidence |
| --- | --- | --- |
| Contracts | deployed, `mode: PROD`, forwarder `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` (KeystoneForwarder) | start block 47799434; about 0.00023 ETH of gas |
| Patrol workflow | ACTIVE on the DON (zone-a), private registry, every minute | workflow ID `002d793802489c6c0b8e379240bd9f8f7b6189ba682c02f19969e31fcaeb5078` |
| Workflow owner on the DON | `0x31ed35d932725595DD5D27F23705D8c0c54e29db` (private registry, derived by CRE) | `cre workflow list` |
| Receiver owner | `0x31ed…29db` on both Receivers, through ConfigTimelock (officers `0x4060…` and `0xbfad…` signed, 10 min delay) | queue `0x3cc9d57d…` / `0x1fd3a6b6…`, execute `0xff06e7e3…` / `0x0c55d958…` (org A / org B) |
| Trap workflow | ACTIVE on the DON, watching one test decoy wallet of org B (no secrets needed: no NOWNodes on Base Sepolia, no committed proof) | workflow ID `006576bb13bfa082e9ccf563521e2004534f708992cf597054db84be8ff3cd66`; decoy touch to freeze 10 s (BENCHMARK.md) |
| Cosign | not on the DON yet | |

**Verified after the owner change:** DON reports are accepted. Example: tx `0x554b02a6a1cc1bfca7210cc0c6f504eaf1b6129a4be78ca4951861b240b320ec` (block 47801297), sent by a DON transmitter to the KeystoneForwarder, `ReportProcessed` result 1 for Receiver A, with `PatrolStateUpdated` (CUSUM checkpoint) and `AssetCheckpoint` in the same tx; tx `0x7cf4bad9…` carried a `Ping`. No `ActionFailed` or `ActionStale`.

Before the owner change, every DON report reached both Receivers through the KeystoneForwarder and was refused
(`ReportProcessed` result 0, `UnknownWorkflow`), which is the expected PROD check.

| Contract | Address |
| --- | --- |
| RequestBoard | `0x6b414d32bfA45336B763442D4948115D8e8247df` |
| ThreatRegistry | `0x602C867AE814bcC61581bFC35d13d3dFeDBC3fE5` |
| QuorumLens | `0x056380d85Fd7f73A39Ec9E2AEb8bC581FDE9A5cc` |
| PatrolState | `0x134Ca745C3a885CD82DcABC0754604dc605c2bCf` |
| ConfigTimelock | `0x29228a9969f1318E5a598fBE07da812187D3DFe5` (delay 600 s) |
| OfficerSet | `0x8E10648C337bf077b0B9528dCFFbce191647cC91` |
| DecoyCommit | `0x5dE745994BF1A4CF66a3779ACFD394C3C3Ca4AFE` |
| Org A Receiver / hot vault | `0x8089424197ce5F64eFf7db3ab9c9fbEf4E173630` / `0x11C914CF60BfECdB887aB15eDC922eA16414eF4C` |
| Org B Receiver / hot vault | `0x3304068e75Cdac0D3aFfB1120ffd4411152d551e` / `0x5958318C942D8f386e5563B29596Feb39344e776` |
| qUSD / qETH (test tokens) | `0x1D25882e5444fBF968aED12d7510beC1B53eE580` / `0x4cB1c0A1013593e359e202C09d74C0B12d83736b` |

Roles: deployer `0xb0D05849267b6a4bcC388DDA679047006de8c309` (no power after deploy), officers
`0x40601f700942dd6eB00d4BB73079eDF2e0029411`, `0xb3811B3bffE7B875cA7b667B78DF7EFe69E6c257`,
`0xbfad3719Aaa0330BB986167bb5708442Dd6A2D25`, submitter A `0x60368141C97Eef8e08b1cae7ead756B228b819Da`,
submitter B `0x6b40086D16Af42c87C58C820566E8cE9286ac2E3`, verify-edge signer (Trek)
`0x60368141C97Eef8e08b1cae7ead756B228b819Da`.

## How it was done

1. `contracts/.env`: `RECEIVER_MODE=PROD`, real officers, `PRICE_FEED` (Chainlink ETH/USD), `WORKFLOW_OWNER`
   set to a placeholder (it can only be learned after the first DON deploy, and it is changeable through the
   timelock).
2. `bash scripts/deploy.sh base-sepolia` (also writes the workflow configs).
3. Patrol reads FINALIZED, so wait until Base Sepolia's finalized block passes the deploy block (about 20 min).
4. `VERIFY_EDGE_SIGNERS=<addresses> DEPLOY_NAME=base-sepolia bun services/decoy-admin/src/cli.ts configs`:
   CRE refuses to activate an HTTP trigger without at least one authorized key, so Patrol's verify-edge trigger
   needs the Trek signer here.
5. `cre workflow deploy ./patrol -T staging-settings -e .env --yes`. `deployment-registry: "private"` (in each
   workflow.yaml) is the Chainlink-hosted registry: no linked wallet and no Ethereum mainnet gas. The onchain
   registry would need `cre account link-key`, which always pays gas on Ethereum mainnet.
6. Read the owner from the deploy output, then `ConfigTimelock.queue(receiver, setWorkflowOwner, owner)` with
   two officer EIP-712 signatures (kind 7, domain `QuorumOfficer`), wait 600 s, `execute`, for each Receiver.

## Frontend (apps/observatory) on this chain

The Observatory is built around the local fork. To read the public deployment instead:

- `cp deployments/base-sepolia.json apps/observatory/src/deployment.json`
- point `/rpc` at `https://sepolia.base.org` (today hardcoded to `http://127.0.0.1:8545` in `serve.ts` and
  `vite.config.ts`), or build with `VITE_RPC_URL=https://sepolia.base.org`
- `CHAIN_LABEL` in `src/live/chain.ts` shows "Base Sepolia fork" for chain 84532; it should say "Base Sepolia"
  when the deployment has `mode: PROD`
- the fork bridge's Patrol scheduler is not needed (the DON runs Patrol); its attack flow uses fork-only tricks
  (time travel, impersonation) and needs a public-chain version
- public RPC log queries over long ranges are slow; keep the UI's log windows short

## Next

- Decoys on this chain: generate with decoy-admin, fund the decoy wallets (faucet), commit the root through
  the timelock (2 officer signatures again), put the plaintext decoy addresses only in the trap log trigger config
  (CLAUDE.md rule 2).
- Upload CRE secrets for the private registry: `cre secrets create ../secrets.yaml -T staging-settings
  --secrets-auth browser` (browser login on the CRE account).
- Deploy Trap and Cosign the same way as Patrol, then run one decoy touch on the public chain.
- Rotate after the hackathon: the CRE API key (`token2049cre`) and every key used here.

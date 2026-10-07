// Ponder indexes only our own contracts (never MockERC20 Transfers, never the decoy list).
// Addresses and start block come from deployments/<DEPLOY_NAME>.json.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  ColdVaultAbi,
  ConfigTimelockAbi,
  DecoyCommitAbi,
  DepositVaultAbi,
  KeyRegistryAbi,
  OfficerDeskAbi,
  PatrolStateAbi,
  QuorumReceiverAbi,
  QuorumVaultAbi,
  RequestBoardAbi,
  ThreatRegistryAbi,
} from '@quorum/shared'
import { createConfig } from 'ponder'
import { fallback, http } from 'viem'

const d = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'deployments', `${process.env.DEPLOY_NAME ?? 'base-sepolia'}.json`), 'utf8'),
)
const start = Number(process.env.PONDER_START_BLOCK ?? d.startBlock)
const resetStart = Number(process.env.PONDER_RESET_BLOCK ?? d.resetBlock ?? start)
/** Fork only: the bridge's current snapshot id. A reset (evm_revert) takes a new one, and the history after it
 * never happened, so the local database must start over (src/api watches this file and exits on a change). */
const SNAPSHOT_FILE = join(__dirname, '..', '..', '.tmp', 'fork-snapshot.json')
function forkSnapshot(): string {
  if (!(process.env.DEPLOY_NAME ?? '').endsWith('-fork') || !existsSync(SNAPSHOT_FILE)) return ''
  return readFileSync(SNAPSHOT_FILE, 'utf8')
}
/** Fork only: the block anvil was loaded at from a state dump (written by infra/fork/start.py or whoever
 * reloads a local fork). There is no state before it, so per-block snapshots start after it. */
const LOADED_HEAD_FILE = join(__dirname, '..', '..', '.tmp', 'fork-loaded-head')
function loadedHead(): string {
  if (!(process.env.DEPLOY_NAME ?? '').endsWith('-fork') || !existsSync(LOADED_HEAD_FILE)) return ''
  return readFileSync(LOADED_HEAD_FILE, 'utf8').trim()
}
function codeHash(): string {
  const h = createHash('sha256')
    .update(process.env.DEPLOY_NAME ?? 'base-sepolia')
    .update(forkSnapshot())
    .update(loadedHead())
  for (const f of ['ponder.config.ts', 'ponder.schema.ts', 'src/index.ts']) h.update(readFileSync(join(__dirname, f)))
  return h.digest('hex').slice(0, 12)
}
// derived data only: drop databases of older code or older fork snapshots
const PGLITE = `pglite-${codeHash()}`
if (existsSync(join(__dirname, '.ponder')))
  for (const dir of readdirSync(join(__dirname, '.ponder')))
    if (dir.startsWith('pglite-') && dir !== PGLITE)
      rmSync(join(__dirname, '.ponder', dir), { recursive: true, force: true })
const rpcs = [process.env.PONDER_RPC_URL_1, process.env.PONDER_RPC_URL_2].filter(Boolean) as string[]

export default createConfig({
  database: process.env.DATABASE_URL
    ? { kind: 'postgres', connectionString: process.env.DATABASE_URL }
    : // local runs without Postgres. One directory per version of the indexer code: Ponder refuses a database
      // built by different code (MigrationError), so a pull that changes the indexer (or a fork reset) starts fresh
      { kind: 'pglite', directory: join(__dirname, '.ponder', PGLITE) },
  chains: {
    chain: {
      id: d.chainId,
      // NOWNodes first, a second provider as fallback (31_phase1.md 1.9)
      rpc: rpcs.length > 1 ? fallback(rpcs.map((u) => http(u))) : (rpcs[0] ?? 'https://sepolia.base.org'),
    },
  },
  contracts: {
    RequestBoard: { chain: 'chain', abi: RequestBoardAbi, address: d.requestBoard, startBlock: start },
    KeyRegistry: { chain: 'chain', abi: KeyRegistryAbi, address: d.keyRegistry, startBlock: start },
    DepositVault: { chain: 'chain', abi: DepositVaultAbi, address: d.depositVault, startBlock: start },
    ConfigTimelock: { chain: 'chain', abi: ConfigTimelockAbi, address: d.configTimelock, startBlock: start },
    QuorumReceiver: {
      chain: 'chain',
      abi: QuorumReceiverAbi,
      address: [d.orgA.receiver, d.orgB.receiver],
      startBlock: resetStart,
    },
    OfficerDesk: {
      chain: 'chain',
      abi: OfficerDeskAbi,
      address: [d.orgA.desk, d.orgB.desk],
      startBlock: resetStart,
    },
    QuorumVault: {
      chain: 'chain',
      abi: QuorumVaultAbi,
      address: [d.orgA.hotVault, d.orgA.warmVault, d.orgB.hotVault, d.orgB.warmVault],
      startBlock: resetStart,
    },
    ColdVault: {
      chain: 'chain',
      abi: ColdVaultAbi,
      address: [d.orgA.coldVault, d.orgB.coldVault],
      startBlock: resetStart,
    },
    ThreatRegistry: { chain: 'chain', abi: ThreatRegistryAbi, address: d.threatRegistry, startBlock: resetStart },
    // CUSUM S, asset checkpoints, planned ops (docs/49 time series); public events only
    PatrolState: { chain: 'chain', abi: PatrolStateAbi, address: d.patrolState, startBlock: resetStart },
    // root, leaf count, threshold commit and reveal: commitments only, never the decoy list (rule 2)
    DecoyCommit: { chain: 'chain', abi: DecoyCommitAbi, address: d.decoyCommit, startBlock: resetStart },
  },
  // vault balance, quota, cap, alert and freeze per org every N blocks (state that has no event of its own)
  blocks: {
    // a fork loaded from a state dump has no state before its head (.tmp/fork-loaded-head, or PONDER_SNAPSHOT_FROM)
    Snapshot: {
      chain: 'chain',
      startBlock: Number(process.env.PONDER_SNAPSHOT_FROM ?? (loadedHead() ? Number(loadedHead()) + 1 : resetStart)),
      interval: Number(process.env.PONDER_SNAPSHOT_EVERY ?? 30),
    },
  },
})

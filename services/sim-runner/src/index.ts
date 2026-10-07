// sim-runner (mode B, no DON deploy access): turns chain events into `cre workflow simulate --broadcast`.
// It subscribes itself (viem) so it does not depend on --listen (spike S3) and is not bound by the
// CRE log trigger rate limit. Trap filtering here is only a pre-filter: the Trap workflow re-checks
// everything, and D06 is tested by simulating the stranger transfer directly against Trap.
import { join } from 'node:path'
import { clients, db, insertMetric, loadDeployment, repoRoot } from '@quorum/offchain'
import { RequestBoardAbi } from '@quorum/shared'
import { type Hex, parseAbiItem } from 'viem'
import { type Job, JobQueue, simulateArgs } from './queue'

const d = loadDeployment()
const { pub } = clients(d)
const sql = db()
const queue = new JobQueue()
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const workflowsDir = join(repoRoot, 'workflows')
const runId = `sim-${new Date().toISOString().slice(0, 16)}`

async function decoySets() {
  const rows = await sql`select kind, ref from quorum_index.traps where kind in ('wallet_erc20', 'address')`
  return {
    wallets: rows.filter((r) => r.kind === 'wallet_erc20').map((r) => (r.ref as string).toLowerCase()),
    addrs: rows.filter((r) => r.kind === 'address').map((r) => (r.ref as string).toLowerCase()),
  }
}
const vaults = [d.orgA.hotVault, d.orgA.warmVault, d.orgB.hotVault, d.orgB.warmVault].map((v) => v.toLowerCase())

let cursor = BigInt(process.env.SIM_FROM_BLOCK ?? 0) || (await pub.getBlockNumber())

async function pollChain() {
  const latest = await pub.getBlockNumber()
  if (latest < cursor) return
  const { wallets, addrs } = await decoySets()
  const [transfers, reqs] = await Promise.all([
    pub.getLogs({ address: [d.qUSD, d.qETH], event: TRANSFER, fromBlock: cursor, toBlock: latest }),
    pub.getContractEvents({
      address: d.requestBoard,
      abi: RequestBoardAbi,
      eventName: 'WithdrawalRequested',
      fromBlock: cursor,
      toBlock: latest,
    }),
  ])
  for (const l of transfers) {
    const from = (l.args.from as string).toLowerCase()
    const to = (l.args.to as string).toLowerCase()
    // trigger 0 = decoy wallet outflow, 1 = our vault paying a decoy address
    const triggerIndex = wallets.includes(from) ? 0 : vaults.includes(from) && addrs.includes(to) ? 1 : -1
    if (triggerIndex < 0) continue
    queue.push({
      kind: 'trap',
      key: `${l.transactionHash}:${l.logIndex}`,
      triggerIndex,
      txHash: l.transactionHash,
      logIndex: l.logIndex,
      enqueuedAt: Date.now(),
    })
  }
  for (const l of reqs) {
    queue.push({
      kind: 'cosign',
      key: `${l.transactionHash}:${l.logIndex}`,
      triggerIndex: 0,
      txHash: l.transactionHash,
      logIndex: l.logIndex,
      enqueuedAt: Date.now(),
    })
  }
  cursor = latest + 1n
}

let patrolTick = 0
/** Patrol trigger indices: 0 ping, 1 decoys, 2 epoch, 3 quota, 4 reconcile (fixed in the workflow). */
function enqueuePatrol() {
  patrolTick++
  const now = Date.now()
  for (const [idx, name] of [
    [1, 'decoys'],
    [4, 'reconcile'],
    [3, 'quota'],
  ] as const) {
    queue.push({ kind: 'patrol', key: `patrol-${name}-${patrolTick}`, triggerIndex: idx, enqueuedAt: now })
  }
  if (patrolTick % 60 === 1)
    queue.push({ kind: 'patrol', key: `patrol-epoch-${patrolTick}`, triggerIndex: 2, enqueuedAt: now })
  if (patrolTick % 10 === 1)
    queue.push({ kind: 'patrol', key: `patrol-ping-${patrolTick}`, triggerIndex: 0, enqueuedAt: now })
}

async function run(j: Job): Promise<boolean> {
  const t0 = Date.now()
  const wasm = join(workflowsDir, j.kind, 'binary.wasm')
  const p = Bun.spawn(['cre', ...simulateArgs(j, (await Bun.file(wasm).exists()) ? wasm : undefined)], {
    cwd: workflowsDir,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text())
  const code = await p.exited
  const ms = Date.now() - t0
  // success needs both the tx and the receiver execution (the workflow logs "[error]" otherwise)
  const ok = code === 0 && !/\[error\]|writeReport failed|✗/.test(out)
  console.log(`${j.kind} ${j.key.slice(0, 18)} ${ok ? 'ok' : 'FAILED'} ${ms}ms queue=${queue.size}`)
  await insertMetric(sql, {
    runId,
    name: `sim_exec_ms_${j.kind}`,
    value: ms,
    unit: 'ms',
    source: 'testnet_measured',
    notes: j.key,
  }).catch(() => {})
  return ok
}

async function worker() {
  for (;;) {
    const j = queue.next()
    if (!j) {
      await Bun.sleep(500)
      continue
    }
    if (await run(j)) queue.succeed(j)
    else queue.fail(j)
  }
}

console.log(`sim-runner from block ${cursor}`)
setInterval(() => void pollChain().catch((e) => console.error('poll', String(e).slice(0, 160))), 2000)
setInterval(enqueuePatrol, Number(process.env.PATROL_INTERVAL_SEC ?? 60) * 1000)
enqueuePatrol()
void worker()
export type { Hex }

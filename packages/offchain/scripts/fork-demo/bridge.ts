// Local bridge for the 8443 UI on the Base Sepolia fork. It is the fork's Patrol scheduler (mode B, same
// cadence as services/sim-runner): it runs the real Patrol workflow through the CRE CLI (simulate
// --broadcast) on its own and serves the status. The UI only reads it. Defender side only; 127.0.0.1.
// Usage (repo root): bun packages/offchain/scripts/fork-demo/bridge.ts   (after setup.ts)
// Env: PATROL_TICK_S (default 60), PATROL_AUTO=0 to stop the scheduler, CRE_BIN to point at the CLI.
// Pause without a restart: create .tmp/patrol-paused (another session needs the CRE key); delete it to resume.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import {
  ColdVaultAbi,
  DecoyCommitAbi,
  PatrolStateAbi,
  QuorumReceiverAbi,
  QuorumVaultAbi,
  ThreatRegistryAbi,
} from '@quorum/shared'
import { type Hex, parseEventLogs } from 'viem'
import { readJson, repoRoot, writeJson } from '../../src/index'
import { parseCre, reportTxs } from './cre-log'
import { dueHandlers, HANDLERS, type Handler, indexOf } from './patrol'
import { d, pub, rpc, snapPath } from './setup'

const PORT = 8790
const TICK_S = Number(process.env.PATROL_TICK_S ?? 60)
const AUTO = process.env.PATROL_AUTO !== '0'
const WORKFLOWS = join(repoRoot, 'workflows')
const PAUSE_FILE = join(repoRoot, '.tmp', 'patrol-paused')
const paused = () => existsSync(PAUSE_FILE)
// launch configs start bun without the user's shell PATH, so look for the CLI explicitly
const CRE =
  process.env.CRE_BIN ?? Bun.which('cre') ?? join(homedir(), 'bin', process.platform === 'win32' ? 'cre.exe' : 'cre')
// cre compiles workflows with bun: children get a PATH holding both (Windows names the key `Path`)
const PATH_KEY = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
const CHILD_ENV = {
  ...process.env,
  [PATH_KEY]: [dirname(CRE), dirname(process.execPath), process.env[PATH_KEY] ?? ''].join(delimiter),
}
const EVENTS_ABI = [
  ...QuorumReceiverAbi,
  ...QuorumVaultAbi,
  ...ColdVaultAbi,
  ...PatrolStateAbi,
  ...DecoyCommitAbi,
  ...ThreatRegistryAbi,
]
// every org in the deployment (orgA, orgB, ...), keyed by receiver: the report names its org by letter
const ORG_BY_RECEIVER: Record<string, string> = Object.fromEntries(
  Object.entries(d)
    .filter(([k]) => /^org[A-Z]$/.test(k))
    .map(([k, o]) => [(o as { receiver: string }).receiver.toLowerCase(), k.slice(3)]),
)

type Report = { org: string; tx: Hex; block: number; ok: boolean; events: Record<string, number> }
export type HandlerState = {
  handler: Handler
  status: 'idle' | 'run' | 'ok' | 'fail'
  result?: string
  reports?: Report[]
  startedAt?: number
  finishedAt?: number
  ms?: number
}

const state = {
  tick: 0,
  tickEverySec: TICK_S,
  auto: AUTO,
  nextTickAt: 0,
  running: null as Handler | null,
  handlers: Object.fromEntries(HANDLERS.map((h) => [h, { handler: h, status: 'idle' }])) as Record<
    Handler,
    HandlerState
  >,
  history: [] as HandlerState[],
}
let resetting = false

async function decodeReport(tx: Hex): Promise<Report> {
  const rc = await pub.getTransactionReceipt({ hash: tx })
  const events: Record<string, number> = {}
  let org = '?'
  for (const ev of parseEventLogs({ abi: EVENTS_ABI, logs: rc.logs, strict: false })) {
    events[ev.eventName] = (events[ev.eventName] ?? 0) + 1
    org = ORG_BY_RECEIVER[ev.address.toLowerCase()] ?? org
  }
  return { org, tx, block: Number(rc.blockNumber), ok: rc.status === 'success', events }
}

async function simulate(index: number) {
  const p = Bun.spawn(
    [
      CRE,
      'workflow',
      'simulate',
      'patrol',
      '-T',
      'fork-settings',
      '--non-interactive',
      '--trigger-index',
      String(index),
      '--broadcast',
    ],
    { cwd: WORKFLOWS, stdout: 'pipe', stderr: 'pipe', env: CHILD_ENV },
  )
  const [o, e, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  return { code, ...parseCre(`${o}\n${e}`) }
}

async function runHandler(h: Handler) {
  const startedAt = Date.now()
  state.running = h
  state.handlers[h] = { ...state.handlers[h], status: 'run', startedAt }
  let done: HandlerState
  try {
    const r = await simulate(indexOf(h))
    const reports = await Promise.all(reportTxs(r.logs).map(decodeReport))
    const ok = r.code === 0 && !r.logs.some((l) => l.startsWith('[error]'))
    done = { handler: h, status: ok ? 'ok' : 'fail', result: r.result ?? r.errors.join(' | '), reports, startedAt }
  } catch (err) {
    done = { handler: h, status: 'fail', result: err instanceof Error ? err.message : String(err), startedAt }
  }
  done.finishedAt = Date.now()
  done.ms = done.finishedAt - startedAt
  state.handlers[h] = done
  state.history = [done, ...state.history].slice(0, 40)
  state.running = null
}

function enableDecoys(): boolean {
  try {
    return !!JSON.parse(readFileSync(join(WORKFLOWS, 'patrol', 'config.staging.json'), 'utf8')).enableDecoys
  } catch {
    return false
  }
}

async function scheduler() {
  for (;;) {
    const t0 = Date.now()
    state.tick++
    state.nextTickAt = t0 + TICK_S * 1000
    for (const h of dueHandlers(state.tick, enableDecoys())) {
      while (resetting || attacking || paused()) await Bun.sleep(1000)
      await runHandler(h)
    }
    // one simulate at a time (one broadcast key); a slow tick starts the next one right away
    await Bun.sleep(Math.max(0, state.nextTickAt - Date.now()))
  }
}

async function reset() {
  const snap = readJson<{ id: Hex }>(snapPath)
  const reverted = await rpc<boolean>('evm_revert', [snap.id])
  if (!reverted) throw new Error('snapshot not found (anvil restarted?): run setup.ts again')
  const id = await rpc<Hex>('evm_snapshot') // a revert consumes the snapshot; take the next one
  writeJson(snapPath, { id })
  return { reverted, block: Number(await pub.getBlockNumber()) }
}

// ---------------------------------------------------------------- live attack demo (defensive)
// Exercises this exchange's own decoy tripwire on the fork and streams the REAL defence response as it lands,
// so the UI animation is driven by on-chain events, not a script. Reuses the same primitives as the
// `demo:trace` E2E. The decoy address is read server-side only and never sent to the client (rule 2).
const EX_API = 'http://127.0.0.1:8797'
function exAdmin(): string {
  const m = readFileSync(join(repoRoot, 'apps', 'exchange-api', '.env.fork'), 'utf8').match(/ADMIN_TOKEN=(.+)/)
  if (!m) throw new Error('apps/exchange-api/.env.fork has no ADMIN_TOKEN (run fork-demo setup.ts)')
  return m[1].trim()
}
function trapDecoySet(): Set<string> {
  const c = JSON.parse(readFileSync(join(WORKFLOWS, 'trap', 'config.staging.json'), 'utf8'))
  if (!c.decoyWallets?.length) throw new Error('trap config has no fork decoy (run setup.ts)')
  return new Set((c.decoyWallets as { address: string }[]).map((w) => w.address.toLowerCase()))
}
async function simulateTrap(txHash: Hex, eventIndex: number) {
  const p = Bun.spawn(
    [
      CRE,
      'workflow',
      'simulate',
      'trap',
      '-T',
      'fork-settings',
      '--non-interactive',
      '--trigger-index',
      '0',
      '--evm-tx-hash',
      txHash,
      '--evm-event-index',
      String(eventIndex),
      '--broadcast',
    ],
    { cwd: WORKFLOWS, stdout: 'pipe', stderr: 'pipe', env: CHILD_ENV },
  )
  const [o, e, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  return { code, ...parseCre(`${o}\n${e}`) }
}

type AttackStep = {
  cre?: string
  nownodes?: string
  verdict?: string
  seq: number
  type: 'start' | 'step' | 'response' | 'done' | 'error'
  phase?: string
  event?: string
  org?: string
  detail?: string
  message?: string
  tx?: string
  block?: number
  at: number
}
let attacking = false
const attackJob = { running: false, startedAt: 0, steps: [] as AttackStep[] }
const pushStep = (x: Omit<AttackStep, 'seq' | 'at'>) =>
  attackJob.steps.push({ ...x, seq: attackJob.steps.length, at: Date.now() })

// tightening events, in the order the defence applies them, mapped to a short UI label
const TIGHTEN_LABEL: Record<string, string> = {
  AlertSet: 'Alert raised to CONFIRMED',
  QuotaZeroed: 'Hot withdrawal quota set to 0',
  FreezeSet: 'Warm vault frozen',
  Swept: 'Hot balance swept to cold',
  DelayRaised: 'Cold timelock extended',
  ThreatAdded: 'Attacker shared to the network',
}

async function runAttackJob() {
  attacking = true
  attackJob.running = true
  attackJob.startedAt = Date.now()
  attackJob.steps = []
  try {
    const { fetchHotWallets } = await import('../../../../services/redteam/src/scanner')
    const { rankWallets } = await import('../../../../services/redteam/src/rank')
    const { probeTransfer } = await import('../../../../services/redteam/src/attack')
    const { erc20Abi, decodeEventLog } = await import('viem')
    const { privateKeyToAccount, generatePrivateKey } = await import('viem/accounts')
    const ADMIN = exAdmin()
    const decoys = trapDecoySet()
    const org = 'A' // the fork decoy belongs to org A

    pushStep({ type: 'start', org, block: Number(await pub.getBlockNumber()) })

    const ranked = rankWallets(await fetchHotWallets(EX_API, ADMIN))
    pushStep({ type: 'step', phase: 'scan', org, detail: `${ranked.length} hot wallets ranked by balance` })

    const recv = privateKeyToAccount(generatePrivateKey()).address
    const probes: { tx: Hex; from: string }[] = []
    for (const row of ranked.slice(0, 3))
      probes.push({ tx: (await probeTransfer(EX_API, ADMIN, row.address, recv)) as Hex, from: row.address })
    pushStep({
      type: 'step',
      phase: 'probe',
      org,
      detail: `3 probes of 1 qUSD to ${recv.slice(0, 6)}\u2026${recv.slice(-4)}`,
    })

    const hit = probes.find((pr) => decoys.has(pr.from.toLowerCase()))
    if (!hit) throw new Error('no probe reached a decoy tripwire')
    const hitRc = await pub.getTransactionReceipt({ hash: hit.tx })
    const hitLog = hitRc.logs.find((l) => {
      try {
        return decodeEventLog({ abi: erc20Abi, data: l.data, topics: l.topics }).eventName === 'Transfer'
      } catch {
        return false
      }
    })!
    pushStep({
      type: 'step',
      phase: 'tripwire',
      org,
      detail: 'Decoy tripwire touched',
      tx: hit.tx,
      block: Number(hitRc.blockNumber),
    })

    pushStep({ type: 'step', phase: 'verify', org, detail: 'CRE verifying across nodes\u2026' })
    while (state.running) await Bun.sleep(400)
    const trap = await simulateTrap(hit.tx, hitLog.logIndex)
    const trapTx = trap.logs.join('\n').match(/report ok tx=(0x[0-9a-fA-F]{64})/)?.[1] as Hex | undefined
    if (!trapTx) {
      pushStep({ type: 'error', message: trap.errors.join(' | ') || 'trap did not report' })
      return
    }
    // integrated CRE + NOWNodes verdict, read from the real trap log line (CLAUDE.md rule 8: show the source)
    const nn =
      trap.logs
        .find((l) => l.startsWith('nownodes '))
        ?.slice('nownodes '.length)
        .trim() ?? 'n/a'
    const nownodes = /not served/.test(nn)
      ? 'no node for this chain · skipped'
      : /status=1/.test(nn)
        ? `${nn} · agrees`
        : nn
    const verdict = /not served|unavailable/.test(nn)
      ? 'acting on CRE receipt'
      : /status=1/.test(nn)
        ? 'two sources agree'
        : nn
    pushStep({
      type: 'step',
      phase: 'verified',
      org,
      detail: `CRE receipt confirmed · NOWNodes ${nownodes}`,
      cre: 'receipt confirmed',
      nownodes,
      verdict,
    })

    const trapRc = await pub.getTransactionReceipt({ hash: trapTx })
    pushStep({
      type: 'step',
      phase: 'report',
      org,
      detail: 'CRE report accepted on chain',
      tx: trapTx,
      block: Number(trapRc.blockNumber),
    })

    const counts: Record<string, number> = {}
    for (const ev of parseEventLogs({ abi: EVENTS_ABI, logs: trapRc.logs, strict: false })) {
      const label = TIGHTEN_LABEL[ev.eventName]
      if (!label || ev.eventName === 'Tightened') continue
      counts[ev.eventName] = (counts[ev.eventName] ?? 0) + 1
      if (counts[ev.eventName] > 1 && ev.eventName !== 'ThreatAdded') continue
      pushStep({
        type: 'response',
        phase: 'tighten',
        event: ev.eventName,
        org,
        detail: label,
        tx: trapTx,
        block: Number(trapRc.blockNumber),
      })
      await Bun.sleep(900) // each action appears as its own beat to the polling UI
    }
    pushStep({ type: 'done', org, block: Number(await pub.getBlockNumber()) })
  } catch (err) {
    pushStep({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  } finally {
    attacking = false
    attackJob.running = false
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}
const json = (x: unknown, status = 200) =>
  new Response(JSON.stringify(x), { status, headers: { ...CORS, 'content-type': 'application/json' } })

if (import.meta.main) {
  Bun.serve({
    port: PORT,
    hostname: '127.0.0.1',
    async fetch(req) {
      const { pathname } = new URL(req.url)
      if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
      if (pathname === '/health') return json({ ok: true, chainId: d.chainId })
      if (pathname === '/patrol/status') return json({ ...state, paused: paused(), attacking, now: Date.now() })
      if (pathname === '/attack/status') return json(attackJob)
      if (pathname === '/attack' && req.method === 'POST') {
        if (attacking) return json({ error: 'attack already running' }, 409)
        runAttackJob()
        return json({ started: true })
      }
      // operator tool, not in the UI: curl -X POST 127.0.0.1:8790/reset (waits for the running simulate)
      if (pathname === '/reset' && req.method === 'POST') {
        resetting = true
        try {
          while (state.running) await Bun.sleep(500)
          return json(await reset())
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) }, 500)
        } finally {
          resetting = false
        }
      }
      return json({ error: 'not found' }, 404)
    },
  })
  console.log(`fork bridge on http://127.0.0.1:${PORT}; patrol scheduler ${AUTO ? `every ${TICK_S}s` : 'off'}`)
  if (AUTO) scheduler()
}

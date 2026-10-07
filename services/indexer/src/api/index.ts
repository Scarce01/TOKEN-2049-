// Ponder's built-in /health, /ready and /status stay; no GraphQL and no /sql are mounted (31_phase1.md 1.9).
// /history serves public chain events and state snapshots as time series for the Observatory (docs/49).
// Everything here is already public on chain; no decoy list, no sealed reason in clear, no current threshold.
// Bind to 127.0.0.1 and reach it through the one-origin server (apps/observatory/serve.ts proxies /history).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from 'ponder:api'
import schema from 'ponder:schema'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { and, asc, desc, eq, gt, gte, inArray, lte, or, replaceBigInts } from 'ponder'

const dep = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '..', 'deployments', `${process.env.DEPLOY_NAME ?? 'base-sepolia'}.json`),
    'utf8',
  ),
)
type OrgJson = {
  orgId: string
  receiver: string
  desk?: string
  hotVault: string
  warmVault: string
  coldVault: string
}
const ORGS = Object.entries(dep as Record<string, unknown>)
  .filter(([k]) => /^org[A-Z]$/.test(k))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([k, v]) => ({ letter: k.slice(3), ...(v as OrgJson) }))
const ORG_BY_ADDR = new Map<string, string>()
const ORG_BY_ID = new Map<string, string>()
const TIER_BY_ADDR = new Map<string, string>()
for (const o of ORGS) {
  ORG_BY_ID.set(o.orgId.toLowerCase(), o.letter)
  for (const [tier, a] of [
    ['receiver', o.receiver],
    ['desk', o.desk],
    ['hot', o.hotVault],
    ['warm', o.warmVault],
    ['cold', o.coldVault],
  ]) {
    if (!a) continue
    ORG_BY_ADDR.set(a.toLowerCase(), o.letter)
    TIER_BY_ADDR.set(a.toLowerCase(), tier as string)
  }
}

type Row = typeof schema.chainEvents.$inferSelect
/** Which org an event belongs to: emitting contract, then orgId / reporterOrg / vault in its args. */
function orgOf(r: Row): string | null {
  const a = r.args as Record<string, unknown>
  const by = (x: unknown) =>
    typeof x === 'string' ? (ORG_BY_ID.get(x.toLowerCase()) ?? ORG_BY_ADDR.get(x.toLowerCase())) : undefined
  return ORG_BY_ADDR.get(r.contract.toLowerCase()) ?? by(a.orgId) ?? by(a.reporterOrg) ?? by(a.vault) ?? null
}
const shape = (r: Row) => ({
  id: `${r.blockNumber}:${r.logIndex}`,
  block: Number(r.blockNumber),
  time: Number(r.blockTime),
  tx: r.txHash,
  contract: r.contractName,
  tier: TIER_BY_ADDR.get(r.contract.toLowerCase()) ?? null,
  org: orgOf(r),
  event: r.event,
  caseId: r.caseId,
  args: r.args,
})

/** Named series: which events make up each line on the map (docs/49 section 2). */
const SERIES: Record<string, { contract: string; events: string[] }> = {
  alert: { contract: 'QuorumReceiver', events: ['AlertSet'] },
  freeze: { contract: 'QuorumReceiver', events: ['FreezeSet'] },
  tighten: { contract: 'QuorumReceiver', events: ['Tightened', 'ReportProcessed', 'ActionFailed', 'ActionStale'] },
  verdicts: {
    contract: 'QuorumReceiver',
    events: [
      'VerdictRecorded',
      'VerdictDowngraded',
      'VerdictHeld',
      'VerdictReleased',
      'VerdictCancelled',
      'VerdictSkipped',
      'UserCancelled',
    ],
  },
  pings: { contract: 'QuorumReceiver', events: ['Ping'] },
  outflow: { contract: 'QuorumVault', events: ['Executed', 'Swept', 'ProtectedRelease'] },
  quota: { contract: 'QuorumVault', events: ['QuotaRefilled', 'QuotaZeroed', 'TopUp', 'Funded'] },
  cold: {
    contract: 'ColdVault',
    events: ['DelayRaised', 'DelayLowered', 'Queued', 'QueuedExecuted', 'QueuedCancelled'],
  },
  cusum: { contract: 'PatrolState', events: ['PatrolStateUpdated'] },
  assets: {
    contract: 'PatrolState',
    events: ['AssetCheckpoint', 'AssetResetQueued', 'AssetResetExecuted', 'PlannedOpRegistered'],
  },
  threats: { contract: 'ThreatRegistry', events: ['ThreatAdded'] },
  requests: { contract: 'RequestBoard', events: ['WithdrawalRequested'] },
  // commitments and revealed (past) thresholds only; the live threshold is never on chain in clear
  decoyCommit: { contract: 'DecoyCommit', events: ['RootSet', 'ThresholdCommitted', 'ThresholdRevealed'] },
  config: { contract: 'ConfigTimelock', events: ['ConfigQueued', 'ConfigExecuted', 'ConfigCancelled'] },
  officer: { contract: 'OfficerDesk', events: ['ManualQueued', 'ManualExecuted', 'QueuedCancelled'] },
}

const int = (v: string | undefined, d: number, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : d
}
const ORG_RE = /^[A-Z]$/
const SCAN = 50_000 // ponytail: org is derived after the query, so filter in memory; push into SQL if tables grow past this

/** Org filter first, then ?limit (oldest first) or ?last (the newest N, still oldest first). */
function page<T extends { org: string | null }>(rows: T[], q: Record<string, string>, d: number, max: number): T[] {
  const org = q.org && ORG_RE.test(q.org) ? q.org : null
  const kept = org ? rows.filter((r) => r.org === org || r.org === null) : rows
  return q.last ? kept.slice(-int(q.last, d, max)) : kept.slice(0, int(q.limit, d, max))
}

const app = new Hono()

app.get('/history/meta', async (c) => {
  const [last] = await db.select().from(schema.chainEvents).orderBy(desc(schema.chainEvents.blockNumber)).limit(1)
  const [snap] = await db.select().from(schema.snapshots).orderBy(desc(schema.snapshots.blockNumber)).limit(1)
  return c.json(
    replaceBigInts(
      {
        chainId: dep.chainId,
        orgs: ORGS.map((o) => ({ letter: o.letter, orgId: o.orgId })),
        series: Object.keys(SERIES),
        lastEventBlock: last?.blockNumber ?? null,
        lastSnapshotBlock: snap?.blockNumber ?? null,
        source: 'testnet measured (chain events of this deployment)',
      },
      String,
    ),
  )
})

/** Raw events, oldest first. ?fromBlock&toBlock&contract&event&org&limit|last (default 500, max 5000) */
app.get('/history/events', async (c) => {
  const q = c.req.query()
  const t = schema.chainEvents
  const where = [gte(t.blockNumber, BigInt(int(q.fromBlock, 0)))]
  if (q.toBlock) where.push(lte(t.blockNumber, BigInt(int(q.toBlock, 0))))
  if (q.contract) where.push(eq(t.contractName, q.contract))
  if (q.event) where.push(inArray(t.event, q.event.split(',')))
  const rows = await db
    .select()
    .from(t)
    .where(and(...where))
    .orderBy(asc(t.blockNumber), asc(t.logIndex))
    .limit(SCAN)
  return c.json(page(rows.map(shape), q, 500, 5000))
})

/** One named series (see SERIES); ?org&fromBlock&limit|last. Rows with no org (registry-wide) are kept. */
app.get('/history/series/:name', async (c) => {
  const name = c.req.param('name')
  const q = c.req.query()
  if (name === 'snapshots') {
    const t = schema.snapshots
    const where = [gte(t.blockNumber, BigInt(int(q.fromBlock, 0)))]
    if (q.org && ORG_RE.test(q.org)) where.push(eq(t.org, q.org))
    const rows = await db
      .select()
      .from(t)
      .where(and(...where))
      .orderBy(asc(t.blockNumber))
      .limit(SCAN)
    return c.json(
      page(
        replaceBigInts(
          rows.map((r) => ({ ...r, block: r.blockNumber, time: r.blockTime })),
          Number,
        ),
        q,
        2000,
        20000,
      ),
    )
  }
  const s = SERIES[name]
  if (!s) return c.json({ error: 'unknown series', series: [...Object.keys(SERIES), 'snapshots'] }, 404)
  const t = schema.chainEvents
  const rows = await db
    .select()
    .from(t)
    .where(
      and(eq(t.contractName, s.contract), inArray(t.event, s.events), gte(t.blockNumber, BigInt(int(q.fromBlock, 0)))),
    )
    .orderBy(asc(t.blockNumber), asc(t.logIndex))
    .limit(SCAN)
  return c.json(page(rows.map(shape), q, 2000, 20000))
})

/** Event counts per org: all time and the last 24 h of chain time. ?org */
app.get('/history/counts', async (c) => {
  const q = c.req.query()
  const org = q.org && ORG_RE.test(q.org) ? q.org : null
  const t = schema.chainEvents
  const rows = (await db.select().from(t).orderBy(asc(t.blockNumber))).map(shape).filter((r) => !org || r.org === org)
  const now = rows.length ? rows[rows.length - 1]!.time : 0
  const all: Record<string, number> = {}
  const day: Record<string, number> = {}
  for (const r of rows) {
    all[r.event] = (all[r.event] ?? 0) + 1
    if (now - r.time <= 86_400) day[r.event] = (day[r.event] ?? 0) + 1
  }
  return c.json({ org, asOfChainTime: now, all, last24h: day })
})

/** New events as they are indexed. Resumes after Last-Event-ID ("block:logIndex"), else starts at the head. */
app.get('/history/stream', (c) =>
  streamSSE(c, async (stream) => {
    const t = schema.chainEvents
    const last = (c.req.header('Last-Event-ID') ?? c.req.query('after') ?? '').match(/^(\d+):(\d+)$/)
    let cur: [bigint, number]
    if (last) cur = [BigInt(last[1]!), Number(last[2])]
    else {
      const [h] = await db.select().from(t).orderBy(desc(t.blockNumber), desc(t.logIndex)).limit(1)
      cur = h ? [h.blockNumber, h.logIndex] : [0n, -1]
    }
    let alive = true
    stream.onAbort(() => {
      alive = false
    })
    let idle = 0
    while (alive) {
      const rows = await db
        .select()
        .from(t)
        .where(or(gt(t.blockNumber, cur[0]), and(eq(t.blockNumber, cur[0]), gt(t.logIndex, cur[1]))))
        .orderBy(asc(t.blockNumber), asc(t.logIndex))
        .limit(500)
      for (const r of rows) {
        const e = shape(r)
        await stream.writeSSE({ id: e.id, event: 'chain', data: JSON.stringify(e) })
        cur = [r.blockNumber, r.logIndex]
      }
      idle = rows.length ? 0 : idle + 1
      if (idle >= 15) {
        await stream.writeSSE({ event: 'ping', data: '{}' })
        idle = 0
      }
      await stream.sleep(1000)
    }
  }),
)

export default app

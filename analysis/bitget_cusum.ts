// Bitget 2026-09-24 CUSUM backtest (36_phase6.md 6.6; source = public_onchain).
// Baseline: Bitget 6's own 4 weeks before (2026-08-24 to 09-21). Test: 2026-09-21 00:00 to 09-24 22:00 UTC.
// Same recurrence as workflows/patrol/src/logic/cusum.ts: z = (L - mu) / max(sigma, 50) (x1000 units),
// S = max(0, S + z - k), alarm when S > h. After an alarm S resets to 0 so episodes can be counted.
// Usage: bun analysis/bitget_cusum.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const base = JSON.parse(readFileSync(join(root, 'datasets/public/bitget6_baseline_2026-08-24_09-20.json'), 'utf8'))
const raw = JSON.parse(readFileSync(join(root, 'datasets/public/bitget6_series_2026-09-21_24.bq.json'), 'utf8'))

const T0 = Date.UTC(2026, 8, 21) / 1000 // 2026-09-21 00:00 UTC
const END = 3 * 1440 + 22 * 60 // 2026-09-24 22:00
const HACK_DAY = 3 * 1440
const EVENTS = {
  first_test_transfer: HACK_DAY + 18 * 60 + 31,
  large_outflows: HACK_DAY + 18 * 60 + 58,
  bitget_detected: HACK_DAY + 19 * 60 + 5,
}
const K = 500
const SIGMA_FLOOR = 50

function baseline(s: string) {
  return s.split(',').map((p) => {
    const [mu, sigma] = p.split(':').map(Number)
    return { mu: mu!, sigma: Math.max(sigma!, SIGMA_FLOOR) }
  })
}

function series(kind: string): Map<number, number> {
  const row = raw.rows.find((r: { f: { v: string }[] }) => r.f[0]!.v === kind)
  const m = new Map<number, number>()
  for (const p of (row.f[2].v as string).split(',')) {
    const [off, l] = p.split(':').map(Number)
    m.set(off!, l!)
  }
  return m
}

const hhmm = (off: number) => {
  const d = new Date((T0 + off * 60) * 1000)
  return d.toISOString().slice(5, 16).replace('T', ' ')
}

function run(kind: 'stable' | 'eth', h: number) {
  const b = baseline(base[kind].baseline)
  const xs = series(kind)
  let S = 0
  const alarms: number[] = []
  for (let off = 0; off < END; off++) {
    const slot = Math.floor((T0 / 60 + off) / 60) % 168
    const { mu, sigma } = b[slot]!
    const L = xs.get(off) ?? 0
    S = Math.max(0, S + ((L - mu) * 1000) / sigma - K)
    if (S > h) {
      alarms.push(off)
      S = 0
    }
  }
  const before = alarms.filter((a) => a < EVENTS.first_test_transfer)
  const firstAfter = alarms.find((a) => a >= EVENTS.first_test_transfer)
  const preDays = EVENTS.first_test_transfer / 1440
  return {
    kind,
    h_milli: h,
    false_alarms_before_hack: before.length,
    false_alarms_per_day: Number((before.length / preDays).toFixed(2)),
    first_alarm_after_test_transfer: firstAfter === undefined ? null : hhmm(firstAfter),
    minutes_after_test_transfer: firstAfter === undefined ? null : firstAfter - EVENTS.first_test_transfer,
    minutes_after_large_outflows: firstAfter === undefined ? null : firstAfter - EVENTS.large_outflows,
    before_bitget_detected: firstAfter === undefined ? null : firstAfter < EVENTS.bitget_detected,
  }
}

const out = {
  source: 'public_onchain',
  wallet: base.wallet,
  events_utc: Object.fromEntries(Object.entries(EVENTS).map(([k, v]) => [k, hhmm(v)])),
  k_milli: K,
  results: [] as unknown[],
}
for (const kind of ['stable', 'eth'] as const)
  for (const h of [5000, 8000, 12000, 20000, 40000]) out.results.push(run(kind, h))
writeFileSync(join(root, 'analysis', 'out', 'bitget_cusum.json'), `${JSON.stringify(out, null, 2)}\n`)
console.table(out.results)

// ---- quota bucket worst-case bound vs what was actually taken (36_phase6.md 6.6 "最坏损失") ----
// r_max = Bitget 6's own per-active-minute p99 (public_onchain); C = 5 x r_max (multiplier assumed).
// Fast-lane outflow by minute T after the first large outflow is at most C + r_max * T, and a single
// transfer larger than the remaining quota goes to the manual lane instead.
const rmaxUsd = base.stable.p99_units_per_active_minute / 1e6
const rmaxEth = base.eth.p99_units_per_active_minute / 1e18
const C_MULT = 5
const theft = [
  { utc: '18:58:59', usd: 34_750_000, eth: 0 },
  { utc: '19:01:23', usd: 12_850_000, eth: 0 },
  { utc: '19:01:35', usd: 0, eth: 7130.86 },
  { utc: '19:16:23', usd: 0, eth: 13965.93 },
  { utc: '20:09:11', usd: 0, eth: 1879.2 },
  { utc: '20:09:23', usd: 0, eth: 1395.9 },
  { utc: '21:23:11', usd: 0, eth: 223.2 },
] // from datasets/public/bitget_2026-09.json (XAUt excluded)
const minutesAfter = (hms: string) => {
  const [h, m, s] = hms.split(':').map(Number)
  return Math.ceil((h! * 3600 + m! * 60 + s! - (18 * 3600 + 58 * 60)) / 60)
}
const bound = (T: number) => ({ usd: C_MULT * rmaxUsd + rmaxUsd * T, eth: C_MULT * rmaxEth + rmaxEth * T })
const actualBy = (T: number) =>
  theft
    .filter((x) => minutesAfter(x.utc) <= T)
    .reduce((a, x) => ({ usd: a.usd + x.usd, eth: a.eth + x.eth }), { usd: 0, eth: 0 })
const checkpoints = [1, 7, 18, 71, 146].map((T) => ({ minutes_after_1858: T, bound: bound(T), actual: actualBy(T) }))
const singleBlocked = theft.filter((x) => x.usd > C_MULT * rmaxUsd || x.eth > C_MULT * rmaxEth).length
const quota = {
  source: 'public_onchain (r_max) + assumed (C multiplier 5)',
  r_max_usd_per_min: rmaxUsd,
  r_max_eth_per_min: rmaxEth,
  C_usd: C_MULT * rmaxUsd,
  C_eth: C_MULT * rmaxEth,
  theft_transfers_larger_than_C: `${singleBlocked} of ${theft.length}`,
  checkpoints,
}
writeFileSync(join(root, 'analysis', 'out', 'bitget_cusum.json'), `${JSON.stringify({ ...out, quota }, null, 2)}\n`)
console.log(JSON.stringify(quota, (_, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v), 2))

// Synthetic normal withdrawal stream (20_data.md 3.3, source = assumed) and the assumed CUSUM baseline
// derived from it. BigQuery H0 (phase 6.6) replaces both; until then every number here is labelled assumed.
//
// Usage: bun src/gen-withdrawals.ts --org a [--days 28] [--seed 7]
// Writes datasets/out/withdrawals-<org>.json and datasets/out/cusum-baseline-<org>.json;
// with DATABASE_URL also datasets.synthetic_withdrawals.
import { join } from 'node:path'
import { db, readJson, repoRoot, rng, writeJson } from '@quorum/offchain'
import type { Account } from './types'

// ---- assumed parameters ----
export const W = {
  days: 28, // four weeks, one sample per hour-of-week slot per week
  amountFraction: { mu: Math.log(0.08), sigma: 0.9 }, // withdrawal size as a share of the balance
  newRecipientProb: 0.3,
  // relative activity by UTC hour (Asia-heavy user base: busy 01 to 15 UTC)
  hourWeight: [6, 8, 10, 10, 9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 3, 2, 2, 2, 2, 3, 3, 4, 5],
  weekendFactor: 0.7,
  ethUsd: 3000,
}

export type Wd = {
  org: string
  userId: string
  token: 'qUSD' | 'qETH'
  units: string
  usd: number
  ts: number
  newRecipient: boolean
}

function poisson(lambda: number, u: () => number): number {
  let k = 0
  let p = 1
  const L = Math.exp(-lambda)
  for (;;) {
    p *= u()
    if (p <= L) return k
    k++
  }
}

export function genWithdrawals(org: string, accounts: Account[], days: number, seed: number, t0: number): Wd[] {
  const r = rng(seed)
  const hourCum: number[] = []
  let acc = 0
  for (const w of W.hourWeight) {
    acc += w
    hourCum.push(acc)
  }
  const out: Wd[] = []
  for (const a of accounts) {
    const n = poisson((a.wdFreq * days) / 30, r.next)
    for (let i = 0; i < n; i++) {
      let day = Math.floor(r.next() * days)
      const dow = new Date((t0 + day * 86400) * 1000).getUTCDay()
      if ((dow === 0 || dow === 6) && r.next() > W.weekendFactor) day = (day + 2) % days
      const x = r.next() * acc
      const hour = hourCum.findIndex((c) => x < c)
      const ts = t0 + day * 86400 + hour * 3600 + Math.floor(r.next() * 3600)
      const ethShare = Number(a.deposits.qETH) > 0 && r.next() < 0.35
      const usd = Math.min(a.balanceUsd, a.balanceUsd * r.lognormal(W.amountFraction.mu, W.amountFraction.sigma))
      const token = ethShare ? 'qETH' : 'qUSD'
      const units =
        token === 'qUSD' ? BigInt(Math.round(usd * 1e6)) : BigInt(Math.round((usd / W.ethUsd) * 1e6)) * 10n ** 12n
      out.push({
        org,
        userId: a.userId,
        token,
        units: units.toString(),
        usd,
        ts,
        newRecipient: r.next() < W.newRecipientProb,
      })
    }
  }
  return out.sort((x, y) => x.ts - y.ts)
}

/** floor(log2(x + 1) * 1000), same as the Patrol CUSUM (workflows/patrol/src/logic/cusum.ts). */
export function log2milli(x: bigint): bigint {
  const v = x + 1n
  let msb = -1n
  for (let t = v; t > 0n; t >>= 1n) msb++
  const base = 1n << msb
  return msb * 1000n + ((v - base) * 1000n) / base
}

/** 168 (mu, sigma) per token from per-minute outflow; sigma floor 50 (10_interfaces.md section 10). */
export function baseline(ws: Wd[], token: 'qUSD' | 'qETH', t0: number, days: number) {
  const perMinute = new Map<number, bigint>()
  for (const w of ws) {
    if (w.token !== token) continue
    const m = Math.floor(w.ts / 60)
    perMinute.set(m, (perMinute.get(m) ?? 0n) + BigInt(w.units))
  }
  const buckets: number[][] = Array.from({ length: 168 }, () => [])
  const m0 = Math.floor(t0 / 60)
  for (let m = m0; m < m0 + days * 1440; m++) {
    const h = Math.floor(m / 60) % 168
    buckets[h]!.push(Number(log2milli(perMinute.get(m) ?? 0n)))
  }
  return buckets.map((b) => {
    const mu = b.reduce((s, x) => s + x, 0) / b.length
    const sd = Math.sqrt(b.reduce((s, x) => s + (x - mu) ** 2, 0) / b.length)
    return { mu: Math.round(mu), sigma: Math.max(50, Math.round(sd)) }
  })
}

if (import.meta.main) {
  const flag = (k: string, d: string) => {
    const i = process.argv.indexOf(`--${k}`)
    return i > 0 ? (process.argv[i + 1] ?? d) : d
  }
  const org = flag('org', 'a')
  const days = Number(flag('days', String(W.days)))
  const t0 = 1_758_844_800 // 2025-09-26 00:00 UTC, a fixed window so reruns are identical
  // ordinary accounts only: decoy accounts never withdraw on their own
  const accounts = readJson<Account[]>(join(repoRoot, 'datasets', 'out', `accounts-${org}.json`))
  const ws = genWithdrawals(org, accounts, days, Number(flag('seed', org === 'a' ? '7' : '8')), t0)
  writeJson(join(repoRoot, 'datasets', 'out', `withdrawals-${org}.json`), ws)
  const base = {
    source: 'assumed',
    note: 'from synthetic withdrawals; replace with BigQuery H0',
    tokens: { qUSD: baseline(ws, 'qUSD', t0, days), qETH: baseline(ws, 'qETH', t0, days) },
  }
  writeJson(join(repoRoot, 'datasets', 'out', `cusum-baseline-${org}.json`), base)
  console.log(`org ${org}: ${ws.length} withdrawals over ${days} days; baseline written`)
  if (process.env.DATABASE_URL) {
    const sql = db()
    await sql`delete from datasets.synthetic_withdrawals where org = ${org}`
    for (let i = 0; i < ws.length; i += 500) {
      const rows = ws.slice(i, i + 500).map((w) => ({
        org: w.org,
        user_id: w.userId,
        token: w.token,
        amount: w.usd,
        amount_units: w.units,
        ts: new Date(w.ts * 1000),
        new_recipient: w.newRecipient,
        source: 'assumed',
      }))
      await sql`insert into datasets.synthetic_withdrawals ${sql(rows)}`
    }
    await sql.end()
    console.log('wrote datasets.synthetic_withdrawals')
  }
}

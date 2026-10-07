// Step 1 (20_data.md section 4): synthetic accounts. All distribution parameters are ASSUMED.
// Usage: bun src/gen-accounts.ts [--org a] [--n 100] [--seed 2049]
import { join } from 'node:path'
import { db, repoRoot, rng, writeJson } from '@quorum/offchain'
import type { Account } from './types'

// ---- assumed parameters (source: assumed; heavy-tailed balances, lognormal age/activity) ----
export const PARAMS = {
  regDays: { mu: Math.log(200), sigma: 1.0 },
  activity: { mu: Math.log(4), sigma: 0.8 }, // sessions per week
  depFreq: { mu: Math.log(2), sigma: 0.7 }, // deposits per month
  wdFreq: { mu: Math.log(1.5), sigma: 0.7 },
  balanceUsd: { mu: Math.log(400), sigma: 1.4 },
  ethShare: 0.35, // share of balance held as qETH for accounts above 2,000 USD
  ethUsd: 3000,
  kyc: [0.15, 0.55, 0.3], // levels 1, 2, 3
}

const NAMES = [
  'amber',
  'birch',
  'cedar',
  'delta',
  'ember',
  'fjord',
  'grove',
  'harbor',
  'iris',
  'juniper',
  'kestrel',
  'lumen',
]

export function genAccounts(org: 'a' | 'b', n: number, seed: number, prefix = 'u'): Account[] {
  const r = rng(seed)
  const out: Account[] = []
  const used = new Set<string>()
  for (let i = 0; i < n; i++) {
    const bal = Math.min(r.lognormal(PARAMS.balanceUsd.mu, PARAMS.balanceUsd.sigma), 60_000)
    out.push(makeAccount(org, freshUserId(org, r, used, prefix), r, bal))
  }
  return out
}

/** Random, unique, sequence-free ids so later additions (decoys) cannot be spotted by id. */
export function freshUserId(org: string, r: ReturnType<typeof rng>, used: Set<string>, prefix = 'u'): string {
  for (;;) {
    const id = `${prefix}${org}-${Math.floor(r.next() * 900_000 + 100_000)}`
    if (!used.has(id)) {
      used.add(id)
      return id
    }
  }
}

export function makeAccount(org: 'a' | 'b', userId: string, r: ReturnType<typeof rng>, balanceUsd: number): Account {
  const k = r.next()
  const kycLevel = k < PARAMS.kyc[0]! ? 1 : k < PARAMS.kyc[0]! + PARAMS.kyc[1]! ? 2 : 3
  const usd = Math.max(15, balanceUsd)
  const eth = usd > 2000 ? (usd * PARAMS.ethShare) / PARAMS.ethUsd : 0
  const usdPart = usd - eth * PARAMS.ethUsd
  return {
    org,
    userId,
    displayName: `${NAMES[Math.floor(r.next() * NAMES.length)]}-${Math.floor(r.next() * 9000 + 1000)}`,
    kycLevel,
    regDays: r.lognormal(PARAMS.regDays.mu, PARAMS.regDays.sigma),
    activity: r.lognormal(PARAMS.activity.mu, PARAMS.activity.sigma),
    depFreq: r.lognormal(PARAMS.depFreq.mu, PARAMS.depFreq.sigma),
    wdFreq: r.lognormal(PARAMS.wdFreq.mu, PARAMS.wdFreq.sigma),
    balanceUsd: usd,
    deposits: {
      qUSD: String(BigInt(Math.round(usdPart * 100)) * 10_000n), // cents -> 6 decimals
      qETH: eth > 0 ? String(BigInt(Math.round(eth * 1e6)) * 10n ** 12n) : '0',
    },
  }
}

if (import.meta.main) {
  const arg = (k: string, d: string) => {
    const i = process.argv.indexOf(`--${k}`)
    return i > 0 ? (process.argv[i + 1] ?? d) : d
  }
  const org = arg('org', 'a') as 'a' | 'b'
  const n = Number(arg('n', org === 'a' ? '100' : '50'))
  const accounts = genAccounts(org, n, Number(arg('seed', '2049')))
  const path = join(repoRoot, 'datasets', 'out', `accounts-${org}.json`)
  writeJson(path, accounts)
  console.log(`wrote ${accounts.length} accounts to ${path}`)
  if (process.env.DATABASE_URL) {
    const sql = db()
    for (const a of accounts) {
      await sql`insert into datasets.synthetic_accounts (org, user_id, reg_days, activity, dep_freq, wd_freq, kyc_level, balance_usd)
                values (${org}, ${a.userId}, ${a.regDays}, ${a.activity}, ${a.depFreq}, ${a.wdFreq}, ${a.kycLevel}, ${a.balanceUsd})
                on conflict (org, user_id) do nothing`
    }
    await sql.end()
    console.log('wrote datasets.synthetic_accounts')
  }
}

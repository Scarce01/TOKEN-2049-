// False-positive replay (41_evaluation.md section 6; D44, D54). Runs the synthetic normal withdrawal
// stream through the real Cosign phase 5 judge (score carried per user) and reports how often a normal
// user is delayed or sent to manual review. source = assumed (synthetic traffic, assumed lambdas).
//
// Usage: bun analysis/false_positive.ts [--org a]
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Address, type Hex, hexToBytes, keccak256, toBytes } from 'viem'
import { Decision, Reason, txHash } from '../packages/shared/src/index'
import { judge, type Phase5Reads, type Reads } from '../workflows/cosign/src/logic/gates'
import { DEFAULT_SPRT, EMPTY_SCORE, type ScoreState } from '../workflows/cosign/src/logic/sprt'

const root = join(import.meta.dir, '..')
const org = process.argv.includes('--org') ? process.argv[process.argv.indexOf('--org') + 1]! : 'a'
type Acc = { userId: string; regDays: number; balanceUsd: number; deposits: { qUSD: string; qETH: string } }
type Wd = { userId: string; token: 'qUSD' | 'qETH'; units: string; ts: number; newRecipient: boolean }
const accounts = new Map(
  (JSON.parse(readFileSync(join(root, 'datasets', 'out', `accounts-${org}.json`), 'utf8')) as Acc[]).map((a) => [
    a.userId,
    a,
  ]),
)
const wds = JSON.parse(readFileSync(join(root, 'datasets', 'out', `withdrawals-${org}.json`), 'utf8')) as Wd[]

const K = hexToBytes(keccak256(toBytes('replay-k'))) // any K: thresholds are drawn from the configured range
const QUSD = '0x6666666666666666666666666666666666666666' as Address
const QETH = '0x7777777777777777777777777777777777777770' as Address
const HOT = '0x1111111111111111111111111111111111111111' as Address
const E18 = 10n ** 18n
const L1_DELAY = 600n

const scores = new Map<string, ScoreState>()
const approved = new Map<string, [bigint, bigint]>()
const seen = new Set<string>()
let pending = 0
let delayed = 0
const reasons: Record<number, number> = {}

for (const w of wds) {
  const a = accounts.get(w.userId)
  if (!a) continue
  const t = BigInt(w.ts)
  const token = w.token === 'qUSD' ? QUSD : QETH
  const amount = BigInt(w.units)
  const to = (
    w.newRecipient || !seen.has(w.userId)
      ? keccak256(toBytes(`${w.userId}-${w.ts}`)).slice(0, 42)
      : keccak256(toBytes(`${w.userId}-home`)).slice(0, 42)
  ) as Address
  const uid = keccak256(toBytes(w.userId))
  const appr = approved.get(w.userId) ?? [0n, 0n]
  const p5: Phase5Reads = {
    sprt: DEFAULT_SPRT,
    prevScore: scores.get(w.userId) ?? EMPTY_SCORE,
    seenRecipient: !w.newRecipient && seen.has(w.userId),
    firstDepositAt: t - BigInt(Math.floor(a.regDays * 86400)),
    tokens: [QUSD, QETH],
    decimals: [6, 18],
    depositedAll: [BigInt(a.deposits.qUSD), BigInt(a.deposits.qETH)],
    approvedAll: appr,
    usdToken: QUSD,
    price: 3000_00000000n,
    priceDecimals: 8,
    priceUpdatedAt: t - 60n,
    maxPriceAge: 3600n,
    thresholds: {
      [QETH.toLowerCase()]: { tMin: E18, tMax: 3n * E18 },
      [QUSD.toLowerCase()]: { tMin: 500_000_000n, tMax: 2_000_000_000n },
    },
    epochLen: 3600n,
    fakeThreshold: { [QETH.toLowerCase()]: 5n * E18 },
    l1Delay: L1_DELAY,
  }
  const requestId = keccak256(toBytes(`${w.userId}-${w.ts}-req`))
  const deadline = t + 3600n
  const r: Reads = {
    chainId: 84532n,
    blockTime: t,
    request: {
      requestId,
      orgId: keccak256(toBytes('exchange-a')),
      userIdHash: uid,
      kind: 0,
      vault: HOT,
      token,
      to,
      amount,
      nonce: 1n,
      deadline,
      txHash: txHash({
        chainId: 84532,
        vault: HOT,
        requestId,
        userIdHash: uid,
        token,
        to,
        amount,
        nonce: 1n,
        deadline,
      }),
    },
    intent: {
      orgId: keccak256(toBytes('exchange-a')),
      userIdHash: uid,
      vault: HOT,
      token,
      to,
      amount,
      nonce: 1n,
      deadline,
    },
    signer: HOT,
    orgVaults: [HOT],
    allowedTokens: [QUSD, QETH],
    key: HOT,
    deposited: token === QUSD ? p5.depositedAll[0]! : p5.depositedAll[1]!,
    approved: token === QUSD ? appr[0] : appr[1],
    toIsSuspect: false,
    fingerprintActive: false,
    activeConfirmedCount: 0n,
    k: K,
    decoyTags: new Set(),
    p5,
  }
  const j = judge(r)
  if (j.score) scores.set(w.userId, j.score.next)
  if (j.decision === Decision.PENDING) {
    pending++
    for (const c of j.codes) reasons[c] = (reasons[c] ?? 0) + 1
  } else if (j.decision === Decision.APPROVE) {
    if ((j.notBefore ?? 0n) > 0n) delayed++
    approved.set(w.userId, token === QUSD ? [appr[0] + amount, appr[1]] : [appr[0], appr[1] + amount])
    seen.add(w.userId)
  }
}

const n = wds.length
const days = 28
const res = {
  org,
  withdrawals: n,
  pending,
  delayed_l1: delayed,
  false_pending_rate: pending / n,
  delayed_per_10k: ((pending + delayed) / n) * 10_000,
  added_wait_avg_seconds_for_delayed: delayed ? Number(L1_DELAY) : 0,
  manual_reviews_per_day: pending / days,
  reasons: Object.fromEntries(
    Object.entries(reasons).map(([c, k]) => [
      `${c} ${Object.entries(Reason).find(([, v]) => v === Number(c))?.[0] ?? ''}`,
      k,
    ]),
  ),
  source: 'assumed',
  note: 'synthetic traffic; most PENDING come from gate 5 (deposits fully withdrawn) and gate 7 caps',
}
writeFileSync(join(root, 'analysis', 'out', `false_positive_${org}.json`), `${JSON.stringify(res, null, 2)}\n`)
console.log(JSON.stringify(res, null, 2))
export type { Hex }

// Layout of the attacker-visible hot-wallet list (balances and labels). Lives only in
// secrets/visible-wallets.layout.local.json, never in git: the source must not tell which row is the decoy (rule 2,
// audit 2026-10-07 H3). Labels come from the same generator as decoy labels (labels.ts), so the numbering range
// is no fingerprint either.
import { randomInt } from 'node:crypto'
import { HOT_PREFIXES, randomLabel } from './labels'

export type VisibleLayout = { synthetic: { label: string; amount: string }[]; decoyAmount: string; decoyRank: number }

const Q = 1_000_000n // 1 qUSD (6 decimals)

/**
 * Random layout around one decoy. Whole-qUSD balances, all distinct in the top band, so the ranking is unambiguous.
 * The decoy lands at rank 2 or 3 (the red-team demo probes the top 3); which one is random and stays in secrets.
 */
export function makeLayout(
  decoyLabel: string,
  n = 19,
  rnd: (lo: number, hi: number) => number = randomInt,
): VisibleLayout {
  const taken = new Set([decoyLabel])
  const used = new Set<number>()
  const pick = (lo: number, hi: number) => {
    for (;;) {
      const v = rnd(lo, hi)
      if (!used.has(v)) {
        used.add(v)
        return v
      }
    }
  }
  const decoy = pick(40, 71)
  const above = rnd(1, 3) // 1 or 2 wallets above the decoy
  const near = rnd(2, 4) // 2 or 3 just below it
  const amounts = [
    ...Array.from({ length: above }, () => pick(decoy + 1, 91)),
    ...Array.from({ length: near }, () => pick(25, decoy)),
  ]
  while (amounts.length < n) amounts.push(rnd(1, 11)) // small sweepers, ties allowed far below the top band
  return {
    synthetic: amounts.map((a) => ({ label: randomLabel(HOT_PREFIXES, taken), amount: (BigInt(a) * Q).toString() })),
    decoyAmount: (BigInt(decoy) * Q).toString(),
    decoyRank: above + 1,
  }
}

/** Rank (1-based) of the decoy when every row is sorted by balance, highest first. */
export function decoyRankOf(l: VisibleLayout): number {
  const d = BigInt(l.decoyAmount)
  return l.synthetic.filter((r) => BigInt(r.amount) > d).length + 1
}

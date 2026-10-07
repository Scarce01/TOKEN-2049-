import { describe, expect, test } from 'bun:test'
import { HOT_PREFIXES } from '../src/labels'
import { decoyRankOf, makeLayout } from '../src/visible-layout'

describe('attacker-visible layout (audit 2026-10-07 H3)', () => {
  test('over many layouts: decoy rank 2 or 3, unambiguous top band, labels unique and in the decoy label space', () => {
    const ranks = new Set<number>()
    for (let i = 0; i < 300; i++) {
      const decoyLabel = `${HOT_PREFIXES[i % 3]}-${String((i % 99) + 1).padStart(2, '0')}`
      const l = makeLayout(decoyLabel)
      expect(l.synthetic.length).toBe(19)
      expect(decoyRankOf(l)).toBe(l.decoyRank)
      expect([2, 3]).toContain(l.decoyRank)
      ranks.add(l.decoyRank)
      const labels = l.synthetic.map((r) => r.label)
      expect(new Set(labels).size).toBe(labels.length)
      expect(labels).not.toContain(decoyLabel)
      for (const lb of labels) expect(lb).toMatch(/^(hot-legacy|hot-reserve|ops-sweeper)-\d{2}$/)
      const top = [l.decoyAmount, ...l.synthetic.map((r) => r.amount)]
        .map(BigInt)
        .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))
        .slice(0, 5)
      expect(new Set(top.map(String)).size).toBe(5) // no ties in the top five
    }
    expect(ranks.size).toBe(2) // both ranks occur, so the rank itself is not a constant anyone can learn from git
  })
})

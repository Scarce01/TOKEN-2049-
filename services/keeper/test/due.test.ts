import { describe, expect, test } from 'bun:test'
import type { Hex } from 'viem'
import { type Candidate, isDue, type VerdictState } from '../src/due'

const T = 1_000_000n
const c: Candidate = {
  txHash: '0x01' as Hex,
  vault: '0x0000000000000000000000000000000000000001',
  vaultTx: {} as never,
}
const v = (over: Partial<VerdictState> = {}): VerdictState => ({
  decision: 1,
  used: false,
  released: false,
  notBefore: T - 1n,
  expiresAt: T + 900n,
  heldUntil: 0n,
  ...over,
})

describe('keeper: which approved withdrawals to send now (docs/47 3.1)', () => {
  test('due: APPROVE, unused, past notBefore, before expiry, not held', () => {
    expect(isDue(c, v(), T)).toBe('send')
  })
  test('immediate APPROVE (notBefore 0) is due too', () => {
    expect(isDue(c, v({ notBefore: 0n }), T)).toBe('send')
  })
  test('too early or held: wait and retry later', () => {
    expect(isDue(c, v({ notBefore: T + 10n }), T)).toBe('wait')
    expect(isDue(c, v({ heldUntil: T + 10n }), T)).toBe('wait')
  })
  test('used, cancelled, expired, PENDING or REJECT: drop', () => {
    expect(isDue(c, v({ used: true }), T)).toBe('drop')
    expect(isDue(c, v({ released: true }), T)).toBe('drop')
    expect(isDue(c, v({ expiresAt: T - 1n }), T)).toBe('drop')
    expect(isDue(c, v({ decision: 3 }), T)).toBe('drop')
    expect(isDue(c, v({ decision: 2 }), T)).toBe('drop')
  })
  test('no verdict yet: wait', () => {
    expect(isDue(c, v({ decision: 0 }), T)).toBe('wait')
  })
})

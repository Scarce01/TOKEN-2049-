import { describe, expect, test } from 'bun:test'
import type { Address, Hex } from 'viem'
import { type Ev, fmtAmount, notificationsFor, type Req } from '../src/compose'

const QUSD = '0x0000000000000000000000000000000000000001' as Address
const info = () => ({ symbol: 'qUSD', decimals: 6 })
const tx = '0x11' as Hex
const reqs = new Map<Hex, Req>([
  [
    tx,
    {
      txHash: tx,
      userIdHash: '0xaa' as Hex,
      to: '0xAbCdEf0000000000000000000000000000001234',
      amount: 3_000_500_000n,
      token: QUSD,
    },
  ],
])
const now = 1_000_000n
const run = (e: Ev) => notificationsFor(reqs, [e], now, info)

describe('notifier composes what the chain says (docs/47 3.5)', () => {
  test('delayed APPROVE: amount, recipient, minutes left, how to cancel', () => {
    const [n] = run({ kind: 'verdict', txHash: tx, decision: 1, notBefore: now + 3600n })
    expect(n!.kind).toBe('delayed')
    expect(n!.text).toBe(
      'Withdrawal of 3,000.5 qUSD to 0xAbCd…1234 releases in 60 min. Not you? Cancel it in the app before then.',
    )
    expect(n!.userIdHash).toBe('0xaa')
  })
  test('immediate APPROVE, PENDING and REJECT each get their own message', () => {
    expect(run({ kind: 'verdict', txHash: tx, decision: 1, notBefore: 0n })[0]!.kind).toBe('approved')
    expect(run({ kind: 'verdict', txHash: tx, decision: 3, notBefore: 0n })[0]!.text).toContain(
      'paused for a security check',
    )
    expect(run({ kind: 'verdict', txHash: tx, decision: 2, notBefore: 0n })[0]!.text).toContain('was rejected')
  })
  test('held, cancelled by user, cancelled by officers, paid', () => {
    expect(run({ kind: 'held', txHash: tx, until: now + 600n })[0]!.kind).toBe('held')
    expect(run({ kind: 'userCancelled', txHash: tx })[0]!.text).toContain('cancelled by you')
    expect(run({ kind: 'officerCancelled', txHash: tx })[0]!.text).toContain('security team')
    expect(run({ kind: 'paid', txHash: tx })[0]!.text).toContain('was sent')
  })
  test('events for unknown requests produce nothing', () => {
    expect(notificationsFor(reqs, [{ kind: 'paid', txHash: '0x99' as Hex }], now, info)).toEqual([])
  })
  test('amount formatting keeps two decimals at most and no trailing zeros', () => {
    expect(fmtAmount(3_000_500_000n, 6)).toBe('3,000.5')
    expect(fmtAmount(50_000_000n, 6)).toBe('50')
    expect(fmtAmount(1_234_567_890_000_000_000n, 18)).toBe('1.23')
  })
})

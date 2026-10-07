import { describe, expect, test } from 'bun:test'
import { decodeAction, Kind } from '../../../packages/shared/src/index'
import { decideTrap, receiptHasLog, type TrapFacts } from '../src/logic/decide'

const ORG = '0xae4676874fd6398fe5f19869ae4c627651b922a81f7c8cd078dbbb12444b012d'
const HOT = '0x1111111111111111111111111111111111111111'
const WARM = '0x2222222222222222222222222222222222222222'
const DECOY = '0x3333333333333333333333333333333333333333'
const DECOY_ADDR = '0x4444444444444444444444444444444444444444'
const ATTACKER = '0x5555555555555555555555555555555555555555'
const QUSD = '0x6666666666666666666666666666666666666666'

const base: TrapFacts = {
  chainId: 84532n,
  token: QUSD,
  from: DECOY,
  to: ATTACKER,
  amount: 840_000n,
  txHash: `0x${'ab'.repeat(32)}`,
  logIndex: 3n,
  blockTime: 1_760_000_000n,
  tokenDecimals: 6,
  decoyWallets: [{ address: DECOY, orgId: ORG }],
  decoyAddresses: [{ address: DECOY_ADDR, orgId: ORG }],
  vaults: [{ orgId: ORG, hot: HOT, warm: WARM }],
  protectedAddrs: [HOT, WARM],
  tokens: [QUSD],
  freezeDuration: 7200n,
  alertTtl: 7200n,
  coldDelay: 259200n,
  threatTtl: 259200n,
}

describe('trap decide', () => {
  test('A: decoy wallet outflow is a full confirmed pack with the recipient as suspect (D02)', () => {
    const d = decideTrap(base)!
    expect(d.kind).toBe('A')
    expect(d.actions.map((a) => a.kind)).toEqual([
      Kind.FREEZE,
      Kind.QUOTA_ZERO,
      Kind.SWEEP,
      Kind.ALERT,
      Kind.COLD_DELAY,
      Kind.THREAT,
    ])
    const threat = decodeAction(d.actions[5]!)
    expect((threat[0] as string).toLowerCase()).toBe(ATTACKER)
    // times come from the block, not the clock
    expect(decodeAction(d.actions[0]!)[1]).toBe(base.blockTime + 7200n)
  })

  test('A: outflow to our own contract or zero yields suspect 0', () => {
    expect(decideTrap({ ...base, to: HOT })!.suspect).toBe('0x0000000000000000000000000000000000000000')
    expect(decideTrap({ ...base, to: '0x0000000000000000000000000000000000000000' })!.suspect).toBe(
      '0x0000000000000000000000000000000000000000',
    )
  })

  test('B: our vault paying a decoy address tightens with suspect 0', () => {
    const d = decideTrap({ ...base, from: HOT, to: DECOY_ADDR })!
    expect(d.kind).toBe('B')
    expect(d.suspect).toBe('0x0000000000000000000000000000000000000000')
  })

  test('stranger paying a decoy address does nothing (D06)', () => {
    expect(decideTrap({ ...base, from: ATTACKER, to: DECOY_ADDR })).toBeNull()
  })

  test('zero-value Transfer never trips a trap (transferFrom(x, y, 0) needs no allowance)', () => {
    expect(decideTrap({ ...base, amount: 0n })).toBeNull()
    expect(decideTrap({ ...base, from: HOT, to: DECOY_ADDR, amount: 0n })).toBeNull()
  })

  test('unrelated transfer does nothing', () => {
    expect(decideTrap({ ...base, from: ATTACKER, to: HOT })).toBeNull()
  })

  test('deterministic: same facts, same actions', () => {
    expect(JSON.stringify(decideTrap(base))).toBe(JSON.stringify(decideTrap(base)))
  })

  test('receipt must contain the exact log (D48)', () => {
    const log = {
      address: QUSD as `0x${string}`,
      topics: ['0x01', '0x02'] as `0x${string}`[],
      data: '0xff' as `0x${string}`,
      index: 3,
    }
    expect(receiptHasLog([log], log)).toBe(true)
    expect(receiptHasLog([{ ...log, data: '0xfe' }], log)).toBe(false)
    expect(receiptHasLog([{ ...log, index: 4 }], log)).toBe(false)
  })
})

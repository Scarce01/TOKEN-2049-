import { describe, expect, test } from 'bun:test'
import { caseIdNative, caseIdTrap, caseIdWithdrawal } from '@quorum/shared'
import { matchTrips, type Trap } from '../src/match'

const ORG = '0xae4676874fd6398fe5f19869ae4c627651b922a81f7c8cd078dbbb12444b012d'
const W = '0x3333333333333333333333333333333333333333'
const A = '0x4444444444444444444444444444444444444444'
const U = `0x${'11'.repeat(32)}` as const
const TX = `0x${'ab'.repeat(32)}` as const
const traps: Trap[] = [
  { id: 1, org_id: ORG, kind: 'wallet_erc20', ref: W, status: 'armed' },
  { id: 2, org_id: ORG, kind: 'wallet_native', ref: W, status: 'armed' },
  { id: 3, org_id: ORG, kind: 'account', ref: U, status: 'armed' },
  { id: 4, org_id: ORG, kind: 'address', ref: A, status: 'armed' },
]

describe('trap-sync matching', () => {
  test('erc20 decoy outflow uses the Trap case id', () => {
    const t = matchTrips(traps, 84532, [{ from: W, txHash: TX, logIndex: 2, block: 10n }], [], [], [])
    expect(t).toEqual([{ id: 1, trippedTx: TX, caseId: caseIdTrap(ORG, 84532, TX, 2), block: 10n }])
  })

  test('native drop finds the Patrol case within 200 blocks', () => {
    const c = caseIdNative(ORG, 84532, W, 130n)
    const t = matchTrips(traps, 84532, [], [], [{ caseId: c, block: 131n }], [{ address: W, block: 100n, txHash: TX }])
    expect(t[0]?.caseId).toBe(c)
  })

  test('decoy account request; decoy address only when the case was tightened', () => {
    const rid = `0x${'22'.repeat(32)}` as const
    const req = {
      orgId: ORG as `0x${string}`,
      requestId: rid,
      userIdHash: U,
      to: A as `0x${string}`,
      txHash: TX,
      block: 5n,
    }
    const c = caseIdWithdrawal(ORG, rid)
    expect(matchTrips(traps.slice(2, 3), 84532, [], [req], [], [])[0]?.caseId).toBe(c)
    expect(matchTrips(traps.slice(3), 84532, [], [req], [], [])).toEqual([])
    expect(matchTrips(traps.slice(3), 84532, [], [req], [{ caseId: c, block: 6n }], [])).toHaveLength(1)
  })

  test('already tripped rows are left alone', () => {
    expect(
      matchTrips(
        [{ ...traps[0]!, status: 'tripped' }],
        84532,
        [{ from: W, txHash: TX, logIndex: 0, block: 1n }],
        [],
        [],
        [],
      ),
    ).toEqual([])
  })
})

import { describe, expect, test } from 'bun:test'
import { Kind } from '../../../packages/shared/src/index'
import { checkDecoys, type DecoyFacts, parsePatrolDecoys } from '../src/logic/decoys'

const ORG = '0xae4676874fd6398fe5f19869ae4c627651b922a81f7c8cd078dbbb12444b012d'
const base: DecoyFacts = {
  chainId: 84532n,
  anchorBlock: 1000n,
  anchorTime: 1_760_000_000n,
  decoys: [{ address: '0x3333333333333333333333333333333333333333', orgId: ORG, floor: 10_000_000_000_000_000n }],
  balAnchor: [10_000_000_000_000_000n],
  balPrev: [10_000_000_000_000_000n],
  orgs: [
    {
      orgId: ORG,
      hot: '0x1111111111111111111111111111111111111111',
      warm: '0x2222222222222222222222222222222222222222',
    },
  ],
  tokens: ['0x6666666666666666666666666666666666666666'],
  freezeDuration: 7200n,
  alertTtl: 7200n,
  coldDelay: 259200n,
  threatTtl: 259200n,
}

describe('patrol decoys', () => {
  test('untouched decoy: nothing', () => {
    expect(checkDecoys(base)).toEqual([])
  })

  test('balance below floor trips a confirmed pack (D03)', () => {
    const t = checkDecoys({ ...base, balAnchor: [9_000_000_000_000_000n] })
    expect(t).toHaveLength(1)
    expect(t[0]!.reason).toBe('floor')
    expect(t[0]!.actions.map((a) => a.kind)).toEqual([
      Kind.FREEZE,
      Kind.QUOTA_ZERO,
      Kind.SWEEP,
      Kind.ALERT,
      Kind.COLD_DELAY,
      Kind.THREAT,
    ])
  })

  test('drop inside the window while still above floor trips (D03 second check)', () => {
    const t = checkDecoys({ ...base, balPrev: [15_000_000_000_000_000n], balAnchor: [12_000_000_000_000_000n] })
    expect(t[0]!.reason).toBe('window')
  })

  test('balance going up (life traces) never trips', () => {
    expect(checkDecoys({ ...base, balAnchor: [20_000_000_000_000_000n] })).toEqual([])
  })

  test('old state unreadable: floor check only', () => {
    expect(checkDecoys({ ...base, balPrev: null, balAnchor: [12_000_000_000_000_000n] })).toEqual([])
  })

  test('secret parsing', () => {
    expect(parsePatrolDecoys('[{"a":"0x3333333333333333333333333333333333333333","o":"0x01","f":"5"}]')[0]!.floor).toBe(
      5n,
    )
  })
})

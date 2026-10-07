import { describe, expect, test } from 'bun:test'
import { type Address, hexToBytes, keccak256, toBytes } from 'viem'
import {
  Decision,
  decodeAction,
  decoyTag,
  ENVELOPE_LEN,
  Kind,
  Reason,
  sealPublicKey,
  txHash,
} from '../../../packages/shared/src/index'
import { buildCosign } from '../src/logic/build'
import { judge, type Reads } from '../src/logic/gates'

const ORG = '0xae4676874fd6398fe5f19869ae4c627651b922a81f7c8cd078dbbb12444b012d'
const HOT: Address = '0x1111111111111111111111111111111111111111'
const WARM: Address = '0x2222222222222222222222222222222222222222'
const QUSD: Address = '0x6666666666666666666666666666666666666666'
const KEY: Address = '0x7777777777777777777777777777777777777777'
const TO: Address = '0x8888888888888888888888888888888888888888'
const K = hexToBytes(keccak256(toBytes('K')))
const UID = keccak256(toBytes('user-1'))
const RID = keccak256(toBytes('req-1'))

function reads(over: Partial<Reads> = {}): Reads {
  const req = {
    requestId: RID,
    orgId: ORG,
    userIdHash: UID,
    kind: 0,
    vault: HOT,
    token: QUSD,
    to: TO,
    amount: 100_000_000n,
    nonce: 1n,
    deadline: 1_760_003_600n,
    txHash: txHash({
      chainId: 84532,
      vault: HOT,
      requestId: RID,
      userIdHash: UID,
      token: QUSD,
      to: TO,
      amount: 100_000_000n,
      nonce: 1n,
      deadline: 1_760_003_600n,
    }),
  } as const
  return {
    chainId: 84532n,
    blockTime: 1_760_000_000n,
    request: { ...req },
    intent: {
      orgId: ORG,
      userIdHash: UID,
      vault: HOT,
      token: QUSD,
      to: TO,
      amount: req.amount,
      nonce: 1n,
      deadline: req.deadline,
    },
    signer: KEY,
    orgVaults: [HOT, WARM],
    allowedTokens: [QUSD],
    key: KEY,
    deposited: 1_000_000_000n,
    approved: 0n,
    toIsSuspect: false,
    fingerprintActive: false,
    activeConfirmedCount: 0n,
    k: K,
    decoyTags: new Set(),
    ...over,
  }
}

describe('cosign gates', () => {
  test('happy path approves', () => {
    expect(judge(reads()).decision).toBe(Decision.APPROVE)
  })

  test('gate 1: tampered txHash rejects 11 (D14.1)', () => {
    const r = reads()
    r.request.txHash = keccak256(toBytes('other'))
    expect(judge(r)).toMatchObject({ decision: Decision.REJECT, publicReason: Reason.R1_TXHASH })
  })

  test('gate 2: Safe tx, foreign vault, unlisted token (D14.2)', () => {
    const r = reads()
    r.request.kind = 1
    expect(judge(r).publicReason).toBe(Reason.R2_SAFE_TX)
    expect(judge(reads({ orgVaults: [WARM] })).publicReason).toBe(Reason.R2_VAULT)
    expect(judge(reads({ allowedTokens: [] })).publicReason).toBe(Reason.R2_TOKEN)
  })

  test('gate 3: wrong signer, no key, field mismatch, expired (D14.3)', () => {
    expect(judge(reads({ signer: TO })).publicReason).toBe(Reason.R3_SIGNER)
    expect(judge(reads({ key: '0x0000000000000000000000000000000000000000' })).publicReason).toBe(Reason.R3_SIGNER)
    const r = reads()
    r.intent.amount = 1n
    expect(judge(r).publicReason).toBe(Reason.R3_FIELDS)
    expect(judge(reads({ blockTime: 1_760_003_601n })).publicReason).toBe(Reason.R3_EXPIRED)
  })

  test('gate 4: shared list -> PENDING 42, publicReason 0', () => {
    expect(judge(reads({ toIsSuspect: true }))).toMatchObject({
      decision: Decision.PENDING,
      publicReason: 0,
      codes: [42],
    })
  })

  test('fingerprint hit is recorded but does not change the decision', () => {
    const j = judge(reads({ fingerprintActive: true }))
    expect(j.decision).toBe(Decision.APPROVE)
    expect(j.codes).toEqual([Reason.R4_FINGERPRINT])
  })

  test('gate 5: approved + amount over deposit -> PENDING 51 (D14.5)', () => {
    expect(judge(reads({ approved: 950_000_000n })).codes[0]).toBe(Reason.R5_OVER_DEPOSIT)
    expect(judge(reads({ approved: 900_000_000n })).decision).toBe(Decision.APPROVE)
  })

  test('decoy account fires before gate 3, even with a forged signature (D14.4)', () => {
    const tags = new Set([decoyTag(K, 'acct', UID)])
    const j = judge(reads({ decoyTags: tags, signer: TO }))
    expect(j).toMatchObject({ decision: Decision.PENDING, codes: [41] })
    expect(j.confirmed?.suspect).toBe(TO)
  })

  test('decoy recipient address -> PENDING 43 with suspect 0', () => {
    const j = judge(reads({ decoyTags: new Set([decoyTag(K, 'addr', TO)]) }))
    expect(j.codes).toEqual([43])
    expect(j.confirmed?.suspect).toBe('0x0000000000000000000000000000000000000000')
  })

  test('network follow level only records (max 1)', () => {
    expect(judge(reads({ activeConfirmedCount: 3n })).networkLevel).toBe(1)
  })
})

describe('cosign report build', () => {
  const sealKeys = [sealPublicKey(keccak256(toBytes('o1'))), sealPublicKey(keccak256(toBytes('o2')))]
  const common = {
    eventTxHash: keccak256(toBytes('tx')),
    eventLogIndex: 2n,
    hotVault: HOT,
    warmVault: WARM,
    tokens: [QUSD],
    tokenDecimals: 6,
    officerSealKeys: sealKeys,
    verdictTtl: 900n,
    freezeDuration: 7200n,
    alertTtl: 7200n,
    coldDelay: 259200n,
    threatTtl: 259200n,
  }

  test('APPROVE: one VERDICT with expiry from block time', () => {
    const r = reads()
    const out = buildCosign({ ...common, reads: r, judgement: judge(r) })
    expect(out.actions.map((a) => a.kind)).toEqual([Kind.VERDICT])
    const v = decodeAction(out.actions[0]!)
    expect(v[8]).toBe(r.blockTime + 900n)
  })

  test('decoy: confirmed pack then VERDICT PENDING', () => {
    const r = reads({ decoyTags: new Set([decoyTag(K, 'acct', UID)]) })
    const out = buildCosign({ ...common, reads: r, judgement: judge(r) })
    expect(out.actions.map((a) => a.kind)).toEqual([
      Kind.FREEZE,
      Kind.QUOTA_ZERO,
      Kind.SWEEP,
      Kind.ALERT,
      Kind.COLD_DELAY,
      Kind.THREAT,
      Kind.VERDICT,
    ])
  })

  test('PENDING verdicts are indistinguishable: publicReason 0, expiresAt 0, same sealed length (D15)', () => {
    const variants = [
      reads({ toIsSuspect: true }),
      reads({ approved: 999_999_999n }),
      reads({ decoyTags: new Set([decoyTag(K, 'addr', TO)]) }),
    ]
    const shapes = variants.map((r) => {
      const out = buildCosign({ ...common, reads: r, judgement: judge(r) })
      const v = decodeAction(out.actions[out.actions.length - 1]!)
      return {
        decision: v[5],
        publicReason: v[6],
        notBefore: v[7],
        expiresAt: v[8],
        sealedLen: (v[9] as string).length,
      }
    })
    for (const s of shapes) {
      expect(s).toEqual({
        decision: Decision.PENDING,
        publicReason: 0,
        notBefore: 0n,
        expiresAt: 0n,
        sealedLen: 2 + 2 * ENVELOPE_LEN * 2,
      })
    }
  })

  test('deterministic: same event twice gives identical bytes (D30)', () => {
    const a = buildCosign({ ...common, reads: reads(), judgement: judge(reads()) })
    const b = buildCosign({ ...common, reads: reads(), judgement: judge(reads()) })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

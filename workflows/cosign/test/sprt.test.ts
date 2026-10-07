import { describe, expect, test } from 'bun:test'
import { type Address, type Hex, hexToBytes, keccak256, toBytes } from 'viem'
import { Decision, decodeAction, Kind, Reason, txHash } from '../../../packages/shared/src/index'
import { buildCosign } from '../src/logic/build'
import { judge, type Phase5Reads, type Reads } from '../src/logic/gates'
import {
  DEFAULT_SPRT,
  decay,
  decryptScore,
  EMPTY_SCORE,
  encryptScore,
  epochOf,
  lambdas,
  levelOf,
  scoreKey,
  thresholdCommitment,
  thresholdNonce,
  thresholdOf,
} from '../src/logic/sprt'

const ORG = '0xae4676874fd6398fe5f19869ae4c627651b922a81f7c8cd078dbbb12444b012d'
const HOT: Address = '0x1111111111111111111111111111111111111111'
const QUSD: Address = '0x6666666666666666666666666666666666666666'
const QETH: Address = '0x7777777777777777777777777777777777777770'
const KEY: Address = '0x7777777777777777777777777777777777777777'
const TO: Address = '0x8888888888888888888888888888888888888888'
const K = hexToBytes(keccak256(toBytes('K')))
const UID = keccak256(toBytes('user-1'))
const T0 = 1_760_000_000n
const E18 = 10n ** 18n

function p5(over: Partial<Phase5Reads> = {}): Phase5Reads {
  return {
    sprt: DEFAULT_SPRT,
    prevScore: EMPTY_SCORE,
    seenRecipient: true,
    firstDepositAt: T0 - 30n * 86400n,
    tokens: [QUSD, QETH],
    decimals: [6, 18],
    depositedAll: [10_000_000_000n, 10n * E18],
    approvedAll: [0n, 0n],
    usdToken: QUSD,
    price: 3000_00000000n,
    priceDecimals: 8,
    priceUpdatedAt: T0 - 60n,
    maxPriceAge: 3600n,
    thresholds: {
      [QETH.toLowerCase()]: { tMin: 1n * E18, tMax: 3n * E18 },
      [QUSD.toLowerCase()]: { tMin: 500_000_000n, tMax: 2_000_000_000n },
    },
    epochLen: 3600n,
    fakeThreshold: { [QETH.toLowerCase()]: 5n * E18 },
    l1Delay: 600n,
    d2Delay: 3600n,
    d3Delay: 86400n,
    ...over,
  }
}

function reads(token: Address, amount: bigint, over: Partial<Phase5Reads> = {}, rid = 'req-1'): Reads {
  const requestId = keccak256(toBytes(rid))
  const deadline = T0 + 3600n
  const th = txHash({
    chainId: 84532,
    vault: HOT,
    requestId,
    userIdHash: UID,
    token,
    to: TO,
    amount,
    nonce: 1n,
    deadline,
  })
  const i = token === QUSD ? 0 : 1
  const p = p5(over)
  return {
    chainId: 84532n,
    blockTime: T0,
    request: {
      requestId,
      orgId: ORG,
      userIdHash: UID,
      kind: 0,
      vault: HOT,
      token,
      to: TO,
      amount,
      nonce: 1n,
      deadline,
      txHash: th,
    },
    intent: { orgId: ORG, userIdHash: UID, vault: HOT, token, to: TO, amount, nonce: 1n, deadline },
    signer: KEY,
    orgVaults: [HOT],
    allowedTokens: [QUSD, QETH],
    key: KEY,
    deposited: p.depositedAll[i]!,
    approved: p.approvedAll[i]!,
    toIsSuspect: false,
    fingerprintActive: false,
    activeConfirmedCount: 0n,
    k: K,
    decoyTags: new Set(),
    p5: p,
  }
}

describe('SPRT score (D22, D23)', () => {
  // lambda 7,560 from real data (STATUS); one signal alone is capped just under L3, so it lands on L2 (D05)
  test('threshold hug alone: 7560 capped to 6801 -> L2, delayed D2 (D05)', () => {
    const j = judge(reads(QETH, (5n * E18 * 95n) / 100n))
    expect(j.score!.next.lambda).toBe(6801n)
    expect(j.score!.level).toBe(2)
    expect(j.decision).toBe(Decision.APPROVE)
    expect(j.notBefore).toBe(T0 + 3600n)
    expect(j.codes).toContain(Reason.R7_THRESHOLD_HUG)
  })

  test('new account + new address are capped together at 1500 -> L0', () => {
    const lam = lambdas(DEFAULT_SPRT, {
      newAccount: true,
      newRecipient: true,
      thresholdHug: false,
      fingerprint: false,
      recentPending: false,
    })
    expect(Object.values(lam).reduce((a, b) => a + b, 0n)).toBe(1500n)
    expect(levelOf(DEFAULT_SPRT, 1500n)).toBe(0)
  })

  test('decay after 24 h follows gamma = 0.9 per hour; fixed point within 1 milli-nat of float (D50)', () => {
    for (const lam of [1000n, 4605n, 6802n, 12000n]) {
      for (const h of [0, 1, 5, 24, 72]) {
        const got = decay(DEFAULT_SPRT, { lambda: lam, tLast: T0, pendingCount: 0 }, T0 + BigInt(h) * 3600n)
        const ref = Number(lam) * 0.9 ** h
        expect(Math.abs(Number(got) - ref)).toBeLessThanOrEqual(1)
      }
    }
    expect(decay(DEFAULT_SPRT, { lambda: 4605n, tLast: T0, pendingCount: 0 }, T0 + 73n * 3600n)).toBe(0n)
  })

  test('same event twice: identical ciphertext; another requestId: different ciphertext', () => {
    const s = { lambda: 1234n, tLast: T0, pendingCount: 1 }
    const rid = keccak256(toBytes('r'))
    expect(encryptScore(K, rid, s)).toBe(encryptScore(K, rid, s))
    expect(encryptScore(K, keccak256(toBytes('r2')), s)).not.toBe(encryptScore(K, rid, s))
  })

  test('decrypting before and after: L2 = decay(L1) + lambda (D23)', () => {
    const prev = { lambda: 3000n, tLast: T0 - 2n * 3600n, pendingCount: 0 }
    const ct = encryptScore(K, keccak256(toBytes('old')), prev)
    const r = reads(QUSD, 100_000_000n, { prevScore: decryptScore(K, ct), seenRecipient: false })
    const j = judge(r)
    const out = buildCosign({
      reads: r,
      judgement: j,
      eventTxHash: keccak256(toBytes('tx')),
      eventLogIndex: 0n,
      hotVault: HOT,
      warmVault: HOT,
      tokens: [QUSD],
      tokenDecimals: 6,
      officerSealKeys: [],
      verdictTtl: 900n,
      freezeDuration: 7200n,
      alertTtl: 7200n,
      coldDelay: 259200n,
      threatTtl: 259200n,
      prevScoreCipher: ct,
    })
    expect(out.actions.map((a) => a.kind)).toEqual([Kind.SCORE, Kind.VERDICT])
    const [key, , prevHash, newCt] = decodeAction(out.actions[0]!) as [Hex, Hex, Hex, Hex]
    expect(key).toBe(scoreKey(K, UID))
    expect(prevHash).toBe(keccak256(ct))
    const after = decryptScore(K, newCt)
    expect(after.lambda).toBe(decay(DEFAULT_SPRT, prev, T0) + 900n)
  })

  test('REJECT (gates 1 to 3) writes no score: forged requests cannot push a user up (D23)', () => {
    const r = reads(QUSD, 1n)
    r.signer = TO
    const j = judge(r)
    expect(j.decision).toBe(Decision.REJECT)
    expect(j.score).toBeUndefined()
  })
})

describe('gates 5 to 7', () => {
  test('hidden threshold: deterministic per epoch and token, inside the range, changes across epochs', () => {
    const r = { tMin: E18, tMax: 3n * E18 }
    const a = thresholdOf(K, 10n, QETH, r)
    expect(thresholdOf(K, 10n, QETH, r)).toBe(a)
    expect(a >= E18 && a < 3n * E18).toBe(true)
    const others = [11n, 12n, 13n].map((e) => thresholdOf(K, e, QETH, r))
    expect(others.some((x) => x !== a)).toBe(true)
    expect(thresholdCommitment(a, thresholdNonce(K, 10n, QETH))).toMatch(/^0x[0-9a-f]{64}$/)
  })

  // docs/47: hidden cap and score delay with an expiry instead of waiting for a person
  test('L0: amount over T_e -> APPROVE delayed D2 (code 71); under -> APPROVE now', () => {
    const te = thresholdOf(K, epochOf(T0, 3600n), QETH, { tMin: E18, tMax: 3n * E18 })
    const over = judge(reads(QETH, te + 1n))
    expect(over.decision).toBe(Decision.APPROVE)
    expect(over.notBefore).toBe(T0 + 3600n)
    expect(over.codes).toContain(Reason.R7_HIDDEN_CAP)
    const ok = judge(reads(QETH, te))
    expect(ok.decision).toBe(Decision.APPROVE)
    expect(ok.notBefore).toBe(0n)
  })

  test('L1: cap halves and APPROVE carries notBefore = block time + L1_DELAY (D42)', () => {
    const prev = { lambda: 2500n, tLast: T0, pendingCount: 0 }
    const te = thresholdOf(K, epochOf(T0, 3600n), QETH, { tMin: E18, tMax: 3n * E18 })
    const ok = judge(reads(QETH, te / 2n, { prevScore: prev }))
    expect(ok.decision).toBe(Decision.APPROVE)
    expect(ok.notBefore).toBe(T0 + 600n)
    const over = judge(reads(QETH, te / 2n + 1n, { prevScore: prev }))
    expect(over.decision).toBe(Decision.APPROVE)
    expect(over.notBefore).toBe(T0 + 3600n)
  })

  test('L2: new recipient -> delayed D2 even for a small amount; L3: everything delayed D3', () => {
    const l2 = judge(
      reads(QUSD, 1_000_000n, { prevScore: { lambda: 5000n, tLast: T0, pendingCount: 0 }, seenRecipient: false }),
    )
    expect(l2.decision).toBe(Decision.APPROVE)
    expect(l2.notBefore).toBe(T0 + 3600n)
    const l3 = judge(reads(QUSD, 1_000_000n, { prevScore: { lambda: 7000n, tLast: T0, pendingCount: 0 } }))
    expect(l3.decision).toBe(Decision.APPROVE)
    expect(l3.notBefore).toBe(T0 + 86400n)
  })

  test('R2 large to a new address: enforce delays, shadow only records, known address is untouched (docs/47)', () => {
    const rule = (mode: 'enforce' | 'shadow') => ({
      mode,
      delay: 3600n,
      minAmount: { [QUSD.toLowerCase()]: 100_000_000n },
    })
    const big = 200_000_000n // over L_pub, under the hidden cap range
    const enforced = judge(reads(QUSD, big, { seenRecipient: false, largeNew: rule('enforce') }))
    expect(enforced.decision).toBe(Decision.APPROVE)
    expect(enforced.notBefore).toBe(T0 + 3600n)
    expect(enforced.codes).toContain(Reason.R7_LARGE_NEW)
    const shadow = judge(reads(QUSD, big, { seenRecipient: false, largeNew: rule('shadow') }))
    expect(shadow.shadow).toEqual(['largeNew'])
    expect(judge(reads(QUSD, big, { seenRecipient: true, largeNew: rule('enforce') })).codes).not.toContain(
      Reason.R7_LARGE_NEW,
    )
  })

  test('shared list, deposit and price problems stay PENDING (not auto-paid)', () => {
    expect(judge({ ...reads(QUSD, 1_000_000n), toIsSuspect: true }).decision).toBe(Decision.PENDING)
    expect(judge(reads(QETH, E18, { approvedAll: [10_000_000_000n, 9n * E18 + E18 / 2n] })).decision).toBe(
      Decision.PENDING,
    )
    expect(judge(reads(QETH, E18 / 10n, { priceUpdatedAt: T0 - 3601n })).decision).toBe(Decision.PENDING)
  })

  test('a delayed APPROVE stays valid for VERDICT_TTL after notBefore', () => {
    const te = thresholdOf(K, epochOf(T0, 3600n), QETH, { tMin: E18, tMax: 3n * E18 })
    const r = reads(QETH, te + 1n)
    const out = buildCosign({
      reads: r,
      judgement: judge(r),
      eventTxHash: keccak256(toBytes('tx')),
      eventLogIndex: 0n,
      hotVault: HOT,
      warmVault: HOT,
      tokens: [QUSD],
      tokenDecimals: 6,
      officerSealKeys: ['0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'] as Hex[],
      verdictTtl: 900n,
      freezeDuration: 7200n,
      alertTtl: 7200n,
      coldDelay: 259200n,
      threatTtl: 259200n,
    })
    const v = decodeAction(out.actions[out.actions.length - 1]!)
    expect(v[7]).toBe(T0 + 3600n)
    expect(v[8]).toBe(T0 + 3600n + 900n)
  })

  test('network follow level lifts L0 to L1 (cap halves) but never higher (D13)', () => {
    const r = reads(QUSD, 1_000_000n)
    r.activeConfirmedCount = 2n
    const j = judge(r)
    expect(j.score!.effectiveLevel).toBe(1)
    expect(j.notBefore).toBe(T0 + 600n)
  })

  test('gate 6: stale price -> PENDING 62; second source mismatch -> PENDING 61 (D48)', () => {
    expect(judge(reads(QETH, E18 / 10n, { priceUpdatedAt: T0 - 3601n })).codes).toContain(Reason.R6_PRICE_STALE)
    expect(judge(reads(QUSD, 1_000_000n, { depositedSecondSource: 1n })).codes).toContain(Reason.R6_SOURCE_MISMATCH)
  })

  test('gate 5 in USD across tokens', () => {
    // 10,000 qUSD + 10 qETH (30,000 USD) deposited; 40,000 USD deposited, 38,500 approved; 1 qETH (3,000) more is over
    const r = reads(QETH, E18, { approvedAll: [10_000_000_000n, 9n * E18 + E18 / 2n] })
    expect(judge(r).codes).toContain(Reason.R5_OVER_DEPOSIT)
  })

  test('PENDING 42 / 51 / 62 are indistinguishable on chain (D15)', () => {
    const variants: Reads[] = [
      { ...reads(QUSD, 1_000_000n), toIsSuspect: true },
      reads(QETH, E18, { approvedAll: [10_000_000_000n, 9n * E18 + E18 / 2n] }),
      reads(QETH, E18 / 10n, { priceUpdatedAt: T0 - 3601n }),
    ]
    const shapes = variants.map((r) => {
      const out = buildCosign({
        reads: r,
        judgement: judge(r),
        eventTxHash: keccak256(toBytes('tx')),
        eventLogIndex: 0n,
        hotVault: HOT,
        warmVault: HOT,
        tokens: [QUSD],
        tokenDecimals: 6,
        officerSealKeys: ['0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'] as Hex[],
        verdictTtl: 900n,
        freezeDuration: 7200n,
        alertTtl: 7200n,
        coldDelay: 259200n,
        threatTtl: 259200n,
      })
      const v = decodeAction(out.actions[out.actions.length - 1]!)
      return {
        kinds: out.actions.map((a) => a.kind),
        d: v[5],
        pr: v[6],
        nb: v[7],
        ex: v[8],
        len: (v[9] as string).length,
      }
    })
    expect(
      new Set(
        shapes.map((s) =>
          JSON.stringify({ ...s, kinds: undefined }, (_, x) => (typeof x === 'bigint' ? x.toString() : x)),
        ),
      ).size,
    ).toBe(1)
    for (const s of shapes) expect(s.kinds).toEqual([Kind.SCORE, Kind.VERDICT])
  })
})

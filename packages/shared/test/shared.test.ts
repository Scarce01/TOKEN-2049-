import { describe, expect, test } from 'bun:test'
import { type Hex, hexToBytes, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  act,
  amountBucket,
  cancelDigest,
  confirmedPack,
  decodeAction,
  decodeReason,
  decodeReport,
  decoyTag,
  displayCase,
  ENVELOPE_LEN,
  encodeReason,
  encodeReport,
  encodeWorkflowName,
  intentDigest,
  Kind,
  officerDigest,
  packTags,
  ringAt,
  ringCovers,
  seal,
  sealPublicKey,
  sortSigs,
  txHash,
  unpackTags,
  unseal,
} from '../src/index'
import { VECTORS } from './vectors'

describe('shared vectors (same as forge)', () => {
  test('intent EIP-712 digest equals forge test_intentDigestVector', () => {
    const d = intentDigest(84532, '0x00000000000000000000000000000000000B0a2d', {
      orgId: keccak256(toBytes('exchange-a')),
      userIdHash: keccak256(toBytes('user')),
      vault: '0x000000000000000000000000000000000000dEaD',
      token: '0x000000000000000000000000000000000000bEEF',
      to: '0x000000000000000000000000000000000000cafE',
      amount: 1_000_000n,
      nonce: 7n,
      deadline: 1_900_000_000n,
    })
    expect(d).toBe(VECTORS.intentDigest)
  })

  test('txHash vector equals forge test_txHashVector', () => {
    expect(
      txHash({
        chainId: 84532,
        vault: '0x000000000000000000000000000000000000dEaD',
        requestId: keccak256(toBytes('req')),
        userIdHash: keccak256(toBytes('user')),
        token: '0x000000000000000000000000000000000000bEEF',
        to: '0x000000000000000000000000000000000000cafE',
        amount: 1_000_000n,
        nonce: 7n,
        deadline: 1_900_000_000n,
      }),
    ).toBe(VECTORS.txHash)
  })

  test('workflow name encoding equals forge encodeWorkflowName', () => {
    expect(encodeWorkflowName('quorum-trap')).toBe(VECTORS.wfNameTrap)
  })

  test('officer digest equals forge', () => {
    expect(
      officerDigest(84532, '0x000000000000000000000000000000000000dEaD', {
        kind: 1,
        subject: keccak256(toBytes('s')),
        value: 5n,
        nonce: 1n,
        deadline: 1_900_000_000n,
      }),
    ).toBe(VECTORS.officerDigest)
  })

  test('cancel digest equals forge (docs/47 3.3)', () => {
    expect(
      cancelDigest(84532, '0x000000000000000000000000000000000000dEaD', keccak256(toBytes('tx')), 1_900_000_000n),
    ).toBe(VECTORS.cancelDigest)
  })
})

describe('ids', () => {
  test('txHash changes with requestId and userIdHash', () => {
    const base = {
      chainId: 84532,
      vault: '0x000000000000000000000000000000000000dEaD' as const,
      requestId: keccak256(toBytes('a')),
      userIdHash: keccak256(toBytes('u')),
      token: '0x000000000000000000000000000000000000bEEF' as const,
      to: '0x000000000000000000000000000000000000cafE' as const,
      amount: 1n,
      nonce: 1n,
      deadline: 1n,
    }
    const h = txHash(base)
    expect(txHash({ ...base, requestId: keccak256(toBytes('b')) })).not.toBe(h)
    expect(txHash({ ...base, userIdHash: keccak256(toBytes('v')) })).not.toBe(h)
  })

  test('display case format', () => {
    expect(displayCase('0xabcdef0123456789000000000000000000000000000000000000000000000000')).toBe('Q-ABCD-EF01')
  })

  test('amount bucket', () => {
    expect(amountBucket(840_000n, 6)).toBe(6) // 0.84 qUSD -> 84 units of 0.01 -> log2 = 6
    expect(amountBucket(1n, 6)).toBe(0)
    expect(amountBucket(4_750_000_000_000_000_000n, 18)).toBe(8) // 4.75 qETH -> 475 -> 8
    expect(amountBucket(10n ** 40n, 18)).toBe(40)
  })

  test('decoy tags pack and unpack', () => {
    const k = hexToBytes(keccak256(toBytes('K')))
    const t1 = decoyTag(k, 'acct', keccak256(toBytes('decoy-user')))
    const t2 = decoyTag(k, 'addr', '0x000000000000000000000000000000000000cafE')
    expect(t1.length).toBe(18)
    const set = unpackTags(packTags([t1, t2]))
    expect(set.has(t1)).toBe(true)
    expect(set.has(t2)).toBe(true)
    expect(decoyTag(k, 'acct', keccak256(toBytes('decoy-user')))).toBe(t1)
  })
})

describe('report codec', () => {
  test('roundtrip every kind', () => {
    const a = '0x000000000000000000000000000000000000dEaD' as const
    const h = keccak256(toBytes('x'))
    const actions = [
      act.ping(h),
      act.verdict({
        requestId: h,
        txHash: h,
        userIdHash: h,
        token: a,
        amount: 5n,
        decision: 1,
        publicReason: 0,
        notBefore: 0n,
        expiresAt: 9n,
        sealedReason: '0x1234',
      }),
      act.alert(4, 100n),
      act.freeze(a, 100n),
      act.sweep(a, [a]),
      act.quotaZero(a, [a]),
      act.coldDelay(3n),
      act.threat({
        suspect: a,
        chainId: 1n,
        evidenceHash: h,
        fingerprintHash: h,
        expiresAt: 5n,
        parentEvidence: h,
        proof: '0x',
      }),
      act.quotaRefill(a, a, 1n, 2n),
      act.score(h, h, h, '0xab'),
      act.topUp(a, a, a, 1n),
      act.thresholdCommit(1n, a, h),
      act.thresholdReveal(1n, a, 2n, h),
      act.patrolState(a, a, 1n, 2n, true, false),
      act.assetCheckpoint(h, a, 3n, -4n),
    ]
    const enc = encodeReport({ chainId: 84532n, orgId: h, caseId: h, issuedAt: 1n, actions })
    const dec = decodeReport(enc)
    expect(dec.version).toBe(1)
    expect(dec.actions.map((x) => x.kind)).toEqual(Array.from({ length: 15 }, (_, i) => i))
    expect(decodeAction(dec.actions[14]!)[3]).toBe(-4n)
  })

  test('confirmed pack order', () => {
    const a = '0x000000000000000000000000000000000000dEaD' as const
    const h = keccak256(toBytes('x'))
    const p = confirmedPack({
      warmVault: a,
      hotVault: a,
      tokens: [a],
      blockTime: 1000n,
      freezeDuration: 7200n,
      alertTtl: 7200n,
      coldDelay: 259200n,
      threat: {
        suspect: a,
        chainId: 1n,
        evidenceHash: h,
        fingerprintHash: h,
        expiresAt: 5n,
        parentEvidence: h,
        proof: '0x',
      },
    })
    expect(p.map((x) => x.kind)).toEqual([
      Kind.FREEZE,
      Kind.QUOTA_ZERO,
      Kind.SWEEP,
      Kind.ALERT,
      Kind.COLD_DELAY,
      Kind.THREAT,
    ])
  })
})

describe('seal', () => {
  const k = hexToBytes(keccak256(toBytes('quorum-k')))
  const officerPrivs: Hex[] = [keccak256(toBytes('o1')), keccak256(toBytes('o2')), keccak256(toBytes('o3'))]
  const pubs = officerPrivs.map(sealPublicKey)
  const rid = keccak256(toBytes('req-1'))

  test('deterministic: same input twice gives identical bytes', () => {
    const p = encodeReason({ codes: [41] })
    expect(seal(k, rid, pubs, p)).toBe(seal(k, rid, pubs, p))
  })

  test('each officer can unseal; fixed length', () => {
    const payload = encodeReason({ codes: [51], lambda: { newAddr: 900, newAcct: 1200 } })
    const s = seal(k, rid, pubs, payload)
    expect((s.length - 2) / 2).toBe(ENVELOPE_LEN * 3)
    for (let i = 0; i < 3; i++) expect(decodeReason(unseal(s, i, officerPrivs[i]!)).codes).toEqual([51])
    const s2 = seal(k, rid, pubs, encodeReason({ codes: [42] }))
    expect(s2.length).toBe(s.length)
  })

  test('different requestId gives different ciphertext', () => {
    const p = encodeReason({ codes: [41] })
    expect(seal(k, rid, pubs, p)).not.toBe(seal(k, keccak256(toBytes('req-2')), pubs, p))
  })
})

describe('misc', () => {
  test('sortSigs ascending by signer', () => {
    const a = privateKeyToAccount(keccak256(toBytes('a')))
    const b = privateKeyToAccount(keccak256(toBytes('b')))
    const out = sortSigs([
      { signer: a.address, sig: '0xaa' },
      { signer: b.address, sig: '0xbb' },
    ])
    expect(out[0]).toBe(BigInt(a.address) < BigInt(b.address) ? '0xaa' : '0xbb')
  })

  test('ring helpers', () => {
    const w = (m: bigint, v: bigint) => (m << 224n) | v
    const ring = Array(32).fill(0n) as bigint[]
    ring[Number(100n % 32n)] = w(100n, 7n)
    expect(ringAt(ring, 100n)).toBe(7n)
    expect(ringAt(ring, 68n)).toBe(0n)
    expect(ringCovers(ring, 68n)).toBe(false)
    expect(ringCovers(ring, 101n)).toBe(true)
  })
})

describe('merkle (D12 phase 5)', () => {
  test('tree proofs verify, a flipped byte fails, leaf matches DecoyCommit.leafOf vector', async () => {
    const { buildTree, verifyProof, decoyLeaf, decoySalt } = await import('../src/index')
    const k = hexToBytes(keccak256(toBytes('K')))
    const leaf0 = decoyLeaf(84532, `0x${'00'.repeat(12)}${'ab'.repeat(20)}`, decoySalt(k, 0))
    const leaves = [
      leaf0,
      keccak256(toBytes('f1')),
      keccak256(toBytes('f2')),
      keccak256(toBytes('f3')),
    ] as `0x${string}`[]
    const t = buildTree(leaves)
    for (let i = 0; i < 4; i++) expect(verifyProof(leaves[i]!, t.proofs[i]!, t.root)).toBe(true)
    expect(verifyProof(keccak256(toBytes('x')), t.proofs[0]!, t.root)).toBe(false)
    expect(decoyLeaf(84532, keccak256(toBytes('ident')), keccak256(toBytes('salt')))).toBe(VECTORS.decoyLeaf)
  })
})

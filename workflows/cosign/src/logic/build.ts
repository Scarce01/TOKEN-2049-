// Pure: judgement -> report actions. VERDICT always; confirmed pack first when a decoy was touched.
import { type Address, type Hex, keccak256 } from 'viem'
import {
  type Action,
  act,
  amountBucket,
  caseIdWithdrawal,
  confirmedPack,
  Decision,
  encodeReason,
  evidenceHash,
  FpAction,
  fingerprintHash,
  seal,
} from '../../../../packages/shared/src/index'
import type { Judgement, Reads } from './gates'
import { encryptScore, scoreKey } from './sprt'

export type BuildInput = {
  reads: Reads
  judgement: Judgement
  eventTxHash: Hex
  eventLogIndex: bigint
  hotVault: Address
  warmVault: Address
  tokens: Address[]
  tokenDecimals: number
  officerSealKeys: Hex[]
  verdictTtl: bigint
  freezeDuration: bigint
  alertTtl: bigint
  coldDelay: bigint
  threatTtl: bigint
  /** Phase 5: stored score ciphertext read at the event block ('0x' when none). */
  prevScoreCipher?: Hex
  /** Phase 5: Merkle proof for a decoy account, abi.encode(ident, salt, path); '0x' before phase 5. */
  decoyProof?: Hex
}

export function requestFingerprint(chainId: bigint, token: Address, amount: bigint, decimals: number): Hex {
  const bucket = amountBucket(amount, decimals)
  // Small probing amounts (bucket <= 7, i.e. under ~1.28 tokens) share the PROBE type with Trap.
  return bucket <= 7 ? fingerprintHash(chainId, token, bucket, FpAction.PROBE) : `0x${'0'.repeat(64)}`
}

export function buildCosign(b: BuildInput): { caseId: Hex; actions: Action[] } {
  const r = b.reads
  const q = r.request
  const j = b.judgement
  const caseId = caseIdWithdrawal(q.orgId, q.requestId)
  const actions: Action[] = []

  if (j.confirmed) {
    actions.push(
      ...confirmedPack({
        warmVault: b.warmVault,
        hotVault: b.hotVault,
        tokens: b.tokens,
        blockTime: r.blockTime,
        freezeDuration: b.freezeDuration,
        alertTtl: b.alertTtl,
        coldDelay: b.coldDelay,
        threat: {
          suspect: j.confirmed.suspect,
          chainId: r.chainId,
          evidenceHash: evidenceHash(r.chainId, b.eventTxHash, b.eventLogIndex),
          fingerprintHash: requestFingerprint(r.chainId, q.token, q.amount, b.tokenDecimals),
          expiresAt: r.blockTime + b.threatTtl,
          parentEvidence: `0x${'0'.repeat(64)}`,
          proof: b.decoyProof ?? '0x',
        },
      }),
    )
  }

  // Phase 5: SCORE goes before VERDICT (the Receiver skips the verdict on a score conflict).
  if (j.score) {
    const key = scoreKey(r.k, q.userIdHash)
    const prev = b.prevScoreCipher ?? '0x'
    actions.push(
      act.score(
        key,
        q.requestId,
        prev === '0x' ? `0x${'0'.repeat(64)}` : keccak256(prev),
        encryptScore(r.k, q.requestId, j.score.next),
      ),
    )
  }
  const lambda = j.score
    ? Object.fromEntries(Object.entries(j.score.lambdas).map(([k, v]) => [k, Number(v)]))
    : undefined
  const sealedReason = seal(
    r.k,
    q.requestId,
    b.officerSealKeys,
    encodeReason({
      codes: j.codes,
      level: j.score?.effectiveLevel ?? j.networkLevel,
      lambda,
      score: j.score ? j.score.next.lambda.toString() : undefined,
    }),
  )
  actions.push(
    act.verdict({
      requestId: q.requestId,
      txHash: q.txHash,
      userIdHash: q.userIdHash,
      token: q.token,
      amount: q.amount,
      decision: j.decision,
      publicReason: j.decision === Decision.REJECT ? j.publicReason : 0,
      notBefore: j.decision === Decision.APPROVE ? (j.notBefore ?? 0n) : 0n,
      // a delayed APPROVE stays valid for VERDICT_TTL after it can first be executed
      expiresAt: j.decision === Decision.APPROVE ? (j.notBefore || r.blockTime) + b.verdictTtl : 0n,
      sealedReason,
    }),
  )
  return { caseId, actions }
}

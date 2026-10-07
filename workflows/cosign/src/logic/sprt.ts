// SPRT account score, hidden threshold, decay (10_interfaces.md 8.3, 8.4; proposal 6 D, E).
// Pure bigint math; every "random" value is HMAC(K, ...); time is the event block time.
import { gcm } from '@noble/ciphers/aes.js'
import {
  bytesToHex,
  concat,
  decodeAbiParameters,
  encodeAbiParameters,
  type Hex,
  hexToBytes,
  keccak256,
  parseAbiParameters,
} from 'viem'
import { hmacK } from '../../../../packages/shared/src/index'

/** milli-nat lambdas and thresholds; all ASSUMED (proposal 6 E), tuned later from H0 data. */
export type SprtParams = {
  lambda: { newAccount: bigint; newRecipient: bigint; thresholdHug: bigint; fingerprint: bigint; recentPending: bigint }
  sameClassCap: bigint // newAccount + newRecipient together
  /** One signal on its own never reaches L3; L3 needs a second, independent signal (docs/46 8.3). */
  singleSignalCap: bigint
  levels: [bigint, bigint, bigint] // L1, L2, L3
  newAccountSeconds: bigint
  decayPpm: bigint[] // gamma^h * 1e6 for h = 0..72 hours
}

export const DEFAULT_SPRT: SprtParams = {
  // thresholdHug 7,560: real users hug the fake threshold 0.004% to 0.03% of the time (STATUS, H0 data)
  lambda: { newAccount: 1200n, newRecipient: 900n, thresholdHug: 7560n, fingerprint: 2303n, recentPending: 500n },
  sameClassCap: 1500n,
  singleSignalCap: 6801n, // levels[2] - 1
  levels: [2303n, 4605n, 6802n],
  newAccountSeconds: 7n * 86400n,
  decayPpm: decayTable(900_000n, 72),
}

/** gamma^h in ppm, integer only: t[h] = t[h-1] * gamma / 1e6. */
export function decayTable(gammaPpm: bigint, hours: number): bigint[] {
  const t = [1_000_000n]
  for (let h = 1; h <= hours; h++) t.push((t[h - 1]! * gammaPpm) / 1_000_000n)
  return t
}

export type ScoreState = { lambda: bigint; tLast: bigint; pendingCount: number }
export const EMPTY_SCORE: ScoreState = { lambda: 0n, tLast: 0n, pendingCount: 0 }

const SCORE_ABI = parseAbiParameters('uint256, uint64, uint32')

export function scoreKey(k: Uint8Array, userIdHash: Hex): Hex {
  return bytesToHex(hmacK(k, 'score', hexToBytes(userIdHash)))
}

/** ciphertext = nonce(12) || AES-GCM(ct + tag). nonce = HMAC(K, "scorenonce" || requestId || keccak(plain))[0:12]. */
export function encryptScore(k: Uint8Array, requestId: Hex, s: ScoreState): Hex {
  const plain = hexToBytes(encodeAbiParameters(SCORE_ABI, [s.lambda, s.tLast, s.pendingCount]))
  const key = hmacK(k, 'scorekey')
  const nonce = hmacK(k, 'scorenonce', hexToBytes(requestId), hexToBytes(keccak256(plain))).slice(0, 12)
  return bytesToHex(concat([nonce, gcm(key, nonce).encrypt(plain)]))
}

export function decryptScore(k: Uint8Array, ct: Hex): ScoreState {
  if (ct === '0x' || ct.length < 2 + 2 * 28) return EMPTY_SCORE
  const b = hexToBytes(ct)
  const plain = gcm(hmacK(k, 'scorekey'), b.slice(0, 12)).decrypt(b.slice(12))
  const [lambda, tLast, pendingCount] = decodeAbiParameters(SCORE_ABI, bytesToHex(plain))
  return { lambda, tLast, pendingCount }
}

export function decay(p: SprtParams, s: ScoreState, now: bigint): bigint {
  if (s.lambda === 0n || now <= s.tLast) return s.lambda
  const h = Number((now - s.tLast) / 3600n)
  if (h >= p.decayPpm.length) return 0n
  return (s.lambda * p.decayPpm[h]!) / 1_000_000n
}

export type Signals = {
  newAccount: boolean
  newRecipient: boolean
  thresholdHug: boolean
  fingerprint: boolean
  recentPending: boolean
}

/** Per-signal lambda after the same-class cap; the breakdown goes into sealedReason (D53). */
export function lambdas(p: SprtParams, s: Signals): Record<string, bigint> {
  const out: Record<string, bigint> = {}
  let na = s.newAccount ? p.lambda.newAccount : 0n
  let nr = s.newRecipient ? p.lambda.newRecipient : 0n
  if (na + nr > p.sameClassCap) {
    // scale both down proportionally to the cap (integer, rounding down)
    const total = na + nr
    na = (na * p.sameClassCap) / total
    nr = p.sameClassCap - na
  }
  if (na) out.newAccount = na
  if (nr) out.newRecipient = nr
  const cap = (x: bigint) => (x > p.singleSignalCap ? p.singleSignalCap : x)
  if (s.thresholdHug) out.thresholdHug = cap(p.lambda.thresholdHug)
  if (s.fingerprint) out.fingerprint = cap(p.lambda.fingerprint)
  if (s.recentPending) out.recentPending = cap(p.lambda.recentPending)
  return out
}

export function levelOf(p: SprtParams, lambda: bigint): number {
  if (lambda >= p.levels[2]) return 3
  if (lambda >= p.levels[1]) return 2
  if (lambda >= p.levels[0]) return 1
  return 0
}

export {
  epochOf,
  type ThresholdRange,
  thresholdCommitment,
  thresholdNonce,
  thresholdOf,
} from '../../../common/threshold'

/** Amount within [0.9 F, F) of the fake threshold F the backend advertises. */
export function hugsFakeThreshold(amount: bigint, fake: bigint): boolean {
  return fake > 0n && amount < fake && amount * 10n >= fake * 9n
}

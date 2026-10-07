// Pure Cosign judgement (33_phase3.md 3.4). Input is a `Reads` object; no CRE calls here.
import type { Address, Hex } from 'viem'
import { txHash as computeTxHash, Decision, decoyTag, Reason } from '../../../../packages/shared/src/index'
import {
  decay,
  epochOf,
  hugsFakeThreshold,
  lambdas,
  levelOf,
  type ScoreState,
  type SprtParams,
  type ThresholdRange,
  thresholdOf,
} from './sprt'

export type Request = {
  requestId: Hex
  orgId: Hex
  userIdHash: Hex
  kind: number
  vault: Address
  token: Address
  to: Address
  amount: bigint
  nonce: bigint
  deadline: bigint
  txHash: Hex
}

export type Intent = {
  orgId: Hex
  userIdHash: Hex
  vault: Address
  token: Address
  to: Address
  amount: bigint
  nonce: bigint
  deadline: bigint
}

export type Reads = {
  chainId: bigint
  blockTime: bigint
  request: Request
  intent: Intent
  signer: Address
  // config
  orgVaults: Address[]
  allowedTokens: Address[]
  // chain facts (QuorumLens.cosignView at the event block)
  key: Address
  deposited: bigint // for request.token
  approved: bigint // for request.token
  toIsSuspect: boolean
  fingerprintActive: boolean
  activeConfirmedCount: bigint
  // secrets
  k: Uint8Array
  decoyTags: Set<string>
  /** Phase 5 inputs (gates 5 in USD, 6, 7 and the SPRT score). Absent: phase 3 behavior. */
  p5?: Phase5Reads
}

export type Phase5Reads = {
  sprt: SprtParams
  prevScore: ScoreState
  seenRecipient: boolean
  firstDepositAt: bigint
  // gate 5 in USD: every token's deposited / approved; qUSD = 1, qETH via the price feed
  tokens: Address[]
  decimals: number[]
  depositedAll: bigint[]
  approvedAll: bigint[]
  usdToken: Address
  price: bigint // ETH/USD, priceDecimals
  priceDecimals: number
  priceUpdatedAt: bigint
  maxPriceAge: bigint
  /** Second data source for depositedOf at the same block (gate 6); undefined when not available. */
  depositedSecondSource?: bigint
  // gate 7
  thresholds: Record<string, ThresholdRange> // token (lowercase) => range
  epochLen: bigint
  fakeThreshold: Record<string, bigint> // token (lowercase) => advertised fake threshold
  l1Delay: bigint
  /** docs/47 delay tiers: hidden cap and score delay instead of waiting for a person. */
  d2Delay: bigint
  d3Delay: bigint
  /** docs/47 R2: amount over minAmount[token] to a new recipient. shadow = log only. */
  largeNew?: { mode: 'enforce' | 'shadow'; delay: bigint; minAmount: Record<string, bigint> }
}

export type Judgement = {
  decision: number
  publicReason: number
  codes: number[]
  /** Set when a decoy was touched: attach the confirmed pack. */
  confirmed?: { suspect: Address }
  /** Network follow level contribution (max 1); recorded only until phase 5. */
  networkLevel: number
  /** Phase 5: delayed release (0 = immediate). Reasons share tiers, so the delay does not say why. */
  notBefore?: bigint
  /** Rules in shadow mode that would have delayed this request (logged, never in the report). */
  shadow?: string[]
  /** Phase 5: the score to write (only for requests that passed gates 1 to 3). */
  score?: { next: ScoreState; lambdas: Record<string, bigint>; level: number; effectiveLevel: number }
}

const ZERO = '0x0000000000000000000000000000000000000000' as Address
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function judge(r: Reads): Judgement {
  const q = r.request
  const networkLevel = r.activeConfirmedCount > 0n ? 1 : 0
  const pending = (codes: number[], confirmed?: { suspect: Address }): Judgement => ({
    decision: Decision.PENDING,
    publicReason: 0,
    codes,
    confirmed,
    networkLevel,
  })
  const reject = (code: number): Judgement => ({
    decision: Decision.REJECT,
    publicReason: code,
    codes: [code],
    networkLevel,
  })

  // Decoys first: a forged request against a decoy account has no valid key, so gate 3 would
  // reject it and the trap would never fire (3.4 step 4).
  if (r.decoyTags.has(decoyTag(r.k, 'acct', q.userIdHash))) {
    return pending([Reason.R4_DECOY_ACCOUNT], { suspect: q.to })
  }
  if (r.decoyTags.has(decoyTag(r.k, 'addr', q.to))) {
    return pending([Reason.R4_DECOY_ADDRESS], { suspect: ZERO })
  }

  // Gate 1: txHash must be what the vault will recompute.
  const expected = computeTxHash({
    chainId: r.chainId,
    vault: q.vault,
    requestId: q.requestId,
    userIdHash: q.userIdHash,
    token: q.token,
    to: q.to,
    amount: q.amount,
    nonce: q.nonce,
    deadline: q.deadline,
  })
  if (!eq(expected, q.txHash)) return reject(Reason.R1_TXHASH)

  // Gate 2: only plain vault transfers of listed tokens from this org's vaults.
  if (q.kind !== 0) return reject(Reason.R2_SAFE_TX)
  if (!r.orgVaults.some((v) => eq(v, q.vault))) return reject(Reason.R2_VAULT)
  if (!r.allowedTokens.some((t) => eq(t, q.token))) return reject(Reason.R2_TOKEN)

  // Gate 3: registered key signed exactly these fields, not expired.
  if (eq(r.key, ZERO) || !eq(r.key, r.signer)) return reject(Reason.R3_SIGNER)
  const i = r.intent
  const same =
    eq(i.orgId, q.orgId) &&
    eq(i.userIdHash, q.userIdHash) &&
    eq(i.vault, q.vault) &&
    eq(i.token, q.token) &&
    eq(i.to, q.to) &&
    i.amount === q.amount &&
    i.nonce === q.nonce &&
    i.deadline === q.deadline
  if (!same) return reject(Reason.R3_FIELDS)
  if (q.deadline < r.blockTime) return reject(Reason.R3_EXPIRED)

  const codes: number[] = []
  if (r.fingerprintActive) codes.push(Reason.R4_FINGERPRINT) // recorded only, no decision change
  if (r.p5) return judgePhase5(r, r.p5, codes, networkLevel)

  // Gate 4: shared list.
  if (r.toIsSuspect) return pending([Reason.R4_SHARED_LIST, ...codes])

  // Gate 5 (minimal): per token, multiplier 1.0, bigint. The contract re-checks on write.
  if (r.approved + q.amount > r.deposited) return pending([Reason.R5_OVER_DEPOSIT, ...codes])

  return { decision: Decision.APPROVE, publicReason: 0, codes, networkLevel }
}

/** USD value in 1e6 units: qUSD 1:1 (6 decimals); other tokens via the ETH/USD feed. */
function usd(amount: bigint, token: Address, p: Phase5Reads): bigint {
  const i = p.tokens.findIndex((t) => eq(t, token))
  const dec = BigInt(p.decimals[i] ?? 18)
  if (eq(token, p.usdToken)) return (amount * 1_000_000n) / 10n ** dec
  return (amount * p.price * 1_000_000n) / (10n ** dec * 10n ** BigInt(p.priceDecimals))
}

/** Gates 4 to 7 with the SPRT score. Everything after gate 3 is silent: outside only sees PENDING or a delay. */
function judgePhase5(r: Reads, p: Phase5Reads, codes: number[], networkLevel: number): Judgement {
  const q = r.request
  const tok = q.token.toLowerCase()

  // score: decay, then add this request's signals
  const fake = p.fakeThreshold[tok] ?? 0n
  const sig = {
    newAccount: p.firstDepositAt === 0n || r.blockTime - p.firstDepositAt < p.sprt.newAccountSeconds,
    newRecipient: !p.seenRecipient,
    thresholdHug: hugsFakeThreshold(q.amount, fake),
    fingerprint: r.fingerprintActive,
    recentPending: p.prevScore.pendingCount > 0,
  }
  const lam = lambdas(p.sprt, sig)
  const lambda = decay(p.sprt, p.prevScore, r.blockTime) + Object.values(lam).reduce((a, b) => a + b, 0n)
  const level = levelOf(p.sprt, lambda)
  const effectiveLevel = Math.max(level, networkLevel)
  if (sig.thresholdHug) codes.push(Reason.R7_THRESHOLD_HUG)

  const finish = (decision: number, extra: number[], notBefore = 0n): Judgement => ({
    decision,
    publicReason: 0,
    codes: [...extra, ...codes],
    networkLevel,
    notBefore,
    score: {
      next: {
        lambda,
        tLast: r.blockTime,
        pendingCount:
          decision === Decision.PENDING || notBefore > 0n
            ? Math.min(p.prevScore.pendingCount + 1, 255)
            : p.prevScore.pendingCount,
      },
      lambdas: lam,
      level,
      effectiveLevel,
    },
  })

  // Gate 4: shared list
  if (r.toIsSuspect) return finish(Decision.PENDING, [Reason.R4_SHARED_LIST])

  // Gate 6: sources agree, price fresh (checked before gate 5, which depends on the price)
  if (p.depositedSecondSource !== undefined && p.depositedSecondSource !== r.deposited) {
    return finish(Decision.PENDING, [Reason.R6_SOURCE_MISMATCH])
  }
  if (r.blockTime > p.priceUpdatedAt + p.maxPriceAge) return finish(Decision.PENDING, [Reason.R6_PRICE_STALE])

  // Gate 5 in USD across tokens, multiplier 1.0 (the contract still re-checks per token on write)
  let depUsd = 0n
  let apprUsd = 0n
  p.tokens.forEach((t, i) => {
    depUsd += usd(p.depositedAll[i] ?? 0n, t, p)
    apprUsd += usd(p.approvedAll[i] ?? 0n, t, p)
  })
  if (apprUsd + usd(q.amount, q.token, p) > depUsd) return finish(Decision.PENDING, [Reason.R5_OVER_DEPOSIT])

  // Gate 7: hidden cap by level -> a delay tier (docs/47 R3). The longest applicable delay wins.
  let delay = 0n
  const extra: number[] = []
  const hold = (d: bigint, code?: number) => {
    if (d > delay) delay = d
    if (code !== undefined && !extra.includes(code)) extra.push(code)
  }
  const range = p.thresholds[tok]
  if (range) {
    const te = thresholdOf(r.k, epochOf(r.blockTime, p.epochLen), q.token, range)
    if (effectiveLevel >= 3) hold(p.d3Delay, Reason.R7_HIDDEN_CAP)
    else if (effectiveLevel === 2) {
      if (sig.newRecipient || q.amount * 4n > te) hold(p.d2Delay, Reason.R7_HIDDEN_CAP)
    } else if (effectiveLevel === 1) hold(q.amount * 2n > te ? p.d2Delay : p.l1Delay, Reason.R7_HIDDEN_CAP)
    else if (q.amount > te) hold(p.d2Delay, Reason.R7_HIDDEN_CAP)
  }
  // docs/47 R2: large amount to a new address
  const shadow: string[] = []
  const lp = p.largeNew?.minAmount[tok]
  if (p.largeNew && lp !== undefined && sig.newRecipient && q.amount > lp) {
    if (p.largeNew.mode === 'enforce') hold(p.largeNew.delay, Reason.R7_LARGE_NEW)
    else shadow.push('largeNew')
  }
  const j = finish(Decision.APPROVE, extra, delay > 0n ? r.blockTime + delay : 0n)
  return shadow.length ? { ...j, shadow } : j
}

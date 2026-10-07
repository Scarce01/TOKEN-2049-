// Cosign workflow: one handler on RequestBoard.WithdrawalRequested (LATEST). 33_phase3.md 3.4.
// Reads: headerByNumber 1 + QuorumLens.cosignView 1, both at the event block.
// Secrets: QUORUM_K, DECOY_TAGS, DECOY_THRESHOLD (phase 5).
import { cre, type EVMLog, type Runtime } from '@chainlink/cre-sdk'
import {
  type Address,
  decodeEventLog,
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  hexToBytes,
  parseAbiParameters,
} from 'viem'
import { z } from 'zod'
import {
  decoySalt,
  decoyTag,
  encodeReport,
  QuorumLensAbi,
  RequestBoardAbi,
  unpackTags,
} from '../../packages/shared/src/index'
import { baseConfig } from '../common/config'
import { b64, bytesToHex, callAt, evmFor, headerAt, protoBigIntToBigint, secret, writeReport } from '../common/cre'
import { buildCosign, requestFingerprint } from './src/logic/build'
import { judge, type Phase5Reads, type Reads } from './src/logic/gates'
import { DEFAULT_SPRT, decayTable, decryptScore, scoreKey } from './src/logic/sprt'

export const configSchema = baseConfig.extend({
  requestBoard: z.string(),
  quorumLens: z.string(),
  verdictTtl: z.number(),
  officerSealKeys: z.array(z.string()),
  /** Phase 5 (gates 5 USD, 6, 7 and SPRT). Omit to run the phase 3 gates only. */
  phase5: z
    .object({
      usdToken: z.string(),
      priceDecimals: z.number(),
      maxPriceAge: z.number(),
      epochLen: z.number(),
      l1Delay: z.number(),
      d2Delay: z.number(),
      d3Delay: z.number(),
      /** docs/47 R2. mode shadow = log only; minAmount: token => wei string */
      largeNew: z
        .object({ mode: z.enum(['enforce', 'shadow']), delay: z.number(), minAmount: z.record(z.string(), z.string()) })
        .optional(),
      thresholds: z.record(z.string(), z.object({ tMin: z.string(), tMax: z.string() })), // token => wei strings
      fakeThresholdToken: z.string(), // DECOY_THRESHOLD applies to this token
      gammaPpm: z.number(),
    })
    .optional(),
  /** Merkle (index, path) per decoy-account tag; salt = HMAC(K, "decoy" || index). Not in git. */
  decoyProofs: z.record(z.string(), z.object({ i: z.number(), path: z.array(z.string()) })).optional(),
})
export type Config = z.infer<typeof configSchema>

const WITHDRAWAL_REQUESTED = encodeEventTopics({ abi: RequestBoardAbi, eventName: 'WithdrawalRequested' })[0] as Hex

type CosignView = {
  key: Address
  tokens: readonly Address[]
  deposited: readonly bigint[]
  approved: readonly bigint[]
  firstDepositAt: bigint
  seenRecipient: boolean
  toIsSuspect: boolean
  fingerprintActive: boolean
  activeConfirmedCount: bigint
  alert: number
  score: Hex
  priceAnswer: bigint
  priceUpdatedAt: bigint
}

function onRequest(runtime: Runtime<Config>, log: EVMLog): string {
  const c = runtime.config
  const evm = evmFor(c.chainName)
  const at = log.blockNumber ? protoBigIntToBigint(log.blockNumber) : 0n
  const ev = decodeEventLog({
    abi: RequestBoardAbi,
    eventName: 'WithdrawalRequested',
    data: bytesToHex(log.data),
    topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
  })
  const { request: q, intent: i, signer } = ev.args
  const org = c.orgs.find((o) => o.orgId.toLowerCase() === q.orgId.toLowerCase())
  if (!org) {
    runtime.log('[warn] unknown org; no report')
    return 'no-op: unknown org'
  }
  const tok = c.tokens.find((t) => t.address.toLowerCase() === q.token.toLowerCase())
  const decimals = tok?.decimals ?? 18

  const header = headerAt(runtime, evm, at)
  const fp = requestFingerprint(BigInt(c.chainId), q.token, q.amount, decimals)
  const k = hexToBytes(secret(runtime, 'QUORUM_K') as Hex)
  const tags = unpackTags(secret(runtime, 'DECOY_TAGS'))
  const view = callAt(
    runtime,
    evm,
    c.quorumLens as Address,
    QuorumLensAbi,
    'cosignView',
    [q.orgId, q.userIdHash, q.token, q.to, fp, scoreKey(k, q.userIdHash)],
    at,
  ) as CosignView
  const ti = view.tokens.findIndex((t) => t.toLowerCase() === q.token.toLowerCase())

  let p5: Phase5Reads | undefined
  if (c.phase5) {
    const fake = BigInt(secret(runtime, 'DECOY_THRESHOLD') || '0')
    const thresholds: Phase5Reads['thresholds'] = {}
    for (const key of Object.keys(c.phase5.thresholds).sort()) {
      const v = c.phase5.thresholds[key]!
      thresholds[key.toLowerCase()] = { tMin: BigInt(v.tMin), tMax: BigInt(v.tMax) }
    }
    p5 = {
      sprt: { ...DEFAULT_SPRT, decayPpm: decayTable(BigInt(c.phase5.gammaPpm), 72) },
      prevScore: decryptScore(k, view.score),
      seenRecipient: view.seenRecipient,
      firstDepositAt: view.firstDepositAt,
      tokens: [...view.tokens],
      decimals: view.tokens.map(
        (t) => c.tokens.find((x) => x.address.toLowerCase() === t.toLowerCase())?.decimals ?? 18,
      ),
      depositedAll: [...view.deposited],
      approvedAll: [...view.approved],
      usdToken: c.phase5.usdToken as Address,
      price: view.priceAnswer,
      priceDecimals: c.phase5.priceDecimals,
      priceUpdatedAt: view.priceUpdatedAt,
      maxPriceAge: BigInt(c.phase5.maxPriceAge),
      // second data source (NOWNodes) is not wired: Base Sepolia support unconfirmed (S7); see STATUS
      depositedSecondSource: undefined,
      thresholds,
      epochLen: BigInt(c.phase5.epochLen),
      fakeThreshold: { [c.phase5.fakeThresholdToken.toLowerCase()]: fake },
      l1Delay: BigInt(c.phase5.l1Delay),
      d2Delay: BigInt(c.phase5.d2Delay),
      d3Delay: BigInt(c.phase5.d3Delay),
      largeNew: c.phase5.largeNew && {
        mode: c.phase5.largeNew.mode,
        delay: BigInt(c.phase5.largeNew.delay),
        minAmount: Object.fromEntries(
          Object.keys(c.phase5.largeNew.minAmount)
            .sort()
            .map((t) => [t.toLowerCase(), BigInt(c.phase5!.largeNew!.minAmount[t]!)]),
        ),
      },
    }
  }

  // Merkle proof for a decoy account (THREAT entries need it once proofs are required)
  let decoyProof: Hex | undefined
  const acctTag = decoyTag(k, 'acct', q.userIdHash)
  const mp = c.decoyProofs?.[acctTag]
  if (mp) {
    const salt = decoySalt(k, mp.i)
    decoyProof = encodeAbiParameters(parseAbiParameters('bytes32, bytes32, bytes32[]'), [
      q.userIdHash,
      salt,
      mp.path as Hex[],
    ])
  }

  const reads: Reads = {
    chainId: BigInt(c.chainId),
    blockTime: header.timestamp,
    request: {
      requestId: q.requestId,
      orgId: q.orgId,
      userIdHash: q.userIdHash,
      kind: q.kind,
      vault: q.vault,
      token: q.token,
      to: q.to,
      amount: q.amount,
      nonce: q.nonce,
      deadline: q.deadline,
      txHash: q.txHash,
    },
    intent: { ...i },
    signer,
    orgVaults: [org.hotVault as Address, org.warmVault as Address],
    allowedTokens: c.tokens.map((t) => t.address as Address),
    key: view.key,
    deposited: ti >= 0 ? (view.deposited[ti] ?? 0n) : 0n,
    approved: ti >= 0 ? (view.approved[ti] ?? 0n) : 0n,
    toIsSuspect: view.toIsSuspect,
    fingerprintActive: view.fingerprintActive,
    activeConfirmedCount: view.activeConfirmedCount,
    k,
    decoyTags: tags,
    p5,
  }
  const j = judge(reads)
  const out = buildCosign({
    reads,
    judgement: j,
    eventTxHash: bytesToHex(log.txHash),
    eventLogIndex: BigInt(log.index),
    hotVault: org.hotVault as Address,
    warmVault: org.warmVault as Address,
    tokens: c.tokens.map((t) => t.address as Address),
    tokenDecimals: decimals,
    officerSealKeys: c.officerSealKeys as Hex[],
    verdictTtl: BigInt(c.verdictTtl),
    freezeDuration: BigInt(c.freezeDuration),
    alertTtl: BigInt(c.alertTtlConfirmed),
    coldDelay: BigInt(c.coldDelayTight),
    threatTtl: BigInt(c.threatTtl),
    prevScoreCipher: view.score,
    decoyProof,
  })
  runtime.log(`cosign case=${out.caseId.slice(0, 10)} decision=${j.decision} notBefore=${j.notBefore ?? 0n}`)
  // shadow rules: what they would have done, so their false-delay rate can be measured before enforcing (docs/47 5)
  if (j.shadow?.length) runtime.log(`cosign case=${out.caseId.slice(0, 10)} shadow=${j.shadow.join(',')}`)
  const report = encodeReport({
    chainId: BigInt(c.chainId),
    orgId: q.orgId,
    caseId: out.caseId,
    issuedAt: header.timestamp,
    actions: out.actions,
  })
  const w = writeReport(
    runtime,
    evm,
    org.receiver as Address,
    report,
    BigInt(c.reportGasLimit),
    `cosign case=${out.caseId.slice(0, 10)}`,
  )
  return w.ok ? `verdict ${j.decision}` : 'write failed'
}

export function initWorkflow(c: Config) {
  const evm = evmFor(c.chainName)
  return [
    cre.handler(
      evm.logTrigger({
        addresses: [b64(c.requestBoard)],
        topics: [{ values: [b64(WITHDRAWAL_REQUESTED)] }],
        confidence: 'CONFIDENCE_LEVEL_LATEST',
      }),
      onRequest,
    ),
  ]
}

import { type Address, decodeAbiParameters, encodeAbiParameters, type Hex, parseAbiParameters } from 'viem'
import { Kind } from './constants'

/** Envelope: abi.encode(uint8 version, uint256 chainId, bytes32 orgId, bytes32 caseId, uint64 issuedAt, (uint8,bytes)[]) */
const ENVELOPE = parseAbiParameters('uint8, uint256, bytes32, bytes32, uint64, (uint8 kind, bytes data)[]')

/** Per-kind data ABI (10_interfaces.md section 4). */
export const ACTION_ABI = {
  [Kind.PING]: parseAbiParameters('bytes32 note'),
  [Kind.VERDICT]: parseAbiParameters(
    'bytes32 requestId, bytes32 txHash, bytes32 userIdHash, address token, uint256 amount, uint8 decision, uint8 publicReason, uint64 notBefore, uint64 expiresAt, bytes sealedReason',
  ),
  [Kind.ALERT]: parseAbiParameters('uint8 level, uint64 expiresAt'),
  [Kind.FREEZE]: parseAbiParameters('address vault, uint64 until'),
  [Kind.SWEEP]: parseAbiParameters('address vault, address[] tokens'),
  [Kind.QUOTA_ZERO]: parseAbiParameters('address vault, address[] tokens'),
  [Kind.COLD_DELAY]: parseAbiParameters('uint64 newDelay'),
  [Kind.THREAT]: parseAbiParameters(
    'address suspect, uint64 chainId, bytes32 evidenceHash, bytes32 fingerprintHash, uint64 expiresAt, bytes32 parentEvidence, bytes proof',
  ),
  [Kind.QUOTA_REFILL]: parseAbiParameters('address vault, address token, uint64 epoch, uint256 amount'),
  [Kind.SCORE]: parseAbiParameters('bytes32 scoreKey, bytes32 requestId, bytes32 prevHash, bytes ciphertext'),
  [Kind.TOPUP]: parseAbiParameters('address fromVault, address toVault, address token, uint256 targetBalance'),
  [Kind.THRESHOLD_COMMIT]: parseAbiParameters('uint64 epoch, address token, bytes32 commitment'),
  [Kind.THRESHOLD_REVEAL]: parseAbiParameters('uint64 epoch, address token, uint256 threshold, bytes32 nonce'),
  [Kind.PATROL_STATE]: parseAbiParameters(
    'address vault, address token, uint64 minute, uint256 S, bool alarm, bool gap',
  ),
  [Kind.ASSET_CHECKPOINT]: parseAbiParameters('bytes32 orgId, address token, uint64 safeBlock, int256 assetValue'),
} as const

export type Action = { kind: number; data: Hex }

export type Envelope = {
  version: number
  chainId: bigint
  orgId: Hex
  caseId: Hex
  issuedAt: bigint
  actions: Action[]
}

export function encodeReport(e: Omit<Envelope, 'version'> & { version?: number }): Hex {
  return encodeAbiParameters(ENVELOPE, [
    e.version ?? 1,
    e.chainId,
    e.orgId,
    e.caseId,
    e.issuedAt,
    e.actions.map((a) => ({ kind: a.kind, data: a.data })),
  ])
}

export function decodeReport(hex: Hex): Envelope {
  const [version, chainId, orgId, caseId, issuedAt, actions] = decodeAbiParameters(ENVELOPE, hex)
  return { version, chainId, orgId, caseId, issuedAt, actions: actions.map((a) => ({ kind: a.kind, data: a.data })) }
}

// biome-ignore lint/suspicious/noExplicitAny: per-kind tuple types differ
export function encodeAction(kind: number, values: readonly any[]): Action {
  const abi = ACTION_ABI[kind as keyof typeof ACTION_ABI]
  if (!abi) throw new Error(`unknown kind ${kind}`)
  // biome-ignore lint/suspicious/noExplicitAny: see above
  return { kind, data: encodeAbiParameters(abi as any, values as any) }
}

export function decodeAction(a: Action): readonly unknown[] {
  const abi = ACTION_ABI[a.kind as keyof typeof ACTION_ABI]
  if (!abi) throw new Error(`unknown kind ${a.kind}`)
  return decodeAbiParameters(abi, a.data)
}

// ---------- typed builders ----------
export const act = {
  ping: (note: Hex) => encodeAction(Kind.PING, [note]),
  alert: (level: number, expiresAt: bigint) => encodeAction(Kind.ALERT, [level, expiresAt]),
  freeze: (vault: Address, until: bigint) => encodeAction(Kind.FREEZE, [vault, until]),
  sweep: (vault: Address, tokens: Address[]) => encodeAction(Kind.SWEEP, [vault, tokens]),
  quotaZero: (vault: Address, tokens: Address[]) => encodeAction(Kind.QUOTA_ZERO, [vault, tokens]),
  coldDelay: (d: bigint) => encodeAction(Kind.COLD_DELAY, [d]),
  threat: (t: {
    suspect: Address
    chainId: bigint
    evidenceHash: Hex
    fingerprintHash: Hex
    expiresAt: bigint
    parentEvidence: Hex
    proof: Hex
  }) =>
    encodeAction(Kind.THREAT, [
      t.suspect,
      t.chainId,
      t.evidenceHash,
      t.fingerprintHash,
      t.expiresAt,
      t.parentEvidence,
      t.proof,
    ]),
  verdict: (v: {
    requestId: Hex
    txHash: Hex
    userIdHash: Hex
    token: Address
    amount: bigint
    decision: number
    publicReason: number
    notBefore: bigint
    expiresAt: bigint
    sealedReason: Hex
  }) =>
    encodeAction(Kind.VERDICT, [
      v.requestId,
      v.txHash,
      v.userIdHash,
      v.token,
      v.amount,
      v.decision,
      v.publicReason,
      v.notBefore,
      v.expiresAt,
      v.sealedReason,
    ]),
  quotaRefill: (vault: Address, token: Address, epoch: bigint, amount: bigint) =>
    encodeAction(Kind.QUOTA_REFILL, [vault, token, epoch, amount]),
  topUp: (from: Address, to: Address, token: Address, target: bigint) =>
    encodeAction(Kind.TOPUP, [from, to, token, target]),
  score: (scoreKey: Hex, requestId: Hex, prevHash: Hex, ciphertext: Hex) =>
    encodeAction(Kind.SCORE, [scoreKey, requestId, prevHash, ciphertext]),
  thresholdCommit: (epoch: bigint, token: Address, commitment: Hex) =>
    encodeAction(Kind.THRESHOLD_COMMIT, [epoch, token, commitment]),
  thresholdReveal: (epoch: bigint, token: Address, threshold: bigint, nonce: Hex) =>
    encodeAction(Kind.THRESHOLD_REVEAL, [epoch, token, threshold, nonce]),
  patrolState: (vault: Address, token: Address, minute: bigint, S: bigint, alarm: boolean, gap: boolean) =>
    encodeAction(Kind.PATROL_STATE, [vault, token, minute, S, alarm, gap]),
  assetCheckpoint: (orgId: Hex, token: Address, safeBlock: bigint, assetValue: bigint) =>
    encodeAction(Kind.ASSET_CHECKPOINT, [orgId, token, safeBlock, assetValue]),
}

export type ConfirmedPackInput = {
  warmVault: Address
  hotVault: Address
  tokens: Address[]
  blockTime: bigint
  freezeDuration: bigint
  alertTtl: bigint
  coldDelay: bigint
  threat: Parameters<typeof act.threat>[0]
}

/** Fixed order: FREEZE(warm), QUOTA_ZERO(hot), SWEEP(hot), ALERT(4), COLD_DELAY, THREAT. */
export function confirmedPack(p: ConfirmedPackInput): Action[] {
  return [
    act.freeze(p.warmVault, p.blockTime + p.freezeDuration),
    act.quotaZero(p.hotVault, p.tokens),
    act.sweep(p.hotVault, p.tokens),
    act.alert(4, p.blockTime + p.alertTtl),
    act.coldDelay(p.coldDelay),
    act.threat(p.threat),
  ]
}

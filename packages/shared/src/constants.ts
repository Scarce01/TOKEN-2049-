import { keccak256, toBytes } from 'viem'

/** Base Sepolia (primary) and its CRE chain name. */
export const CHAIN_ID = 84532
export const CRE_CHAIN_NAME = 'ethereum-testnet-sepolia-base-1'
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const

export const ORG_A = keccak256(toBytes('exchange-a'))
export const ORG_B = keccak256(toBytes('exchange-b'))
export const ORGS = { a: ORG_A, b: ORG_B } as const

export const NATIVE = '0x0000000000000000000000000000000000000000' as const
export const DECIMALS = { qUSD: 6, qETH: 18 } as const

/** Report action kinds (10_interfaces.md section 4). */
export const Kind = {
  PING: 0,
  VERDICT: 1,
  ALERT: 2,
  FREEZE: 3,
  SWEEP: 4,
  QUOTA_ZERO: 5,
  COLD_DELAY: 6,
  THREAT: 7,
  QUOTA_REFILL: 8,
  SCORE: 9,
  TOPUP: 10,
  THRESHOLD_COMMIT: 11,
  THRESHOLD_REVEAL: 12,
  PATROL_STATE: 13,
  ASSET_CHECKPOINT: 14,
} as const
export type KindName = keyof typeof Kind

export const Decision = { NONE: 0, APPROVE: 1, REJECT: 2, PENDING: 3 } as const

export const CONFIRMED = 4

/** Officer action kinds (10_interfaces.md section 2). */
export const OfficerKind = {
  EXTEND_FREEZE: 1,
  MANUAL_APPROVE: 2,
  LOWER_ALERT: 3,
  COLD_QUEUE: 4,
  COLD_LOWER_DELAY: 5,
  CANCEL_QUEUED: 6,
  CONFIG: 7,
  PLANNED_OP: 8,
  RESET_ASSET_CHECKPOINT: 9,
  HOLD_VERDICT: 10, // one officer, expires (docs/47)
  CANCEL_VERDICT: 11, // two officers (docs/47)
} as const

/** Reason codes (10_interfaces.md section 6). */
export const Reason = {
  R1_TXHASH: 11,
  R2_SAFE_TX: 21,
  R2_TOKEN: 22,
  R2_VAULT: 23,
  R3_SIGNER: 31,
  R3_FIELDS: 32,
  R3_EXPIRED: 33,
  R4_DECOY_ACCOUNT: 41,
  R4_SHARED_LIST: 42,
  R4_DECOY_ADDRESS: 43,
  R4_FINGERPRINT: 44,
  R5_OVER_DEPOSIT: 51,
  R6_SOURCE_MISMATCH: 61,
  R6_PRICE_STALE: 62,
  R7_HIDDEN_CAP: 71,
  R7_THRESHOLD_HUG: 72,
  R7_LARGE_NEW: 73, // docs/47 R2: amount over L_pub to a new address (delay, sealed)
} as const

/** Fingerprint action types shared by Trap and Cosign. */
export const FpAction = { PROBE: 1, THRESHOLD_HUG: 2 } as const

/** Default parameters (10_interfaces.md section 7). Seconds unless noted. */
export const Params = {
  VERDICT_TTL: 15 * 60,
  REPORT_MAX_AGE: 10 * 60,
  RESUBMIT_AFTER: 2 * 60,
  BACKLOG_AGE: 15 * 60,
  BACKLOG_ALERT_TTL: 30 * 60,
  BACKLOG_MAX: 5,
  ANCHOR_LAG: 5,
  FREEZE_DURATION: 2 * 3600,
  ALERT_TTL_CONFIRMED: 2 * 3600,
  ALERT_TTL_L2: 2 * 3600,
  THREAT_TTL: 72 * 3600,
  COLD_DELAY_NORMAL: 24 * 3600,
  COLD_DELAY_TIGHT: 72 * 3600,
  COLD_DELAY_MAX: 7 * 24 * 3600,
  MANUAL_DELAY: 10 * 60,
  L1_DELAY: 10 * 60,
  // docs/47 delay tiers (assumed, team decision pending)
  D2_DELAY: 60 * 60,
  D3_DELAY: 24 * 60 * 60,
  LARGE_NEW_DELAY: 60 * 60,
  QUOTA_PERIOD: 60,
  REPORT_GAS_LIMIT: 1_500_000n,
} as const

// Pure decision for the keeper: should this approved withdrawal be sent now? (docs/47 3.1)
// The keeper has no authority: the vault and Receiver re-check everything, it only pays the gas.
import type { Address, Hex } from 'viem'

export type VaultTx = {
  requestId: Hex
  userIdHash: Hex
  token: Address
  to: Address
  amount: bigint
  nonce: bigint
  deadline: bigint
}
export type Candidate = { txHash: Hex; vault: Address; vaultTx: VaultTx }
export type VerdictState = {
  decision: number // 0 none, 1 APPROVE, 2 REJECT, 3 PENDING
  used: boolean
  released: boolean
  notBefore: bigint
  expiresAt: bigint
  heldUntil: bigint
}

export function isDue(_c: Candidate, v: VerdictState, now: bigint): 'send' | 'wait' | 'drop' {
  if (v.decision === 0) return 'wait' // no verdict yet
  if (v.decision !== 1 || v.used || v.released || now > v.expiresAt) return 'drop'
  if (now < v.notBefore || now < v.heldUntil) return 'wait'
  return 'send'
}

/** Reverts worth retrying later; anything else means the withdrawal will never go through. */
export const RETRY = new Set(['NotYetValid', 'Held', 'QuotaExceeded', 'WindowExceeded', 'Frozen', 'AlertConfirmed'])

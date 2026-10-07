// Hidden threshold per epoch and token (10_interfaces.md 8.3, proposal 6 D). Shared by Cosign and Patrol.
import {
  bytesToHex,
  encodeAbiParameters,
  type Hex,
  hexToBytes,
  keccak256,
  numberToBytes,
  parseAbiParameters,
} from 'viem'
import { hmacK } from '../../packages/shared/src/index'

export type ThresholdRange = { tMin: bigint; tMax: bigint }

export function epochOf(t: bigint, epochLen: bigint): bigint {
  return t / epochLen
}

/** T_e = T_min + (HMAC(K, "thr" || e || token) mod (T_max - T_min)). */
export function thresholdOf(k: Uint8Array, epoch: bigint, token: Hex, r: ThresholdRange): bigint {
  const h = BigInt(bytesToHex(hmacK(k, 'thr', numberToBytes(epoch, { size: 8 }), hexToBytes(token))))
  return r.tMin + (h % (r.tMax - r.tMin))
}

export function thresholdNonce(k: Uint8Array, epoch: bigint, token: Hex): Hex {
  return bytesToHex(hmacK(k, 'thrnonce', numberToBytes(epoch, { size: 8 }), hexToBytes(token)))
}

export function thresholdCommitment(threshold: bigint, nonce: Hex): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters('uint256, bytes32'), [threshold, nonce]))
}

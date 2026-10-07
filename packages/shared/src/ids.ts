import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import {
  type Address,
  concat,
  encodeAbiParameters,
  type Hex,
  hexToBytes,
  keccak256,
  parseAbiParameters,
  toBytes,
  toHex,
} from 'viem'

/** keccak256(abi.encode(orgSalt, userId)) */
export function userIdHash(orgSalt: Hex, userId: string): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters('bytes32, string'), [orgSalt, userId]))
}

/** keccak256(abi.encode(orgId, uuid)); uuid as string, never an autoincrement id. */
export function requestId(orgId: Hex, uuid: string): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters('bytes32, string'), [orgId, uuid]))
}

export type TxFields = {
  chainId: bigint | number
  vault: Address
  requestId: Hex
  userIdHash: Hex
  token: Address
  to: Address
  amount: bigint
  nonce: bigint
  deadline: bigint | number
}

/** Same formula QuorumVault.txHashOf recomputes. */
export function txHash(t: TxFields): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('uint256, address, bytes32, bytes32, address, address, uint256, uint256, uint64'),
      [BigInt(t.chainId), t.vault, t.requestId, t.userIdHash, t.token, t.to, t.amount, t.nonce, BigInt(t.deadline)],
    ),
  )
}

export function caseIdWithdrawal(orgId: Hex, reqId: Hex): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters('bytes32, bytes32'), [orgId, reqId]))
}

export function caseIdTrap(orgId: Hex, chainId: bigint | number, tx: Hex, logIndex: bigint | number): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters('bytes32, uint256, bytes32, uint256'), [
      orgId,
      BigInt(chainId),
      tx,
      BigInt(logIndex),
    ]),
  )
}

/** Native-coin decoy: (orgId, chainId, decoy address, block where the drop was found). */
export function caseIdNative(orgId: Hex, chainId: bigint | number, decoy: Address, block: bigint | number): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters('bytes32, uint256, address, uint256'), [
      orgId,
      BigInt(chainId),
      decoy,
      BigInt(block),
    ]),
  )
}

/** "Q-" + first 4 hex upper + "-" + next 4. */
export function displayCase(caseId: Hex): string {
  const h = caseId.slice(2, 10).toUpperCase()
  return `Q-${h.slice(0, 4)}-${h.slice(4, 8)}`
}

export function evidenceHash(chainId: bigint | number, tx: Hex, logIndex: bigint | number): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters('uint256, bytes32, uint256'), [BigInt(chainId), tx, BigInt(logIndex)]),
  )
}

/** floor(log2(amount / 0.01 token)), clamped to 0..40. Pure bigint. */
export function amountBucket(amount: bigint, decimals: number): number {
  const unit = 10n ** BigInt(decimals) / 100n // 0.01 token
  if (unit === 0n) return 0
  let q = amount / unit
  if (q <= 1n) return 0
  let b = 0
  while (q > 1n) {
    q >>= 1n
    b++
  }
  return Math.min(b, 40)
}

/** keccak256(abi.encode(chainId, token, bucket, actionType)). No address on purpose. */
export function fingerprintHash(chainId: bigint | number, token: Address, bucket: number, actionType: number): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters('uint256, address, uint8, uint8'), [
      BigInt(chainId),
      token,
      bucket,
      actionType,
    ]),
  )
}

export type TagKind = 'acct' | 'addr'

/** HMAC-SHA256(K, kind || ident) first 8 bytes. ident: userIdHash (acct) or address (addr). */
export function decoyTag(k: Uint8Array, kind: TagKind, ident: Hex): Hex {
  const msg = concat([toBytes(kind), hexToBytes(ident)])
  return toHex(hmac(sha256, k, msg).slice(0, 8))
}

/** S4 fallback: keccak256(salt || kind || ident) first 8 bytes. */
export function decoyTagKeccak(salt: Hex, kind: TagKind, ident: Hex): Hex {
  return keccak256(concat([salt, toHex(toBytes(kind)), ident])).slice(0, 18) as Hex
}

/** HMAC(K, label || parts...) full 32 bytes; the single source of workflow "randomness". */
export function hmacK(k: Uint8Array, label: string, ...parts: Uint8Array[]): Uint8Array {
  return hmac(sha256, k, concat([toBytes(label), ...parts]))
}

/** bytes10 in report metadata: ASCII of the first 10 hex chars of sha256(name). */
export function encodeWorkflowName(name: string): Hex {
  const h = toHex(sha256(toBytes(name))).slice(2, 12)
  return toHex(toBytes(h))
}

/** Split packed DECOY_TAGS hex (8 bytes per tag) into a Set of 0x-prefixed tags. */
export function unpackTags(packed: string): Set<string> {
  const s = packed.startsWith('0x') ? packed.slice(2) : packed
  const out = new Set<string>()
  for (let i = 0; i + 16 <= s.length; i += 16) out.add(`0x${s.slice(i, i + 16).toLowerCase()}`)
  return out
}

export function packTags(tags: Hex[]): Hex {
  return `0x${tags.map((t) => t.slice(2).toLowerCase()).join('')}` as Hex
}

/** salt_i = HMAC(K, "decoy" || uint32 i). Used by decoy-admin (Merkle leaves) and by Trap / Cosign (proofs). */
export function decoySalt(k: Uint8Array, i: number): Hex {
  return toHex(hmacK(k, 'decoy', hexToBytes(`0x${i.toString(16).padStart(8, '0')}`)))
}

/** Merkle leaf, same as DecoyCommit.leafOf: keccak256(bytes.concat(keccak256(abi.encode(chainId, ident, salt)))). */
export function decoyLeaf(chainId: bigint | number, ident: Hex, salt: Hex): Hex {
  return keccak256(
    keccak256(encodeAbiParameters(parseAbiParameters('uint256, bytes32, bytes32'), [BigInt(chainId), ident, salt])),
  )
}

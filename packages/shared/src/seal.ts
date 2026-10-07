import { gcm } from '@noble/ciphers/aes.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concat, type Hex, hexToBytes, numberToBytes } from 'viem'
import { hmacK } from './ids'

/**
 * Deterministic ECIES (secp256k1 + AES-256-GCM), one envelope per officer, concatenated.
 * Ephemeral key = HMAC(K, "seal" || requestId || idx) mod n; nonce = HMAC(K, "nonce" || requestId || idx)[0:12].
 * Every node computes the same ciphertext, so the report reaches consensus (10_interfaces.md section 4).
 *
 * Envelope per officer: ephPub(33) || nonce(12) || ciphertext(PLAINTEXT_LEN) || tag(16).
 * Plaintext: uint16 length || payload || zero padding to PLAINTEXT_LEN, so every sealedReason
 * has the same length regardless of reason (D15).
 */
export const PLAINTEXT_LEN = 254
export const ENVELOPE_LEN = 33 + 12 + PLAINTEXT_LEN + 16

const N = secp256k1.Point.CURVE().n

function ephemeralKey(k: Uint8Array, requestId: Hex, idx: number): Uint8Array {
  const h = hmacK(k, 'seal', hexToBytes(requestId), numberToBytes(idx, { size: 1 }))
  let x = BigInt(bytesToHex(h)) % N
  if (x === 0n) x = 1n
  return hexToBytes(`0x${x.toString(16).padStart(64, '0')}`)
}

function aesKey(sharedCompressed: Uint8Array): Uint8Array {
  return sha256(sharedCompressed.slice(1)) // x coordinate
}

export function pad(payload: Uint8Array): Uint8Array {
  if (payload.length > PLAINTEXT_LEN - 2) throw new Error('seal payload too long')
  const out = new Uint8Array(PLAINTEXT_LEN)
  out[0] = payload.length >> 8
  out[1] = payload.length & 0xff
  out.set(payload, 2)
  return out
}

export function unpad(p: Uint8Array): Uint8Array {
  const len = ((p[0] ?? 0) << 8) | (p[1] ?? 0)
  return p.slice(2, 2 + len)
}

export function seal(k: Uint8Array, requestId: Hex, officerPubKeys: Hex[], payload: Uint8Array): Hex {
  const plain = pad(payload)
  const parts: Uint8Array[] = []
  officerPubKeys.forEach((pub, idx) => {
    const eph = ephemeralKey(k, requestId, idx)
    const ephPub = secp256k1.getPublicKey(eph, true)
    const shared = secp256k1.getSharedSecret(eph, hexToBytes(pub), true)
    const nonce = hmacK(k, 'nonce', hexToBytes(requestId), numberToBytes(idx, { size: 1 })).slice(0, 12)
    const ct = gcm(aesKey(shared), nonce).encrypt(plain)
    parts.push(ephPub, nonce, ct)
  })
  return bytesToHex(concat(parts))
}

export function unseal(sealed: Hex, idx: number, officerPrivKey: Hex): Uint8Array {
  const all = hexToBytes(sealed)
  const env = all.slice(idx * ENVELOPE_LEN, (idx + 1) * ENVELOPE_LEN)
  if (env.length !== ENVELOPE_LEN) throw new Error('no envelope for officer index')
  const ephPub = env.slice(0, 33)
  const nonce = env.slice(33, 45)
  const ct = env.slice(45)
  const shared = secp256k1.getSharedSecret(hexToBytes(officerPrivKey), ephPub, true)
  return unpad(gcm(aesKey(shared), nonce).decrypt(ct))
}

/** Officer seal keypair (separate from wallets). Caller supplies the 32-byte secret. */
export function sealPublicKey(priv: Hex): Hex {
  return bytesToHex(secp256k1.getPublicKey(hexToBytes(priv), true))
}

/** Plaintext reason payload: compact JSON of codes and per-signal lambdas (D53). */
export type ReasonPayload = { codes: number[]; lambda?: Record<string, number>; score?: string; level?: number }

export function encodeReason(r: ReasonPayload): Uint8Array {
  // keys sorted for determinism
  const sorted: ReasonPayload = { codes: r.codes }
  if (r.lambda) {
    const l: Record<string, number> = {}
    for (const key of Object.keys(r.lambda).sort()) l[key] = r.lambda[key] as number
    sorted.lambda = l
  }
  if (r.level !== undefined) sorted.level = r.level
  if (r.score !== undefined) sorted.score = r.score
  return new TextEncoder().encode(JSON.stringify(sorted))
}

export function decodeReason(b: Uint8Array): ReasonPayload {
  return JSON.parse(new TextDecoder().decode(b)) as ReasonPayload
}

/** Unsealed fallback (S4 fails): plaintext, same fixed length, Console labels it "unsealed (demo)". */
export function plainSealed(payload: Uint8Array, officers: number): Hex {
  const p = pad(payload)
  const parts: Uint8Array[] = []
  for (let i = 0; i < officers; i++) parts.push(new Uint8Array(45), p, new Uint8Array(16))
  return bytesToHex(concat(parts))
}

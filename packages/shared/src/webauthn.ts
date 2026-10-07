// Passkey (P-256 / WebAuthn) signatures for user keys (docs/47 3.4, 10_interfaces.md passkey section).
// Pure functions only: usable in the browser, in Bun scripts and inside CRE workflows.
import { p256 } from '@noble/curves/nist.js'
import { sha256 } from '@noble/hashes/sha2.js'
import {
  type Address,
  bytesToHex,
  concat,
  encodeAbiParameters,
  type Hex,
  hexToBytes,
  keccak256,
  parseAbiParameters,
  stringToBytes,
  toHex,
} from 'viem'

export const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n

export type WebAuthnAuth = {
  authenticatorData: Hex
  clientDataJSON: string
  challengeIndex: bigint
  typeIndex: bigint
  r: Hex
  s: Hex
  qx: Hex
  qy: Hex
}

const AUTH_ABI = parseAbiParameters(
  '(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, bytes32 r, bytes32 s, bytes32 qx, bytes32 qy)',
)

/** Same formula as WebAuthn.keyIdOf: address(uint160(keccak256(abi.encode(qx, qy)))). */
export function p256KeyId(qx: Hex, qy: Hex): Address {
  return `0x${keccak256(encodeAbiParameters(parseAbiParameters('bytes32, bytes32'), [qx, qy])).slice(-40)}` as Address
}

export function encodeWebAuthnSig(a: WebAuthnAuth): Hex {
  return encodeAbiParameters(AUTH_ABI, [a])
}

/** The contract rejects s > N/2 (malleability); fold a high s. */
export function lowS(s: bigint): bigint {
  return s > P256_N / 2n ? P256_N - s : s
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
/** base64url without padding, exactly what WebAuthn puts in clientDataJSON.challenge. */
export function base64url(b: Uint8Array): string {
  let out = ''
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0)
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]!
    out += i + 1 < b.length ? B64URL[(n >> 6) & 63]! : ''
    out += i + 2 < b.length ? B64URL[n & 63]! : ''
  }
  return out
}

/** DER-encoded ECDSA signature (what navigator.credentials.get returns) to (r, s). */
export function derToRS(der: Uint8Array): { r: bigint; s: bigint } {
  if (der[0] !== 0x30) throw new Error('not a DER sequence')
  let i = 2
  const read = () => {
    if (der[i] !== 0x02) throw new Error('not a DER integer')
    const len = der[i + 1]!
    const v = der.slice(i + 2, i + 2 + len)
    i += 2 + len
    return BigInt(bytesToHex(v))
  }
  return { r: read(), s: read() }
}

/** clientDataJSON for a challenge, plus the offsets the contract checks. */
export function clientDataFor(challenge: Hex, origin: string) {
  const json = `{"type":"webauthn.get","challenge":"${base64url(hexToBytes(challenge))}","origin":"${origin}","crossOrigin":false}`
  return { json, challengeIndex: BigInt(json.indexOf('"challenge"')), typeIndex: BigInt(json.indexOf('"type"')) }
}

const b32 = (x: bigint) => toHex(x, { size: 32 })

/** Software passkey for tests, demos and the E2E: signs exactly like a platform authenticator would. */
export function softwarePasskey(priv: Uint8Array, origin = 'https://exchange.example', rpId = 'exchange.example') {
  const pub = p256.getPublicKey(priv, false)
  const qx = bytesToHex(pub.slice(1, 33))
  const qy = bytesToHex(pub.slice(33))
  const keyId = p256KeyId(qx, qy)
  // rpIdHash(32) || flags(1: UP + UV) || signCount(4)
  const authenticatorData = concat([sha256(stringToBytes(rpId)), new Uint8Array([0x05, 0, 0, 0, 1])])
  return {
    qx,
    qy,
    keyId,
    sign(challenge: Hex): Hex {
      const { json, challengeIndex, typeIndex } = clientDataFor(challenge, origin)
      const h = sha256(concat([authenticatorData, sha256(stringToBytes(json))]))
      const sig = p256.Signature.fromBytes(p256.sign(h, priv, { prehash: false }))
      return encodeWebAuthnSig({
        authenticatorData: bytesToHex(authenticatorData),
        clientDataJSON: json,
        challengeIndex,
        typeIndex,
        r: b32(sig.r),
        s: b32(lowS(sig.s)),
        qx,
        qy,
      })
    },
  }
}

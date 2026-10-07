'use client'
// Browser passkey (WebAuthn) as the user's signing key (docs/47 3.4). The contract path is covered by tests with
// a software authenticator; this browser glue is not exercised by automated tests.
import { derToRS, encodeWebAuthnSig, lowS, p256KeyId } from '@quorum/shared'
import { type Address, bytesToHex, type Hex, hexToBytes, toHex } from 'viem'

export type Passkey = { credentialId: Hex; qx: Hex; qy: Hex; keyId: Address }
const STORE = 'quorum.passkey'

export function loadPasskey(): Passkey | undefined {
  try {
    const s = localStorage.getItem(STORE)
    return s ? (JSON.parse(s) as Passkey) : undefined
  } catch {
    return undefined
  }
}

export async function createPasskey(userId: string): Promise<Passkey> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Exchange Wallet', id: location.hostname },
      user: { id: new TextEncoder().encode(userId), name: userId, displayName: userId },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256 = P-256
      authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('No passkey created')
  const spki = (cred.response as AuthenticatorAttestationResponse).getPublicKey()
  if (!spki) throw new Error('Authenticator did not return a public key')
  const raw = new Uint8Array(spki).slice(-64) // P-256 SPKI ends with 0x04 || x || y
  const qx = bytesToHex(raw.slice(0, 32))
  const qy = bytesToHex(raw.slice(32))
  const pk: Passkey = { credentialId: bytesToHex(new Uint8Array(cred.rawId)), qx, qy, keyId: p256KeyId(qx, qy) }
  try {
    localStorage.setItem(STORE, JSON.stringify(pk))
  } catch {}
  return pk
}

/** Signs a 32-byte digest (KeyBinding or Withdrawal) the way the contracts verify it. */
export async function passkeySign(pk: Passkey, challenge: Hex): Promise<Hex> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: hexToBytes(challenge) as BufferSource,
      allowCredentials: [{ type: 'public-key', id: hexToBytes(pk.credentialId) as BufferSource }],
      userVerification: 'required',
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('Passkey signing cancelled')
  const a = cred.response as AuthenticatorAssertionResponse
  const clientDataJSON = new TextDecoder().decode(a.clientDataJSON)
  const { r, s } = derToRS(new Uint8Array(a.signature))
  return encodeWebAuthnSig({
    authenticatorData: bytesToHex(new Uint8Array(a.authenticatorData)),
    clientDataJSON,
    challengeIndex: BigInt(clientDataJSON.indexOf('"challenge"')),
    typeIndex: BigInt(clientDataJSON.indexOf('"type"')),
    r: toHex(r, { size: 32 }),
    s: toHex(lowS(s), { size: 32 }),
    qx: pk.qx,
    qy: pk.qy,
  })
}

import { describe, expect, test } from 'bun:test'
import { decodeAbiParameters, hexToBytes, keccak256, parseAbiParameters, toBytes, toHex } from 'viem'
import { base64url, P256_N, p256KeyId, softwarePasskey } from '../src/index'
import { VECTORS } from './vectors'

const AUTH = parseAbiParameters(
  '(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, bytes32 r, bytes32 s, bytes32 qx, bytes32 qy)',
)

describe('passkey (docs/47 3.4)', () => {
  test('p256 key id equals forge (docs/47 3.4)', () => {
    expect(p256KeyId(toHex(1n, { size: 32 }), toHex(2n, { size: 32 }))).toBe(VECTORS.p256KeyId)
  })

  test('base64url has no padding and uses the URL alphabet', () => {
    expect(base64url(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe('-_-_')
    expect(base64url(new Uint8Array([1]))).toBe('AQ')
    expect(base64url(new Uint8Array(32)).length).toBe(43)
  })

  test('software passkey blob round-trips the Auth layout', () => {
    const pk = softwarePasskey(hexToBytes(keccak256(toBytes('passkey-seed'))))
    const challenge = keccak256(toBytes('challenge'))
    const [a] = decodeAbiParameters(AUTH, pk.sign(challenge))
    expect(a.qx).toBe(pk.qx)
    expect(a.qy).toBe(pk.qy)
    expect(p256KeyId(a.qx, a.qy)).toBe(pk.keyId)
    expect(a.clientDataJSON.slice(Number(a.typeIndex), Number(a.typeIndex) + 21)).toBe('"type":"webauthn.get"')
    expect(a.clientDataJSON.slice(Number(a.challengeIndex))).toStartWith(
      `"challenge":"${base64url(hexToBytes(challenge))}"`,
    )
    expect(BigInt(a.s) <= P256_N / 2n).toBe(true)
    expect(hexToBytes(a.authenticatorData).length).toBe(37)
  })
})

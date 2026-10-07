// Hot wallet key encryption at rest. The key sits in this service's env, so a compromised
// backend can decrypt every EOA key; that is the threat model, not a bug.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { type Hex, hexToBytes, toHex } from 'viem'

export function encryptKey(encKey: Hex, plain: Hex): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', hexToBytes(encKey), iv)
  const ct = Buffer.concat([c.update(hexToBytes(plain)), c.final()])
  return toHex(Buffer.concat([iv, c.getAuthTag(), ct]))
}

export function decryptKey(encKey: Hex, blob: string): Hex {
  const b = Buffer.from(hexToBytes(blob as Hex))
  const d = createDecipheriv('aes-256-gcm', hexToBytes(encKey), b.subarray(0, 12))
  d.setAuthTag(b.subarray(12, 28))
  return toHex(Buffer.concat([d.update(b.subarray(28)), d.final()]))
}

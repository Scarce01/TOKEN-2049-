import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BANNED = [
  'secrets/decoys',
  'decoys.local',
  'quorum_index',
  'DECOY_TAGS',
  'config.staging',
  'isDecoy',
  'honeypot',
  'securityLabel',
  'decoy',
  'trap',
  '0x1eb2e8f1dc30b6ba1166331cdcb0608a267ff711',
]

function files(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (name.endsWith('.ts')) out.push(path)
  }
  return out
}

describe('scanner sources', () => {
  test('do not name hidden metadata or the known wallet', () => {
    const src = join(import.meta.dir, '..', 'src')
    const hits: string[] = []
    for (const path of files(src)) {
      const text = readFileSync(path, 'utf8').toLowerCase()
      for (const word of BANNED) {
        if (text.includes(word.toLowerCase())) hits.push(`${path} contains ${word}`)
      }
    }
    expect(hits).toEqual([])
  })
})

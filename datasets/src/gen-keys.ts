// Step 3: dev keys for every account. Ordinary accounts -> secrets/dev-users.local.json;
// decoy accounts -> secrets/decoys.local.json (written by decoy-admin, keys filled in here).
// Every account gets a key: an unregistered account would let the backend register its own key
// first, and a decoy without a key would stand out.
import { join } from 'node:path'
import { readJson, repoRoot, secretsDir, writeJson } from '@quorum/offchain'
import type { Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { Account } from './types'

export type DevUser = { userId: string; privateKey: Hex; address: Hex }
export type DecoyFile = Record<
  string,
  {
    accounts: { userId: string; userIdHash?: Hex; privateKey?: Hex; address?: Hex }[]
    wallets: { label: string; address: Hex; privateKey: Hex; floorWei: string; funded: boolean }[]
    addresses: { label: string; address: Hex; privateKey: Hex }[]
  }
>

const org = ((process.argv.includes('--org') ? process.argv[process.argv.indexOf('--org') + 1] : undefined) ?? 'a') as
  | 'a'
  | 'b'
const accounts = readJson<Account[]>(join(repoRoot, 'datasets', 'out', `all-accounts-${org}.json`))
const devPath = join(secretsDir, 'dev-users.local.json')
const decoyPath = join(secretsDir, 'decoys.local.json')
const dev = readJson<Record<string, DevUser[]>>(devPath, {})
const decoys = readJson<DecoyFile>(decoyPath, {})
const decoyIds = new Set((decoys[org]?.accounts ?? []).map((d) => d.userId))

const existing = new Map((dev[org] ?? []).map((u) => [u.userId, u]))
const out: DevUser[] = []
for (const a of accounts) {
  if (decoyIds.has(a.userId)) {
    const d = decoys[org]!.accounts.find((x) => x.userId === a.userId)!
    if (!d.privateKey) {
      d.privateKey = generatePrivateKey()
      d.address = privateKeyToAccount(d.privateKey).address
    }
    continue
  }
  const pk = existing.get(a.userId)?.privateKey ?? generatePrivateKey()
  out.push({ userId: a.userId, privateKey: pk, address: privateKeyToAccount(pk).address })
}
dev[org] = out
writeJson(devPath, dev)
writeJson(decoyPath, decoys)
console.log(`keys: ${out.length} ordinary, ${decoyIds.size} decoy (org ${org})`)

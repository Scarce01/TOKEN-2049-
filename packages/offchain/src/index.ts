// Off-chain helpers shared by datasets, decoy-admin, trap-sync, sim-runner, scripts.
// Never imported by workflows (uses fs, env, node crypto).
import { createCipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { type Deployment, loadDeployment, repoRoot } from '@quorum/shared/deployments'
import postgres from 'postgres'
import {
  type Account,
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  type Hex,
  hexToBytes,
  http,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia, foundry, sepolia } from 'viem/chains'

export { repoRoot, loadDeployment, type Deployment }

export function need(k: string): string {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

export function chainOf(d: Deployment): Chain {
  if (d.chainId === 31337) return foundry
  if (d.chainId === 11155111) return sepolia
  return baseSepolia
}

export function clients(d: Deployment, pk?: Hex) {
  const chain = chainOf(d)
  const transport = http(
    process.env.RPC_URL ??
      (d.chainId === 31337
        ? 'http://127.0.0.1:8545'
        : d.chainId === 11155111
          ? 'https://ethereum-sepolia-rpc.publicnode.com'
          : 'https://sepolia.base.org'),
  )
  const pub = createPublicClient({ chain, transport })
  const account: Account | undefined = pk ? privateKeyToAccount(pk) : undefined
  const wallet = account ? createWalletClient({ chain, account, transport }) : undefined
  return { pub, wallet, account }
}

/** Send a contract write and wait; throws on revert. */
export async function send(
  c: ReturnType<typeof clients>,
  // biome-ignore lint/suspicious/noExplicitAny: abi union
  args: { address: Address; abi: any; functionName: string; args?: readonly unknown[]; value?: bigint },
): Promise<Hex> {
  if (!c.wallet || !c.account) throw new Error('no wallet')
  const { request } = await c.pub.simulateContract({ account: c.account, ...args })
  const hash = await c.wallet.writeContract(request)
  const rc = await c.pub.waitForTransactionReceipt({ hash })
  if (rc.status !== 'success') throw new Error(`reverted ${hash}`)
  return hash
}

export function db(url = need('DATABASE_URL')) {
  return postgres(url, { max: 4, onnotice: () => {} })
}

export const secretsDir = join(repoRoot, 'secrets')

export function readJson<T>(path: string, fallback?: T): T {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback
    throw new Error(`missing ${path}`)
  }
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export function writeJson(path: string, v: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2)}\n`)
}

/** Hot wallet key encryption, same format exchange-api decrypts (iv | tag | ct). */
export function encryptKey(encKey: Hex, plain: Hex): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', hexToBytes(encKey), iv)
  const ct = Buffer.concat([c.update(hexToBytes(plain)), c.final()])
  return toHex(Buffer.concat([iv, c.getAuthTag(), ct]))
}

/** Deterministic PRNG (mulberry32) so synthetic datasets are reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const normal = () => {
    const u = Math.max(next(), 1e-12)
    const v = next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  return { next, normal, lognormal: (mu: number, sigma: number) => Math.exp(mu + sigma * normal()) }
}

export function shuffle<T>(xs: T[], r: () => number): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j] as T, a[i] as T]
  }
  return a
}

export async function insertMetric(
  sql: ReturnType<typeof db>,
  m: {
    runId: string
    name: string
    value: number
    unit?: string
    source: 'testnet_measured' | 'public_onchain' | 'assumed'
    notes?: string
  },
) {
  await sql`insert into quorum_index.metrics (run_id, name, value, unit, source, notes)
            values (${m.runId}, ${m.name}, ${m.value}, ${m.unit ?? null}, ${m.source}, ${m.notes ?? null})`
}

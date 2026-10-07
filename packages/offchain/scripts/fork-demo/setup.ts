// One-time setup of the local Base Sepolia fork for the live red-team demo (bridge.ts).
// Needs: anvil fork on 8545 with deployments/base-sepolia-fork.json, exchange db (scripts/round3-pg.ts) on 54329.
// Usage (repo root): bun packages/offchain/scripts/fork-demo/setup.ts
//
// Defender side only. Writes the decoy to gitignored places (secrets/, workflows/trap/config.staging.json),
// never to stdout (rule 2). The decoy root goes on chain through the real path: two officer signatures,
// ConfigTimelock.queue, wait configDelay (anvil time travel), execute.
// The fork is shared: the time travel (+configDelay) makes in-flight CRE reports stale (Receiver emits
// ActionStale), so do not run this while someone else runs an E2E on the same fork.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildTree,
  ConfigTimelockAbi,
  DecoyCommitAbi,
  decoyLeaf,
  decoySalt,
  FaucetAbi,
  OfficerKind,
  OfficerSetAbi,
  ORGS,
} from '@quorum/shared'
import postgres from 'postgres'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  erc20Abi,
  type Hex,
  hexToBytes,
  http,
  pad,
  parseAbiParameters,
  parseEther,
  toFunctionSelector,
  toHex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { encryptKey, readJson, repoRoot, secretsDir, writeJson } from '../../src/index'

export const RPC = 'http://127.0.0.1:8545'
export const DB_URL = 'postgres://exchange_a_app:exchange_a_local@127.0.0.1:54329/postgres'
export const statePath = join(secretsDir, 'fork-demo.local.json')
export const snapPath = join(repoRoot, '.tmp', 'fork-snapshot.json')

export const d = JSON.parse(readFileSync(join(repoRoot, 'deployments', 'base-sepolia-fork.json'), 'utf8'))
export const keys = readJson<{ keys: Record<string, { privateKey: Hex; address: Address }> }>(
  join(secretsDir, 'base-sepolia-keys.local.json'),
).keys
export const chain = defineChain({
  id: 84532,
  name: 'base-sepolia-fork',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
})
export const pub = createPublicClient({ chain, transport: http(RPC) })
export const walletOf = (pk: Hex) =>
  createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(pk) })

export async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = (await res.json()) as { result?: T; error?: { message: string } }
  if (body.error) throw new Error(`${method}: ${body.error.message}`)
  return body.result as T
}

export type DemoState = {
  encKey: Hex
  adminToken: string
  orgSalt: Hex
  attacker: { address: Address; privateKey: Hex }
  wallets: { label: string; address: Address; privateKey: Hex; amount: string; decoy?: true }[]
  /** Merkle proof of the decoy wallet, and the DecoyCommit it was committed to. decoy-admin `configs`
   * merges it back into the generated trap config on the fork (the filler leaves are random). */
  proof?: { i: number; path: Hex[]; decoyCommit: Address; root: Hex }
}

/** QUORUM_K as the trap workflow sees it (workflows/.env), so the on-chain leaf matches the workflow's salt. */
function workflowK(): Uint8Array {
  const line = readFileSync(join(repoRoot, 'workflows', '.env'), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('QUORUM_K='))
  const k = line?.slice('QUORUM_K='.length).trim()
  if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error('workflows/.env has no 32-byte QUORUM_K')
  return hexToBytes(k as Hex)
}

const PREFIXES = ['hot-legacy', 'hot-reserve', 'ops-sweeper']
const N = 10

function freshState(): DemoState {
  const labels = new Set<string>()
  while (labels.size < N) {
    const p = PREFIXES[Math.floor(Math.random() * PREFIXES.length)]
    labels.add(`${p}-${String(10 + Math.floor(Math.random() * 90)).padStart(2, '0')}`)
  }
  // Distinct random balances 20..95 qUSD. The decoy takes a random rank in the top 3; only this file knows it.
  const amounts = new Set<number>()
  while (amounts.size < N) amounts.add(20 + Math.floor(Math.random() * 76))
  const sorted = [...amounts].sort((a, b) => b - a)
  const decoyRank = Math.floor(Math.random() * 3)
  const wallets = [...labels].map((label, i) => {
    const privateKey = generatePrivateKey()
    return {
      label,
      address: privateKeyToAccount(privateKey).address,
      privateKey,
      amount: (BigInt(sorted[i]!) * 1_000_000n).toString(),
      ...(i === decoyRank ? { decoy: true as const } : {}),
    }
  })
  const attackerPk = generatePrivateKey()
  return {
    encKey: generatePrivateKey(),
    adminToken: toHex(crypto.getRandomValues(new Uint8Array(16))).slice(2),
    orgSalt: generatePrivateKey(),
    attacker: { address: privateKeyToAccount(attackerPk).address, privateKey: attackerPk },
    wallets,
  }
}

async function fund(s: DemoState) {
  const deployer = walletOf(keys.DEPLOYER!.privateKey)
  for (const w of [...s.wallets.map((x) => x.address), s.attacker.address]) {
    await rpc('anvil_setBalance', [w, toHex(parseEther('0.05'))])
  }
  for (const w of s.wallets) {
    const want = BigInt(w.amount)
    const have = await pub.readContract({
      address: d.qUSD,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [w.address],
    })
    if (have >= want) continue
    const hash = await deployer.writeContract({
      address: d.faucet,
      abi: FaucetAbi,
      functionName: 'drip',
      args: [d.qUSD, w.address, want - have],
    })
    await pub.waitForTransactionReceipt({ hash })
  }
}

async function seedDb(s: DemoState) {
  const sql = postgres(DB_URL, { max: 2, onnotice: () => {} })
  await sql`delete from exchange_a.hot_wallets`
  for (const w of s.wallets) {
    await sql`insert into exchange_a.hot_wallets (label, chain, address, kind, private_key_enc)
              values (${w.label}, 'base-sepolia', ${w.address}, 'eoa', ${encryptKey(s.encKey, w.privateKey)})`
  }
  await sql.end()
}

/** New decoy root for org A through ConfigTimelock: 2 officer signatures, queue, wait, execute. */
async function commitDecoy(s: DemoState): Promise<{ i: number; path: Hex[] }> {
  const decoy = s.wallets.find((w) => w.decoy)!
  const k = workflowK()
  const ident = pad(decoy.address, { size: 32 })
  // a saved proof that still verifies on this DecoyCommit: no new commit, no time travel
  if (s.proof && s.proof.decoyCommit.toLowerCase() === d.decoyCommit.toLowerCase()) {
    const still = await pub.readContract({
      address: d.decoyCommit,
      abi: DecoyCommitAbi,
      functionName: 'verify',
      args: [ORGS.a, BigInt(d.chainId), ident, decoySalt(k, s.proof.i), s.proof.path],
    })
    if (still) return { i: s.proof.i, path: s.proof.path }
  }
  const size = 16
  const leaves: Hex[] = [decoyLeaf(d.chainId, pad(decoy.address, { size: 32 }), decoySalt(k, 0))]
  while (leaves.length < size) leaves.push(generatePrivateKey())
  const tree = buildTree(leaves)
  const proof = { i: 0, path: tree.proofs[0]! }

  const [root] = (await pub.readContract({
    address: d.decoyCommit,
    abi: DecoyCommitAbi,
    functionName: 'rootOf',
    args: [ORGS.a],
  })) as [Hex, bigint]
  if (root === tree.root) throw new Error('root set but proof fails')

  const args = encodeAbiParameters(parseAbiParameters('bytes32, bytes32, uint256'), [ORGS.a, tree.root, BigInt(size)])
  const selector = toFunctionSelector('setRoot(bytes32,bytes32,uint256)')
  const subject = (await pub.readContract({
    address: d.configTimelock,
    abi: ConfigTimelockAbi,
    functionName: 'subjectOf',
    args: [d.decoyCommit, selector, args],
  })) as Hex
  const block = await pub.getBlock()
  const deadline = block.timestamp + 3600n
  const nonce = BigInt(Date.now())
  const digest = (await pub.readContract({
    address: d.configTimelock,
    abi: ConfigTimelockAbi,
    functionName: 'officerDigest',
    args: [OfficerKind.CONFIG, subject, 0n, nonce, deadline],
  })) as Hex
  const threshold = Number(
    await pub.readContract({ address: d.officerSet, abi: OfficerSetAbi, functionName: 'threshold' }),
  )
  const officers = ['OFFICER_1', 'OFFICER_2', 'OFFICER_3']
    .map((n) => privateKeyToAccount(keys[n]!.privateKey))
    .sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1))
    .slice(0, threshold)
  const sigs = await Promise.all(officers.map((o) => o.sign({ hash: digest })))
  const deployer = walletOf(keys.DEPLOYER!.privateKey)
  const q = await deployer.writeContract({
    address: d.configTimelock,
    abi: ConfigTimelockAbi,
    functionName: 'queue',
    args: [d.decoyCommit, selector, args, nonce, deadline, sigs],
  })
  const qr = await pub.waitForTransactionReceipt({ hash: q })
  if (qr.status !== 'success') throw new Error(`queue reverted ${q}`)
  const id = qr.logs.find((l) => l.address.toLowerCase() === d.configTimelock.toLowerCase())?.topics[1] as Hex
  const delay = (await pub.readContract({
    address: d.configTimelock,
    abi: ConfigTimelockAbi,
    functionName: 'configDelay',
  })) as bigint
  await rpc('evm_increaseTime', [Number(delay) + 1])
  await rpc('evm_mine')
  const x = await deployer.writeContract({
    address: d.configTimelock,
    abi: ConfigTimelockAbi,
    functionName: 'execute',
    args: [id],
  })
  if ((await pub.waitForTransactionReceipt({ hash: x })).status !== 'success') throw new Error(`execute reverted ${x}`)
  console.log(`decoy root set via ConfigTimelock (queue ${q.slice(0, 10)}, execute ${x.slice(0, 10)})`)
  s.proof = { ...proof, decoyCommit: d.decoyCommit, root: tree.root }
  writeJson(statePath, s)
  return proof
}

function writeConfigs(s: DemoState, proof: { i: number; path: Hex[] }) {
  const decoy = s.wallets.find((w) => w.decoy)!
  const trapPath = join(repoRoot, 'workflows', 'trap', 'config.staging.json')
  const trap = JSON.parse(readFileSync(trapPath, 'utf8'))
  if (trap.chainId !== d.chainId) throw new Error('trap config.staging.json is not the fork config')
  trap.decoyWallets = [{ address: decoy.address, orgId: ORGS.a, i: proof.i, path: proof.path }]
  trap.nownodesRpcUrl = ''
  writeFileSync(trapPath, `${JSON.stringify(trap, null, 2)}\n`)
  writeFileSync(
    join(repoRoot, 'apps', 'exchange-api', '.env.fork'),
    [
      'ORG=a',
      'PORT=8797',
      `DATABASE_URL=${DB_URL}`,
      `RPC_URL=${RPC}`,
      'DEPLOY_NAME=base-sepolia-fork',
      `SUBMITTER_PRIVATE_KEY=${keys.SUBMITTER_A!.privateKey}`,
      `ORG_SALT=${s.orgSalt}`,
      `ADMIN_TOKEN=${s.adminToken}`,
      `HOT_WALLET_ENC_KEY=${s.encKey}`,
      'NO_WORKERS=1',
      '',
    ].join('\n'),
  )
}

if (import.meta.main) {
  const s = readJson<DemoState>(statePath, freshState())
  writeJson(statePath, s)
  await fund(s)
  await seedDb(s)
  const proof = await commitDecoy(s)
  writeConfigs(s, proof)
  const id = await rpc<Hex>('evm_snapshot')
  writeJson(snapPath, { id })
  console.log(`fork demo ready: ${s.wallets.length} hot wallets, snapshot ${id}`)
}

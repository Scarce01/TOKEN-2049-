// Tracing end to end on the simulation chain (local anvil fork of Base Sepolia, CRE CLI simulate --broadcast):
// decoy hit -> Trap freeze + root THREAT -> attacker launders -> Trek (off chain) proposes edges -> CRE verify-edge
// (patrol trigger 5) re-reads every transfer and writes derived THREATs -> a payout to a traced address is PENDING.
// Defender data (the decoy) is read only after the probes and is never printed (rule 2).
// Needs: anvil fork on 8545 with deployments/base-sepolia-fork.json, fork-demo setup.ts done, exchange-api-fork on 8797.
// Usage (repo root): bun services/redteam/demo/trace-fork.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { evidenceHash, ORGS, ThreatRegistryAbi } from '@quorum/shared'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  erc20Abi,
  type Hex,
  http,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { probeTransfer } from '../src/attack'
import { rankWallets } from '../src/rank'
import { fetchHotWallets } from '../src/scanner'

const root = join(import.meta.dir, '..', '..', '..')
const RPC = 'http://127.0.0.1:8545'
const API = 'http://127.0.0.1:8797'
const OUT = join(root, '.tmp', 'trace-fork')
const d = JSON.parse(readFileSync(join(root, 'deployments', 'base-sepolia-fork.json'), 'utf8'))
const ADMIN = readFileSync(join(root, 'apps', 'exchange-api', '.env.fork'), 'utf8')
  .match(/^ADMIN_TOKEN=(.*)$/m)?.[1]
  ?.trim()
if (!ADMIN) throw new Error('apps/exchange-api/.env.fork has no ADMIN_TOKEN (run fork-demo setup.ts)')
const chain = defineChain({
  id: 84532,
  name: 'base-sepolia-fork',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
})
const pub = createPublicClient({ chain, transport: http(RPC) })
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const ONE = 1_000_000n
const results: { step: string; ok: boolean; detail: string }[] = []
function check(step: string, ok: boolean, detail = '') {
  results.push({ step, ok, detail })
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? `  (${detail})` : ''}`)
}
async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const j = (await r.json()) as { result?: T; error?: unknown }
  if (j.error) throw new Error(`${method} ${JSON.stringify(j.error)}`)
  return j.result as T
}
// The fork is shared: another session's patrol broadcasts with the same CRE key every 60 s. A CLI run that never
// reaches a simulation result is an infrastructure failure, retried once; workflow outcomes are never retried.
const creFailures: string[] = []
function cre(args: string[]): { out: string; wallMs: number } {
  const t0 = performance.now()
  let out = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    const p = Bun.spawnSync(
      ['cre', 'workflow', 'simulate', ...args, '-T', 'fork-settings', '--non-interactive', '--broadcast'],
      { cwd: join(root, 'workflows'), stdout: 'pipe', stderr: 'pipe' },
    )
    out = p.stdout.toString() + p.stderr.toString()
    // keep the full CLI output for diagnosis (gitignored .tmp/; CRE logs carry tags and case ids only)
    mkdirSync(OUT, { recursive: true })
    writeFileSync(join(OUT, `cre-${args[0]?.replace('./', '')}-${Date.now()}-try${attempt}.log`), out)
    if (out.includes('Workflow Simulation Result')) break
    const why = (out.match(/(✗[^\n]*|error[^\n]*)/i)?.[1] ?? `exit ${p.exitCode}, no simulation result`).slice(0, 160)
    creFailures.push(`${args[0]} try ${attempt}: ${why}`)
    console.log(
      `      ! CRE CLI did not reach a simulation result (${why}); ${attempt === 1 ? 'retrying once' : 'giving up'}`,
    )
  }
  return { out, wallMs: performance.now() - t0 }
}
const userLog = (out: string) =>
  out
    .split('\n')
    .filter((l) => l.includes('[USER LOG]'))
    .map((l) => `      | ${l.replace(/.*\[USER LOG\] /, '').replace(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g, '0x[addr]')}`)
    .join('\n')
const blockTime = async (tx: Hex) =>
  (await pub.getBlock({ blockNumber: (await pub.getTransactionReceipt({ hash: tx })).blockNumber })).timestamp

// ---------------------------------------------------------------- 0. guards: local fork only
const client = await rpc<string>('web3_clientVersion')
if (!client.toLowerCase().startsWith('anvil')) throw new Error(`refusing: ${RPC} is not a local anvil (${client})`)
if ((await pub.getChainId()) !== 84532 || d.mode !== 'SIM')
  throw new Error('deployment is not the SIM fork of Base Sepolia')
const trapCfg = JSON.parse(readFileSync(join(root, 'workflows', 'trap', 'config.staging.json'), 'utf8'))
const patrolCfg = JSON.parse(readFileSync(join(root, 'workflows', 'patrol', 'config.staging.json'), 'utf8'))
if (trapCfg.chainId !== 84532 || !trapCfg.decoyWallets?.length)
  throw new Error('trap config has no fork decoy (run setup.ts)')
if (!patrolCfg.verifyEdge) throw new Error('patrol config has no verifyEdge (run decoy-admin configs)')

const isSuspect = (a: Address) =>
  pub.readContract({ address: d.threatRegistry, abi: ThreatRegistryAbi, functionName: 'isSuspect', args: [a] })
const entryOf = (a: Address) =>
  pub.readContract({
    address: d.threatRegistry,
    abi: ThreatRegistryAbi,
    functionName: 'entryOf',
    args: [a],
  }) as Promise<{
    count: number | bigint
    derived: boolean
    expiresAt: bigint
  }>

// ---------------------------------------------------------------- 1. attacker: scan, rank, probe top 3
const keys = { R: generatePrivateKey(), H1: generatePrivateKey(), H2: generatePrivateKey() }
const acct = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, privateKeyToAccount(v)])) as Record<
  'R' | 'H1' | 'H2',
  ReturnType<typeof privateKeyToAccount>
>
for (const a of Object.values(acct)) await rpc('anvil_setBalance', [a.address, '0x16345785D8A0000']) // 0.1 ETH gas
console.log('\n=== 1 attacker probes the compromised exchange')
const ranked = rankWallets(await fetchHotWallets(API, ADMIN))
const probes: { tx: Hex; from: string }[] = []
for (const row of ranked.slice(0, 3))
  probes.push({ tx: (await probeTransfer(API, ADMIN, row.address, acct.R.address)) as Hex, from: row.address })
console.log(`    scanned ${ranked.length} wallets, 3 probes of 1 qUSD to receiver ${short(acct.R.address)}`)

// ---------------------------------------------------------------- 2. defender: Trap on the probe that hit a decoy
console.log('\n=== 2 CRE Trap (decoy touched)')
const decoys = new Set((trapCfg.decoyWallets as { address: string }[]).map((w) => w.address.toLowerCase()))
const hit = probes.find((p) => decoys.has(p.from.toLowerCase()))
if (!hit) throw new Error('no probe touched a decoy: the ranking did not reach it')
const hitRc = await pub.getTransactionReceipt({ hash: hit.tx })
const hitLog = hitRc.logs.find((l) => {
  try {
    return decodeEventLog({ abi: erc20Abi, data: l.data, topics: l.topics }).eventName === 'Transfer'
  } catch {
    return false
  }
})!
const trap = cre([
  './trap',
  '--trigger-index',
  '0',
  '--evm-tx-hash',
  hit.tx,
  '--evm-event-index',
  String(hitLog.logIndex),
])
console.log(userLog(trap.out))
const trapTx = trap.out.match(/report ok tx=(0x[0-9a-fA-F]{64})/)?.[1] as Hex | undefined
const rootEv = evidenceHash(84532, hit.tx, hitLog.logIndex)
check('Trap tripped and wrote its report', !!trapTx && /trap A tripped/.test(trap.out))
check(
  'receiver listed as a confirmed (root) suspect',
  (await isSuspect(acct.R.address)) && !(await entryOf(acct.R.address)).derived,
)
const freezeS = trapTx ? Number((await blockTime(trapTx)) - (await blockTime(hit.tx))) : -1

// ---------------------------------------------------------------- 3. attacker launders R -> H1 -> H2
console.log('\n=== 3 attacker moves the money on')
const w = (pk: Hex) => createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(pk) })
async function pay(fromPk: Hex, to: Address, amount: bigint): Promise<Hex> {
  const h = await w(fromPk).writeContract({
    address: d.qUSD,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to, amount],
  })
  if ((await pub.waitForTransactionReceipt({ hash: h })).status !== 'success') throw new Error(`transfer reverted ${h}`)
  return h
}
const t1 = await pay(keys.R, acct.H1.address, 3n * ONE)
const t2 = await pay(keys.H1, acct.H2.address, 2n * ONE)
console.log(`    receiver -> hop1 ${short(acct.H1.address)} 3 qUSD, hop1 -> hop2 ${short(acct.H2.address)} 2 qUSD`)
for (let i = 0; i < 6; i++) await rpc('evm_mine') // let both transfers settle below the workflow's anchor (latest - 5)

// ---------------------------------------------------------------- 4. Trek (untrusted, off chain) proposes edges
console.log('\n=== 4 Trek follows the money (fork source)')
mkdirSync(OUT, { recursive: true })
const propsPath = join(OUT, 'proposals.jsonl')
const t = Bun.spawnSync(
  [
    'python',
    join(root, 'analysis', 'trace_bybit', 'fork_source.py'),
    '--deployment',
    join(root, 'deployments', 'base-sepolia-fork.json'),
    '--seed',
    acct.R.address,
    '--trigger-evidence',
    rootEv,
    '--from-block',
    String(hitRc.blockNumber),
    '--out',
    propsPath,
  ],
  { cwd: join(root, 'analysis', 'trace_bybit'), stdout: 'pipe', stderr: 'pipe' },
)
console.log(`    ${t.stderr.toString().trim().split('\n').pop()}`)
type Prop = {
  kind: string
  action: string
  hop: number
  taintedIn: string
  edge: { parent: string; child: string; txHash: string; logIndex: number; asset: string; amount: string }
  threat: { parentEvidence: string }
}
const props = readFileSync(propsPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Prop)
for (const p of props) console.log(`    proposal hop ${p.hop} ${p.action} ${short(p.edge.child)} taint ${p.taintedIn}`)
const tokenOf: Record<string, string> = { qUSD: d.qUSD, qETH: d.qETH }
const toEdge = (p: Prop) => ({
  parent: p.edge.parent,
  child: p.edge.child,
  txHash: p.edge.txHash,
  logIndex: p.edge.logIndex,
  token: tokenOf[p.edge.asset],
  amount: p.edge.amount,
  parentEvidence: p.threat.parentEvidence,
})
// only "delay" goes to CRE; parents before children (lower hop first, then larger amount), at most 12 per call
const delay = props
  .filter((p) => p.kind === 'edge' && p.action === 'delay')
  .sort((a, b) => a.hop - b.hop || (BigInt(b.taintedIn) > BigInt(a.taintedIn) ? 1 : -1))
  .slice(0, 12)
check(
  'Trek proposed hop1 and hop2 as "delay", naming the actual laundering transfers',
  delay.map((p) => p.edge.child).join() === [acct.H1.address, acct.H2.address].map((a) => a.toLowerCase()).join() &&
    delay.map((p) => p.edge.txHash).join() === [t1, t2].map((h) => h.toLowerCase()).join(),
)

// ---------------------------------------------------------------- 5. CRE verify-edge writes derived THREATs
console.log('\n=== 5 CRE verify-edge (patrol trigger 5)')
const payload = (edges: object[]) => {
  const p = join(OUT, `payload-${Date.now()}.json`)
  writeFileSync(p, JSON.stringify({ v: 1, orgId: ORGS.a, edges }))
  return p
}
const ve = cre(['./patrol', '--trigger-index', '5', '--http-payload', payload(delay.map(toEdge))])
console.log(userLog(ve.out))
const veTx = ve.out.match(/report ok tx=(0x[0-9a-fA-F]{64})/)?.[1] as Hex | undefined
check('verify-edge verified both edges', /verify-edge ok=2/.test(ve.out) && !!veTx)
const e1 = await entryOf(acct.H1.address)
const e2 = await entryOf(acct.H2.address)
check('hop1 listed as derived', (await isSuspect(acct.H1.address)) && e1.derived)
check('hop2 listed as derived', (await isSuspect(acct.H2.address)) && e2.derived)
const veRc = veTx ? await pub.getTransactionReceipt({ hash: veTx }) : undefined
const added = (veRc?.logs ?? []).flatMap((l) => {
  try {
    const e = decodeEventLog({ abi: ThreatRegistryAbi, data: l.data, topics: l.topics })
    return e.eventName === 'ThreatAdded' ? [e.args as { suspect: string; evidenceHash: Hex; parentEvidence: Hex }] : []
  } catch {
    return []
  }
})
const ev1 = evidenceHash(84532, delay[0]!.edge.txHash as Hex, delay[0]!.edge.logIndex) // hop1's own evidence
const byS = new Map(added.map((a) => [a.suspect.toLowerCase(), a]))
check(
  'evidence chain on chain: hop1 -> root, hop2 -> hop1',
  byS.get(acct.H1.address.toLowerCase())?.parentEvidence === rootEv &&
    byS.get(acct.H2.address.toLowerCase())?.parentEvidence === ev1,
)
const traceS = veTx ? Number((await blockTime(veTx)) - (await blockTime(t2))) : -1

// ---------------------------------------------------------------- 6. negatives: forged, innocent parent, replay
console.log('\n=== 6 verify-edge refuses what it cannot prove')
const clean = probes.find((p) => p !== hit)! // a real 1 qUSD transfer from a hot wallet that is NOT a suspect
const cleanRc = await pub.getTransactionReceipt({ hash: clean.tx })
const countBefore = BigInt(e1.count)
const forged = { ...toEdge(delay[1]!), amount: (BigInt(delay[1]!.edge.amount) + 1n).toString() }
const innocent = {
  parent: clean.from.toLowerCase(),
  child: acct.R.address.toLowerCase(),
  txHash: clean.tx,
  logIndex: cleanRc.logs[0]!.logIndex,
  token: d.qUSD,
  amount: ONE.toString(),
  parentEvidence: rootEv,
}
const neg = cre(['./patrol', '--trigger-index', '5', '--http-payload', payload([forged, innocent, toEdge(delay[0]!)])])
console.log(userLog(neg.out))
check(
  'forged amount and non-suspect parent rejected; replay re-verified',
  /amount-mismatch=1/.test(neg.out) && /parent-not-suspect=1/.test(neg.out) && /ok=1/.test(neg.out),
)
check('replay does not count twice', BigInt((await entryOf(acct.H1.address)).count) === countBefore)
check('the clean hot wallet was not listed', !(await isSuspect(clean.from as Address)))

// ---------------------------------------------------------------- 7. consequence: a payout to a traced address
console.log('\n=== 7 a user withdraws to the traced hop2 address')
const e = Bun.spawnSync(['bun', join(root, 'packages', 'offchain', 'scripts', 'e2e-prevention.ts')], {
  cwd: root,
  env: { ...process.env, E2E_CASES: 'T', TRACED_TO: acct.H2.address },
  stdout: 'pipe',
  stderr: 'pipe',
})
const eout = e.stdout.toString() + e.stderr.toString()
console.log(
  eout
    .split('\n')
    .filter((l) => /on-chain verdict|vault.execute|PASS|FAIL/.test(l))
    .map((l) => `  ${l}`)
    .join('\n'),
)
check(
  'payout to the traced address is PENDING and refused',
  /on-chain verdict: PENDING/.test(eout) && /\bPASS\b/.test(eout),
)

// ---------------------------------------------------------------- summary
const passed = results.filter((r) => r.ok).length
console.log(
  `\ntimings (fork, CRE CLI incl. compile): decoy probe -> freeze ${freezeS} s | last hop -> derived THREAT ${traceS} s`,
)
console.log(`CRE wall: trap ${(trap.wallMs / 1000).toFixed(1)} s, verify-edge ${(ve.wallMs / 1000).toFixed(1)} s`)
console.log(`CRE CLI infrastructure failures (retried): ${creFailures.length ? creFailures.join(' | ') : 'none'}`)
console.log(`\n${passed === results.length ? 'ALL PASS' : 'FAILURES'}: ${passed}/${results.length}`)
// scene result for verify:design (D113): no addresses, no decoy, only steps and timings
mkdirSync(join(root, 'reports', 'scenes'), { recursive: true })
writeFileSync(
  join(root, 'reports', 'scenes', 'fork_trace_e2e.json'),
  `${JSON.stringify(
    {
      ok: passed === results.length,
      summary: `${passed}/${results.length} steps (local anvil fork of Base Sepolia, CRE CLI simulate --broadcast)`,
      source: 'testnet fork (local)',
      timings: {
        decoyToFreezeS: freezeS,
        lastHopToDerivedThreatS: traceS,
        trapWallS: trap.wallMs / 1000,
        verifyEdgeWallS: ve.wallMs / 1000,
      },
      results: results.map(({ step, ok }) => ({ step, ok })),
    },
    null,
    2,
  )}\n`,
)
if (passed !== results.length) process.exit(1)

// Transaction history of the Qu3ee Guard program on devnet, for the evidence page.
// Usage (repo root): bun solana/scripts/history.ts   -> demo/solana-history.json
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Connection } from '@solana/web3.js'
import { ERR, PROGRAM_ID, ROOT } from './lib'

const rpc = readFileSync(join(ROOT, 'secrets', 'solana', 'rpc.env'), 'utf8').match(/^SOLANA_RPC_URL=(.+)$/m)?.[1]?.trim()
if (!rpc) throw new Error('SOLANA_RPC_URL missing in secrets/solana/rpc.env')
const conn = new Connection(rpc, 'confirmed')
const run = JSON.parse(readFileSync(join(ROOT, 'demo', 'solana-latest-run.json'), 'utf8'))
const codeName = Object.fromEntries(Object.entries(ERR).map(([k, v]) => [v, k]))

// the program's own transactions, plus every transfer of the demo mint (hook calls are inner instructions)
const sigs = new Map<string, number | null>()
for (const addr of [PROGRAM_ID.toBase58(), run.mint]) {
  const list = await conn.getSignaturesForAddress(new (await import('@solana/web3.js')).PublicKey(addr), { limit: 200 }, 'confirmed')
  for (const s of list) sigs.set(s.signature, s.blockTime ?? null)
}

const ACTIONS: [RegExp, string][] = [
  [/Instruction: SetGuardContained/, 'Guard -> CONTAINED'],
  [/Instruction: SetGuardNormal/, 'Guard -> NORMAL (reset)'],
  [/Instruction: InitializeGuard/, 'Guard created'],
  [/Instruction: InitializeExtraAccountMetaList/, 'Hook accounts registered'],
  [/Instruction: TransferChecked/, 'qUSD-S transfer'],
  [/Instruction: InitializeMint2|InitializeTransferHook/, 'qUSD-S mint created'],
  [/Instruction: MintTo/, 'qUSD-S minted'],
  [/CreateIdempotent|InitializeImmutableOwner/, 'Token account opened'],
]

const rows = []
for (const [signature, blockTime] of [...sigs.entries()].sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0))) {
  const tx = await conn.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
  if (!tx) continue
  const logs = (tx.meta?.logMessages ?? []).join('\n')
  const action = ACTIONS.find(([re]) => re.test(logs))?.[1] ?? (/BPFLoaderUpgradeab1e/.test(logs) || tx.meta?.logMessages?.length === 0 ? 'Program deployed' : 'other')
  const code = JSON.stringify(tx.meta?.err ?? null).match(/"Custom":(\d+)/)?.[1]
  rows.push({
    signature,
    slot: tx.slot,
    time: blockTime ? new Date(blockTime * 1000).toISOString() : null,
    action,
    ok: !tx.meta?.err,
    error: tx.meta?.err ? (code && codeName[Number(code)]) || JSON.stringify(tx.meta.err) : null,
    feeLamports: tx.meta?.fee ?? null,
    demo: Object.values({ ...run.setup, b: run.before.transferSignature, c: run.containment.stateTx, a: run.after.transferSignature }).includes(signature),
  })
}

const out = { cluster: 'devnet', programId: PROGRAM_ID.toBase58(), generatedAt: new Date().toISOString(), latestRun: run, transactions: rows }
mkdirSync(join(ROOT, 'demo'), { recursive: true })
writeFileSync(join(ROOT, 'demo', 'solana-history.json'), `${JSON.stringify(out, null, 2)}\n`)
console.log(`${rows.length} transactions -> demo/solana-history.json`)
for (const r of rows) console.log(`${r.time ?? '?'}  ${r.ok ? 'OK  ' : 'FAIL'}  ${r.action}${r.error ? ` (${r.error})` : ''}  ${r.signature.slice(0, 16)}...`)

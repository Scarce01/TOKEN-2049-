// QUBEE Solana Guard demo on devnet: the same qUSD-S transfer (same sender, recipient, amount) succeeds before
// QUBEE containment and is rejected on-chain after it. The containment carries a real QUBEE threat from Ethereum
// Sepolia: the script reads the CRE report receipt, checks it emitted ThreatAdded, and stores that evidence hash
// in the Guard. Usage: pnpm solana:demo [sepoliaReportTx]. Writes apps/observatory/src/data/solana_guard.json.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Connection, PublicKey } from '@solana/web3.js'
import { CONFIRMED, DECIMALS, containIx, keypair, normalIx, readGuard, send, transferIx } from './lib'

const ROOT = join(import.meta.dir, '../..')
const d = JSON.parse(readFileSync(join(ROOT, 'solana/devnet.json'), 'utf8'))
const conn = new Connection(process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com', 'confirmed')
const program = new PublicKey(d.programId)
const mint = new PublicKey(d.mint)
const authority = keypair(join(ROOT, 'secrets/solana/deployer.json'))
const alice = keypair(join(ROOT, 'secrets/solana/alice.json'))
const TEN = 10n * 10n ** BigInt(DECIMALS)
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`
let n = 0
const step = (s: string) => console.log(`[${String(++n).padStart(2, '0')}] ${s}`)

// The Ethereum side: a CRE trap report on Sepolia (docs/STATUS.md, S7). Hashes only; no decoy address (rule 2).
const SEPOLIA_RPC = process.env.SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const THREAT_ADDED = '0xd8d24f965fdd1d6cb429292409799239be4e504f2b5530d8a6b2d7ee2c3b63ec' // ThreatAdded(address,bytes32,bytes32,bytes32,uint64,uint32,bytes32)
const reportTx = process.argv[2] ?? '0x8a16e65f11ebcf65ee21b500af784bf567e680e47fa4677c3d82a7918547b5e5'
const rpc = (method: string, params: unknown[]) =>
  fetch(SEPOLIA_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    .then((r) => r.json() as Promise<{ result: any }>)
    .then((j) => j.result)
const receipt = await rpc('eth_getTransactionReceipt', [reportTx])
const threatLog = receipt?.status === '0x1' && receipt.logs.find((l: { topics: string[] }) => l.topics[0] === THREAT_ADDED)
if (!threatLog) throw new Error(`${reportTx} is not a successful Sepolia tx with a ThreatAdded event: refusing to contain`)
const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false])
const threat = {
  classification: CONFIRMED, // ThreatAdded is only written for a CONFIRMED trap verdict
  caseHash: Buffer.from(reportTx.slice(2), 'hex'),
  sourceChain: 11155111n,
  evidenceHash: Buffer.from(threatLog.topics[2].slice(2), 'hex'),
  issuedAt: BigInt(block.timestamp),
}

step(`Program ${d.programId}`)
step(`Mint ${d.asset} ${d.mint}`)
let guard = await readGuard(conn, program, mint)
let resetTx: string | undefined
if (guard?.mode !== 'NORMAL') {
  resetTx = await send(conn, [normalIx(program, mint, authority.publicKey)], [authority]) // demo reset from a previous run
  guard = await readGuard(conn, program, mint)
}
step(`Guard ${guard?.mode} (${d.guardPda})`)

const transfer = async (skipPreflight: boolean) => {
  const ix = await transferIx(conn, mint, new PublicKey(d.aliceAta), new PublicKey(d.bobAta), alice.publicKey, TEN)
  return send(conn, [ix], [authority, alice], skipPreflight)
}
const before = await transfer(false)
step(`Before transfer: Alice -> Bob 10 qUSD-S SUCCESS ${before}`)

const containTx = await send(conn, [containIx(program, mint, authority.publicKey, threat)], [authority])
step(`Apply QUBEE threat from Ethereum Sepolia block ${parseInt(receipt.blockNumber)} (evidence ${threatLog.topics[2].slice(0, 10)}...) SUCCESS ${containTx}`)
guard = await readGuard(conn, program, mint)
step(`Guard ${guard?.mode}`)

// skipPreflight so the rejected transfer lands on-chain and has an explorer link
let after = ''
let afterErr = ''
try {
  after = await transfer(true)
} catch (e) {
  const err = e as { signature?: string; message?: string }
  after = err.signature ?? /[1-9A-HJ-NP-Za-km-z]{80,90}/.exec(String(err.message))?.[0] ?? ''
  afterErr = String(err.message)
}
const tx = after ? await conn.getTransaction(after, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }) : null
const rejected = !!tx?.meta?.err && (tx.meta.logMessages ?? []).some((l) => l.includes('GuardContained'))
step(`After transfer: Alice -> Bob 10 qUSD-S ${rejected ? 'REJECTED (GuardContained)' : `UNEXPECTED ${afterErr}`} ${after}`)
if (!rejected) process.exit(1)

const out = {
  label: 'LIVE TESTNET (Solana devnet); threat source LIVE TESTNET (Ethereum Sepolia)',
  cluster: 'devnet',
  programId: d.programId,
  asset: d.asset,
  mint: d.mint,
  guardPda: d.guardPda,
  orgId: d.orgId,
  before: { mode: 'NORMAL', transferSignature: before, result: 'SUCCESS', explorer: explorer(before) },
  containment: {
    sourceChain: 'ethereum-sepolia',
    reportTx,
    reportBlock: parseInt(receipt.blockNumber),
    evidenceHash: threatLog.topics[2],
    classification: 'CONFIRMED',
    stateTx: containTx,
    explorer: explorer(containTx),
    resetTx: resetTx ?? null,
  },
  after: { mode: guard?.mode, transferSignature: after, result: 'REJECTED', error: 'GuardContained', explorer: explorer(after) },
  at: new Date().toISOString(),
}
writeFileSync(join(ROOT, 'apps/observatory/src/data/solana_guard.json'), `${JSON.stringify(out, null, 1)}\n`)
step('evidence written to apps/observatory/src/data/solana_guard.json')

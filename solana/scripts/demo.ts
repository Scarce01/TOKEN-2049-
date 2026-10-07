// Qu3ee Solana Guard demo on devnet (hackathon work, 2026-10-07).
// Same asset, same sender, same recipient: the transfer works before Qu3ee containment and fails after.
// The containment carries a real Chainlink DON report from Base Sepolia, checked on Base before it is applied.
//
// Usage (repo root): bun solana/scripts/demo.ts
// Keys (secrets/solana/, gitignored): deployer.json (fee payer, mint authority), authority.json (Guard authority),
// alice.json, bob.json. RPC: SOLANA_RPC_URL in secrets/solana/rpc.env (devnet). EVM_TX overrides the source report.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Connection, LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js'
import { createPublicClient, http, type Hex } from 'viem'
import { baseSepolia } from 'viem/chains'
import {
  balance,
  customCode,
  ERR,
  fund,
  guardPda,
  ixSetContained,
  loadKeypair,
  MODE,
  metasPda,
  PROGRAM_ID,
  protectMint,
  ROOT,
  readGuard,
  send,
  sendExpectFail,
  transferIx,
} from './lib'

const KEYS = join(ROOT, 'secrets', 'solana')
const rpc = readFileSync(join(KEYS, 'rpc.env'), 'utf8').match(/^SOLANA_RPC_URL=(.+)$/m)?.[1]?.trim()
if (!rpc) throw new Error('SOLANA_RPC_URL missing in secrets/solana/rpc.env')
const conn = new Connection(rpc, 'confirmed')
const deployer = loadKeypair(join(KEYS, 'deployer.json'))
const authority = loadKeypair(join(KEYS, 'authority.json'))
const alice = loadKeypair(join(KEYS, 'alice.json'))
const bob = loadKeypair(join(KEYS, 'bob.json'))
const d = JSON.parse(readFileSync(join(ROOT, 'deployments', 'base-sepolia.json'), 'utf8'))
const base = createPublicClient({ chain: baseSepolia, transport: http(process.env.RPC_URL ?? 'https://sepolia.base.org') })

// the DON's Trap report on Base Sepolia (decoy touch to freeze in 10 s, reports/don/don_benchmark.json)
const EVM_TX = (process.env.EVM_TX ?? '0x32ab0635fff14b905027e50d102d71feb25e66383ca40b536b9405a9da1b834f') as Hex
const FORWARDER_PROCESSED = '0x3617b009e9785c42daebadb6d3fb553243a4bf586d07ea72d65d80013ce116b5'
const RECEIVER_PROCESSED = '0xc9f3b4e9bd20aa7bf429a371ca0bad7e73432d857c8863d343405963d6b4c112'
const KIND_FREEZE = 3
const KIND_THREAT = 7

const exp = (s: string) => `https://explorer.solana.com/tx/${s}?cluster=devnet`
const step = (n: number, s: string) => console.log(`[${String(n).padStart(2, '0')}] ${s}`)
const TEN = 10_000_000n // 10 qUSD-S (6 decimals)

// 0. verify the cross-chain evidence on Base before anything is enforced (security rule 8)
const rc = await base.getTransactionReceipt({ hash: EVM_TX })
const receivers = [d.orgA.receiver, d.orgB.receiver].map((a: string) => a.toLowerCase())
const fwd = rc.logs.find(
  (l) =>
    l.address.toLowerCase() === d.forwarder.toLowerCase() &&
    l.topics[0] === FORWARDER_PROCESSED &&
    receivers.includes(`0x${l.topics[1]!.slice(26)}`),
)
if (!fwd || BigInt(fwd.data) !== 1n) throw new Error('no accepted KeystoneForwarder report in that tx')
const receiver = `0x${fwd.topics[1]!.slice(26)}`
const proc = rc.logs.find((l) => l.address.toLowerCase() === receiver && l.topics[0] === RECEIVER_PROCESSED)
if (!proc) throw new Error('the Receiver did not process a report in that tx')
const caseId = proc.topics[1] as Hex
// ReportProcessed(bytes32 caseId, bytes kinds): data = offset, length, then the kind bytes
const kindsLen = Number(BigInt(`0x${proc.data.slice(66, 130)}`))
const kinds = [...Buffer.from(proc.data.slice(130, 130 + kindsLen * 2), 'hex')]
if (!kinds.includes(KIND_FREEZE) || !kinds.includes(KIND_THREAT)) throw new Error(`not a confirmed containment report (kinds ${kinds})`)
const org = receiver === d.orgA.receiver.toLowerCase() ? d.orgA : d.orgB
const orgLetter = org === d.orgA ? 'A' : 'B'
console.log(`evidence  Base Sepolia ${EVM_TX} (block ${rc.blockNumber}): DON report accepted by Exchange ${orgLetter}'s Receiver, case ${caseId}, kinds [${kinds}]`)

step(1, `Program ${PROGRAM_ID.toBase58()} (devnet)`)

// fees: Alice signs her own transfers
if ((await conn.getBalance(alice.publicKey)) < 0.02 * LAMPORTS_PER_SOL)
  await send(conn, [SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: alice.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL })], [deployer])

const { mint, mintSig, guardSig } = await protectMint(conn, deployer, deployer, org.orgId, authority.publicKey)
step(2, `Mint qUSD-S ${mint.toBase58()} (Token-2022, transfer hook = Guard), org ${orgLetter}  ${exp(mintSig)}`)
await fund(conn, deployer, deployer, mint, alice.publicKey, 1_000n * 1_000_000n)
await fund(conn, deployer, deployer, mint, bob.publicKey, 0n)

const g0 = (await readGuard(conn, mint))!
step(3, `Guard ${g0.mode === MODE.NORMAL ? 'NORMAL' : 'CONTAINED'}  PDA ${guardPda(mint).toBase58()}`)

const beforeSig = await send(conn, [await transferIx(conn, mint, alice.publicKey, bob.publicKey, TEN)], [alice])
step(4, `Before transfer Alice -> Bob 10 qUSD-S SUCCESS  ${exp(beforeSig)}`)

const stateSig = await send(
  conn,
  [ixSetContained(authority.publicKey, mint, { caseHash: caseId, sourceChain: 84532n, evidenceHash: EVM_TX, sourceSeq: rc.blockNumber })],
  [deployer, authority],
)
step(5, `Apply Qu3ee threat (Base Sepolia case ${caseId.slice(0, 10)}...) SUCCESS  ${exp(stateSig)}`)

const g1 = (await readGuard(conn, mint))!
if (g1.mode !== MODE.CONTAINED) throw new Error('Guard did not move to CONTAINED')
step(6, `Guard CONTAINED (evidence ${EVM_TX.slice(0, 10)}..., Base block ${g1.sourceSeq})`)

const bobBefore = await balance(conn, mint, bob.publicKey)
const after = await sendExpectFail(conn, [await transferIx(conn, mint, alice.publicKey, bob.publicKey, TEN)], [alice])
const rejected = customCode(after.err) === ERR.Contained && (await balance(conn, mint, bob.publicKey)) === bobBefore
step(7, `After transfer Alice -> Bob 10 qUSD-S ${rejected ? 'REJECTED on chain (Contained)' : `UNEXPECTED ${JSON.stringify(after.err)}`}  ${exp(after.sig)}`)

const out = {
  cluster: 'devnet',
  generatedAt: new Date().toISOString(),
  programId: PROGRAM_ID.toBase58(),
  mint: mint.toBase58(),
  asset: 'qUSD-S',
  guardPda: guardPda(mint).toBase58(),
  extraAccountMetaList: metasPda(mint).toBase58(),
  org: orgLetter,
  sender: alice.publicKey.toBase58(),
  recipient: bob.publicKey.toBase58(),
  setup: { mintTx: mintSig, guardTx: guardSig },
  before: { mode: 'NORMAL', transferSignature: beforeSig, amount: '10', result: 'SUCCESS' },
  containment: {
    caseId,
    sourceChain: 'base-sepolia',
    sourceChainId: 84532,
    sourceTx: EVM_TX,
    sourceBlock: Number(rc.blockNumber),
    sourceKinds: kinds,
    verifiedOnBase: 'KeystoneForwarder ReportProcessed result 1, Receiver ReportProcessed with FREEZE and THREAT',
    stateTx: stateSig,
  },
  after: { mode: 'CONTAINED', transferSignature: after.sig, amount: '10', result: rejected ? 'REJECTED' : 'UNEXPECTED', error: after.err },
  pass: rejected,
}
mkdirSync(join(ROOT, 'demo'), { recursive: true })
writeFileSync(join(ROOT, 'demo', 'solana-latest-run.json'), `${JSON.stringify(out, null, 2)}\n`)
console.log(`\n${rejected ? 'PASS' : 'FAIL'}: same asset, same sender, same recipient; SUCCESS before, REJECTED after. demo/solana-latest-run.json`)
if (!rejected) process.exit(1)

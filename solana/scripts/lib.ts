// Client for the Qu3ee Guard program (hackathon work, 2026-10-07). Shared by the tests and the devnet demo.
// Instruction data is built from the IDL's discriminators by hand, so no Anchor TS client is needed.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createInitializeTransferHookInstruction,
  createMintToInstruction,
  createTransferCheckedWithTransferHookInstruction,
  ExtensionType,
  getAssociatedTokenAddressSync,
  getMintLen,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token'
import {
  type Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
  TransactionInstruction as Ix,
  sendAndConfirmTransaction,
} from '@solana/web3.js'

const SOLANA_DIR = join(import.meta.dir, '..')
export const ROOT = join(SOLANA_DIR, '..')
const idl = JSON.parse(readFileSync(join(SOLANA_DIR, 'target', 'idl', 'qu3ee_guard.json'), 'utf8'))
export const PROGRAM_ID = new PublicKey(idl.address)
export const DECIMALS = 6
export const MODE = { NORMAL: 0, CONTAINED: 1 } as const
export const ERR = Object.fromEntries((idl.errors as { code: number; name: string }[]).map((e) => [e.name, e.code]))

const disc = (name: string) => Buffer.from(idl.instructions.find((i: { name: string }) => i.name === name).discriminator)
const u64 = (n: bigint) => {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(n)
  return b
}
const b32 = (h: Uint8Array | string) => {
  const b = typeof h === 'string' ? Buffer.from(h.replace(/^0x/, ''), 'hex') : Buffer.from(h)
  if (b.length !== 32) throw new Error('need 32 bytes')
  return b
}

export const loadKeypair = (path: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))))
export const guardPda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('guard'), mint.toBuffer()], PROGRAM_ID)[0]
export const metasPda = (mint: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from('extra-account-metas'), mint.toBuffer()], PROGRAM_ID)[0]

export type ThreatReport = { caseHash: string; sourceChain: bigint; evidenceHash: string; sourceSeq: bigint }

export function ixInitializeGuard(payer: PublicKey, mintAuthority: PublicKey, mint: PublicKey, orgId: string, authority: PublicKey) {
  return new Ix({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: mintAuthority, isSigner: true, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: guardPda(mint), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc('initialize_guard'), b32(orgId), authority.toBuffer()]),
  })
}

export function ixInitializeMetas(payer: PublicKey, mintAuthority: PublicKey, mint: PublicKey) {
  return new Ix({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: mintAuthority, isSigner: true, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: metasPda(mint), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: disc('initialize_extra_account_meta_list'),
  })
}

export function ixSetContained(authority: PublicKey, mint: PublicKey, r: ThreatReport) {
  return new Ix({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: guardPda(mint), isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([disc('set_guard_contained'), b32(r.caseHash), u64(r.sourceChain), b32(r.evidenceHash), u64(r.sourceSeq)]),
  })
}

export function ixSetNormal(authority: PublicKey, mint: PublicKey, sourceSeq: bigint) {
  return new Ix({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: guardPda(mint), isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([disc('set_guard_normal'), u64(sourceSeq)]),
  })
}

/** Guard account layout: 8 discriminator, then the fields of `Guard` in order. */
export async function readGuard(conn: Connection, mint: PublicKey) {
  const a = await conn.getAccountInfo(guardPda(mint), 'confirmed')
  if (!a) return null
  const d = a.data
  let o = 8
  const version = d[o++]!
  const orgId = d.subarray(o, (o += 32)).toString('hex')
  const mintKey = new PublicKey(d.subarray(o, (o += 32)))
  const mode = d[o++]!
  const caseHash = d.subarray(o, (o += 32)).toString('hex')
  const sourceChain = d.readBigUInt64LE(o)
  o += 8
  const evidenceHash = d.subarray(o, (o += 32)).toString('hex')
  const sourceSeq = d.readBigUInt64LE(o)
  o += 8
  const updatedSlot = d.readBigUInt64LE(o)
  o += 8
  const authority = new PublicKey(d.subarray(o, (o += 32)))
  return { version, orgId, mint: mintKey, mode, caseHash, sourceChain, evidenceHash, sourceSeq, updatedSlot, authority }
}

export async function send(conn: Connection, ixs: TransactionInstruction[], signers: Keypair[]) {
  return sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: 'confirmed' })
}

/** Sends a transaction that is expected to fail, without preflight, so the failure is recorded on chain. */
export async function sendExpectFail(conn: Connection, ixs: TransactionInstruction[], signers: Keypair[]) {
  const tx = new Transaction().add(...ixs)
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed')
  tx.recentBlockhash = blockhash
  tx.feePayer = signers[0]!.publicKey
  tx.sign(...signers)
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true })
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  const st = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
  return { sig, err: st?.meta?.err ?? null, logs: st?.meta?.logMessages ?? [] }
}

/** The custom error code inside a failed transaction's error, if any. */
export function customCode(err: unknown): number | null {
  const s = JSON.stringify(err ?? null)
  const m = s.match(/"Custom":(\d+)/)
  return m ? Number(m[1]) : null
}

export async function expectFailure(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    const logs = e instanceof SendTransactionError ? (e.logs ?? []).join('\n') : ''
    return `${String(e)}\n${logs}`
  }
  throw new Error('expected the transaction to fail')
}

/** A new Token-2022 mint whose transfer hook is `hookProgram` (PROGRAM_ID by default; null = no hook). */
export async function createMint(conn: Connection, payer: Keypair, mintAuthority: Keypair, hookProgram: PublicKey | null = PROGRAM_ID) {
  const mint = Keypair.generate()
  const exts = hookProgram ? [ExtensionType.TransferHook] : []
  const space = getMintLen(exts)
  const ixs: TransactionInstruction[] = [
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space,
      lamports: await conn.getMinimumBalanceForRentExemption(space),
      programId: TOKEN_2022_PROGRAM_ID,
    }),
  ]
  if (hookProgram) ixs.push(createInitializeTransferHookInstruction(mint.publicKey, mintAuthority.publicKey, hookProgram, TOKEN_2022_PROGRAM_ID))
  ixs.push(createInitializeMint2Instruction(mint.publicKey, DECIMALS, mintAuthority.publicKey, null, TOKEN_2022_PROGRAM_ID))
  const sig = await send(conn, ixs, [payer, mint])
  return { mint: mint.publicKey, sig }
}

/** Mint + Guard + extra account metas in one go; returns the setup signatures. */
export async function protectMint(conn: Connection, payer: Keypair, mintAuthority: Keypair, orgId: string, authority: PublicKey) {
  const { mint, sig: mintSig } = await createMint(conn, payer, mintAuthority)
  const guardSig = await send(
    conn,
    [ixInitializeGuard(payer.publicKey, mintAuthority.publicKey, mint, orgId, authority), ixInitializeMetas(payer.publicKey, mintAuthority.publicKey, mint)],
    payer.publicKey.equals(mintAuthority.publicKey) ? [payer] : [payer, mintAuthority],
  )
  return { mint, mintSig, guardSig }
}

export const ata = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID)

export async function fund(conn: Connection, payer: Keypair, mintAuthority: Keypair, mint: PublicKey, owner: PublicKey, amount: bigint) {
  const a = ata(mint, owner)
  await send(
    conn,
    [
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, a, owner, mint, TOKEN_2022_PROGRAM_ID),
      ...(amount > 0n ? [createMintToInstruction(mint, a, mintAuthority.publicKey, amount, [], TOKEN_2022_PROGRAM_ID)] : []),
    ],
    payer.publicKey.equals(mintAuthority.publicKey) ? [payer] : [payer, mintAuthority],
  )
  return a
}

/** A transfer with the hook's extra accounts resolved from the mint's meta list (what any wallet does). */
export async function transferIx(conn: Connection, mint: PublicKey, from: PublicKey, to: PublicKey, amount: bigint) {
  return createTransferCheckedWithTransferHookInstruction(conn, ata(mint, from), mint, ata(mint, to), from, amount, DECIMALS, [], 'confirmed', TOKEN_2022_PROGRAM_ID)
}

export async function balance(conn: Connection, mint: PublicKey, owner: PublicKey) {
  const b = await conn.getTokenAccountBalance(ata(mint, owner), 'confirmed')
  return BigInt(b.value.amount)
}

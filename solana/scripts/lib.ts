// Client for the qubee-guard program without the Anchor TS client: four instructions and one account layout.
// Shared by the local tests and the devnet setup/demo scripts.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getMintLen,
} from '@solana/spl-token'
import {
  type Connection,
  Keypair,
  PublicKey,
  type Signer,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'

export const CONFIRMED = 2 // classifications: 0 BEHAVIOR, 1 LINKED, 2 CONFIRMED
export const MODE = ['NORMAL', 'CONTAINED'] as const
export const DECIMALS = 6

const disc = (s: string) => createHash('sha256').update(s).digest().subarray(0, 8)
export const sha256 = (s: string) => createHash('sha256').update(s).digest()
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b }
const i64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(n); return b }

export const keypair = (file: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, 'utf8'))))
export const guardPda = (program: PublicKey, mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('guard'), mint.toBuffer()], program)[0]
export const metasPda = (program: PublicKey, mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('extra-account-metas'), mint.toBuffer()], program)[0]

export const send = (conn: Connection, ixs: TransactionInstruction[], signers: Signer[], skipPreflight = false) =>
  sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { skipPreflight, commitment: 'confirmed' })

/** Token-2022 mint whose every transfer calls the guard program (one transaction). */
export async function createProtectedMint(conn: Connection, authority: Keypair, program: PublicKey, mint = Keypair.generate()) {
  const space = getMintLen([ExtensionType.TransferHook])
  await send(
    conn,
    [
      SystemProgram.createAccount({ fromPubkey: authority.publicKey, newAccountPubkey: mint.publicKey, space, lamports: await conn.getMinimumBalanceForRentExemption(space), programId: TOKEN_2022_PROGRAM_ID }),
      createInitializeTransferHookInstruction(mint.publicKey, authority.publicKey, program, TOKEN_2022_PROGRAM_ID),
      createInitializeMintInstruction(mint.publicKey, DECIMALS, authority.publicKey, null, TOKEN_2022_PROGRAM_ID),
    ],
    [authority, mint],
  )
  return mint.publicKey
}

const ix = (program: PublicKey, keys: [PublicKey, boolean, boolean][], data: Buffer) =>
  new TransactionInstruction({ programId: program, keys: keys.map(([pubkey, isSigner, isWritable]) => ({ pubkey, isSigner, isWritable })), data })

export const initGuardIx = (program: PublicKey, mint: PublicKey, authority: PublicKey, orgId: number) =>
  ix(program, [[guardPda(program, mint), false, true], [mint, false, false], [authority, true, true], [SystemProgram.programId, false, false]], Buffer.concat([disc('global:initialize_guard'), u32(orgId)]))

export const initMetasIx = (program: PublicKey, mint: PublicKey, authority: PublicKey) =>
  ix(program, [[metasPda(program, mint), false, true], [mint, false, false], [authority, true, true], [SystemProgram.programId, false, false]], disc('spl-transfer-hook-interface:initialize-extra-account-metas'))

export type Threat = { classification: number; caseHash: Buffer; sourceChain: bigint; evidenceHash: Buffer; issuedAt: bigint }
export const containIx = (program: PublicKey, mint: PublicKey, authority: PublicKey, t: Threat) =>
  ix(program, [[guardPda(program, mint), false, true], [authority, true, false]], Buffer.concat([disc('global:set_guard_contained'), Buffer.from([t.classification]), t.caseHash, u64(t.sourceChain), t.evidenceHash, i64(t.issuedAt)]))

export const normalIx = (program: PublicKey, mint: PublicKey, authority: PublicKey) =>
  ix(program, [[guardPda(program, mint), false, true], [authority, true, false]], disc('global:set_guard_normal'))

/** Transfer that resolves the hook's extra accounts (the Guard PDA) from the on-chain list. */
export const transferIx = (conn: Connection, mint: PublicKey, from: PublicKey, to: PublicKey, owner: PublicKey, amount: bigint) =>
  createTransferCheckedWithTransferHookInstruction(conn, from, mint, to, owner, amount, DECIMALS, [], 'confirmed', TOKEN_2022_PROGRAM_ID)

/** Guard layout: 8 discriminator, version u8, org_id u32, mode u8, case hash, source chain u64, evidence hash, issued_at i64, slot u64, authority, mint, bump. */
export async function readGuard(conn: Connection, program: PublicKey, mint: PublicKey) {
  const d = (await conn.getAccountInfo(guardPda(program, mint), 'confirmed'))?.data
  if (!d) return null
  return {
    orgId: d.readUInt32LE(9),
    mode: MODE[d[13]!]!,
    caseHash: `0x${d.subarray(14, 46).toString('hex')}`,
    sourceChain: d.readBigUInt64LE(46),
    evidenceHash: `0x${d.subarray(54, 86).toString('hex')}`,
    issuedAt: d.readBigInt64LE(86),
    updatedSlot: d.readBigUInt64LE(94),
    authority: new PublicKey(d.subarray(102, 134)),
  }
}

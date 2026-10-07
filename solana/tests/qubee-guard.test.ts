// QUBEE Guard against a local validator with the program loaded (see solana/README.md: pnpm solana:validator).
// S01-S08 from the Phase 2B doc, plus: omitting the hook accounts cannot bypass, non-CONFIRMED cannot contain,
// and nobody but the mint authority can create a mint's guard.
import { beforeAll, expect, test } from 'bun:test'
import { TOKEN_2022_PROGRAM_ID, createMint, createTransferCheckedInstruction, getAccount, getOrCreateAssociatedTokenAccount, mintTo, transfer } from '@solana/spl-token'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { CONFIRMED, DECIMALS, type Threat, containIx, createProtectedMint, initGuardIx, initMetasIx, normalIx, readGuard, send, sha256, transferIx } from '../scripts/lib'

const conn = new Connection(process.env.SOLANA_RPC ?? 'http://127.0.0.1:8899', 'confirmed')
const PROGRAM = new PublicKey(process.env.GUARD_PROGRAM_ID ?? '')
const TEN = 10n * 10n ** BigInt(DECIMALS)

const authority = Keypair.generate() // org A: mint authority + guard authority
const alice = Keypair.generate()
const bob = Keypair.generate()
const attacker = Keypair.generate()
let mint: PublicKey
let aliceAta: PublicKey
let bobAta: PublicKey

const threat = (issuedAt: bigint, classification = CONFIRMED): Threat => ({
  classification,
  caseHash: sha256('QRM-TEST-1'),
  sourceChain: 11155111n,
  evidenceHash: sha256('0xevidence'),
  issuedAt,
})
const fails = async (p: Promise<unknown>, why: string) => {
  const e = await p.then(() => null, (x: { logs?: string[]; message?: string }) => x)
  expect(e).not.toBeNull()
  expect(`${e?.message}\n${(e?.logs ?? []).join('\n')}`).toContain(why)
}
const fund = async (k: PublicKey) => conn.confirmTransaction(await conn.requestAirdrop(k, 2 * LAMPORTS_PER_SOL), 'confirmed')
const aliceToBob = async () => send(conn, [await transferIx(conn, mint, aliceAta, bobAta, alice.publicKey, TEN)], [alice])
const balance = async (a: PublicKey) => (await getAccount(conn, a, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount

beforeAll(async () => {
  for (const k of [authority, alice, attacker]) await fund(k.publicKey)
  mint = await createProtectedMint(conn, authority, PROGRAM)
  await send(conn, [initGuardIx(PROGRAM, mint, authority.publicKey, 1), initMetasIx(PROGRAM, mint, authority.publicKey)], [authority])
  aliceAta = (await getOrCreateAssociatedTokenAccount(conn, authority, mint, alice.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID)).address
  bobAta = (await getOrCreateAssociatedTokenAccount(conn, authority, mint, bob.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID)).address
  await mintTo(conn, authority, mint, aliceAta, authority, 100n * TEN, [], undefined, TOKEN_2022_PROGRAM_ID)
}, 60_000)

test('S01 NORMAL: transfer succeeds', async () => {
  await aliceToBob()
  expect(await balance(bobAta)).toBe(TEN)
  expect((await readGuard(conn, PROGRAM, mint))?.mode).toBe('NORMAL')
})

test('only the mint authority can create a guard', async () => {
  const m = await createProtectedMint(conn, authority, PROGRAM)
  await fails(send(conn, [initGuardIx(PROGRAM, m, attacker.publicKey, 9)], [attacker]), 'NotMintAuthority')
})

test('S03 wrong signer cannot contain', async () => {
  await fails(send(conn, [containIx(PROGRAM, mint, attacker.publicKey, threat(100n))], [attacker]), 'ConstraintHasOne')
})

test('non-CONFIRMED (LINKED, BEHAVIOR) cannot contain', async () => {
  await fails(send(conn, [containIx(PROGRAM, mint, authority.publicKey, threat(100n, 1))], [authority]), 'NotConfirmed')
  await fails(send(conn, [containIx(PROGRAM, mint, authority.publicKey, threat(100n, 0))], [authority]), 'NotConfirmed')
})

test('S02 CONTAINED: the same transfer fails on-chain', async () => {
  await send(conn, [containIx(PROGRAM, mint, authority.publicKey, threat(100n))], [authority])
  expect((await readGuard(conn, PROGRAM, mint))?.mode).toBe('CONTAINED')
  await fails(aliceToBob(), 'GuardContained')
  expect(await balance(bobAta)).toBe(TEN)
})

test('omitting the hook accounts cannot bypass the guard', async () => {
  const bare = createTransferCheckedInstruction(aliceAta, mint, bobAta, alice.publicKey, TEN, DECIMALS, [], TOKEN_2022_PROGRAM_ID)
  await fails(send(conn, [bare], [alice]), '')
  expect(await balance(bobAta)).toBe(TEN)
})

test('S06 applying the same threat twice leaves stable state', async () => {
  const before = await readGuard(conn, PROGRAM, mint)
  await send(conn, [containIx(PROGRAM, mint, authority.publicKey, threat(100n))], [authority])
  const after = await readGuard(conn, PROGRAM, mint)
  expect(after?.mode).toBe('CONTAINED')
  expect(after?.caseHash).toBe(before!.caseHash)
  expect(after?.issuedAt).toBe(100n)
})

test('S07 older evidence cannot override newer state', async () => {
  await fails(send(conn, [containIx(PROGRAM, mint, authority.publicKey, threat(99n))], [authority]), 'StaleReport')
})

test('S04 an unrelated Token-2022 mint is unaffected', async () => {
  const other = await createMint(conn, authority, authority.publicKey, null, DECIMALS, undefined, undefined, TOKEN_2022_PROGRAM_ID)
  const a = (await getOrCreateAssociatedTokenAccount(conn, authority, other, alice.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID)).address
  const b = (await getOrCreateAssociatedTokenAccount(conn, authority, other, bob.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID)).address
  await mintTo(conn, authority, other, a, authority, TEN, [], undefined, TOKEN_2022_PROGRAM_ID)
  await transfer(conn, alice, a, b, alice, TEN, [], undefined, TOKEN_2022_PROGRAM_ID)
  expect(await balance(b)).toBe(TEN)
})

test('S05 org A cannot contain org B', async () => {
  const orgB = Keypair.generate()
  await fund(orgB.publicKey)
  const mintB = await createProtectedMint(conn, orgB, PROGRAM)
  await send(conn, [initGuardIx(PROGRAM, mintB, orgB.publicKey, 2), initMetasIx(PROGRAM, mintB, orgB.publicKey)], [orgB])
  await fails(send(conn, [containIx(PROGRAM, mintB, authority.publicKey, threat(100n))], [authority]), 'ConstraintHasOne')
  expect((await readGuard(conn, PROGRAM, mintB))?.mode).toBe('NORMAL')
})

test('S08 unauthorized reset fails; authorized reset restores transfers', async () => {
  await fails(send(conn, [normalIx(PROGRAM, mint, attacker.publicKey)], [attacker]), 'ConstraintHasOne')
  expect((await readGuard(conn, PROGRAM, mint))?.mode).toBe('CONTAINED')
  await send(conn, [normalIx(PROGRAM, mint, authority.publicKey)], [authority])
  await aliceToBob()
  expect(await balance(bobAta)).toBe(2n * TEN)
})

// Qu3ee Guard tests S01 to S08 plus the transfer hook checks, on a local solana-test-validator.
// Run: cd solana && anchor build && bun test tests
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTransferCheckedInstruction, getExtraAccountMetaAddress, getMint, getTransferHook, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, type PublicKey, TransactionInstruction } from '@solana/web3.js'
import {
  ata,
  balance,
  createMint,
  customCode,
  DECIMALS,
  ERR,
  expectFailure,
  fund,
  guardPda,
  ixInitializeGuard,
  ixSetContained,
  ixSetNormal,
  MODE,
  metasPda,
  PROGRAM_ID,
  protectMint,
  readGuard,
  send,
  sendExpectFail,
  transferIx,
} from '../scripts/lib'

setDefaultTimeout(60_000)
const PORT = 18899
const SO = join(import.meta.dir, '..', 'target', 'deploy', 'qu3ee_guard.so')
const conn = new Connection(`http://127.0.0.1:${PORT}`, 'confirmed')
let validator: ReturnType<typeof Bun.spawn>

const payer = Keypair.generate() // also the mint authority
const authority = Keypair.generate() // the Guard authority (carries confirmed Qu3ee threats)
const stranger = Keypair.generate()
const alice = Keypair.generate()
const bob = Keypair.generate()
const ORG_A = `0x${'aa'.repeat(32)}`
const ORG_B = `0x${'bb'.repeat(32)}`
const report = (seq: bigint, c = 'c1') => ({
  caseHash: `0x${Buffer.from(c.padEnd(32, '.')).toString('hex')}`,
  sourceChain: 84532n,
  evidenceHash: `0x${'e'.repeat(64)}`,
  sourceSeq: seq,
})
let mintA: PublicKey
let mintB: PublicKey

beforeAll(async () => {
  const ledger = mkdtempSync(join(tmpdir(), 'qu3ee-ledger-'))
  validator = Bun.spawn(
    ['solana-test-validator', '--reset', '--quiet', '--ledger', ledger, '--rpc-port', String(PORT), '--faucet-port', String(PORT + 1000),
      '--bpf-program', PROGRAM_ID.toBase58(), SO],
    { stdout: 'ignore', stderr: 'ignore' },
  )
  for (let i = 0; i < 120; i++) {
    try {
      await conn.getLatestBlockhash()
      break
    } catch {
      await Bun.sleep(500)
    }
  }
  for (const k of [payer, authority, stranger, alice]) {
    const sig = await conn.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL)
    await conn.confirmTransaction(sig, 'confirmed')
  }
  mintA = (await protectMint(conn, payer, payer, ORG_A, authority.publicKey)).mint
  mintB = (await protectMint(conn, payer, payer, ORG_B, authority.publicKey)).mint
  for (const m of [mintA, mintB]) {
    await fund(conn, payer, payer, m, alice.publicKey, 1_000_000_000n)
    await fund(conn, payer, payer, m, bob.publicKey, 0n)
  }
}, 120_000)

afterAll(() => validator?.kill())

const TEN = 10n * 10n ** BigInt(DECIMALS)

describe('transfer hook wiring', () => {
  test('mint carries the hook extension pointing at the Guard program', async () => {
    const mint = await getMint(conn, mintA, 'confirmed', TOKEN_2022_PROGRAM_ID)
    expect(getTransferHook(mint)?.programId.toBase58()).toBe(PROGRAM_ID.toBase58())
  })
  test('extra account meta list exists at the standard address', async () => {
    expect(getExtraAccountMetaAddress(mintA, PROGRAM_ID).toBase58()).toBe(metasPda(mintA).toBase58())
    expect(await conn.getAccountInfo(metasPda(mintA))).not.toBeNull()
  })
  test('client resolves the Guard PDA as the extra account', async () => {
    const ix = await transferIx(conn, mintA, alice.publicKey, bob.publicKey, 1n)
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toContain(guardPda(mintA).toBase58())
  })
  test('only the mint authority can create a Guard', async () => {
    const { mint } = await createMint(conn, payer, payer)
    const out = await expectFailure(send(conn, [ixInitializeGuard(stranger.publicKey, stranger.publicKey, mint, ORG_A, stranger.publicKey)], [stranger]))
    expect(out).toContain(`0x${ERR.NotMintAuthority.toString(16)}`)
  })
  test('a mint without this hook cannot get a Guard', async () => {
    const { mint } = await createMint(conn, payer, payer, null)
    const out = await expectFailure(send(conn, [ixInitializeGuard(payer.publicKey, payer.publicKey, mint, ORG_A, authority.publicKey)], [payer]))
    expect(out).toContain(`0x${ERR.MintHookMismatch.toString(16)}`)
  })
})

describe('S01 to S08', () => {
  test('S01 normal: Guard NORMAL, transfer succeeds', async () => {
    expect((await readGuard(conn, mintA))!.mode).toBe(MODE.NORMAL)
    const before = await balance(conn, mintA, bob.publicKey)
    await send(conn, [await transferIx(conn, mintA, alice.publicKey, bob.publicKey, TEN)], [alice])
    expect(await balance(conn, mintA, bob.publicKey)).toBe(before + TEN)
  })

  test('S03 unauthorized: wrong signer cannot contain', async () => {
    const out = await expectFailure(send(conn, [ixSetContained(stranger.publicKey, mintA, report(10n))], [stranger]))
    expect(out).toContain(`0x${ERR.Unauthorized.toString(16)}`)
    expect((await readGuard(conn, mintA))!.mode).toBe(MODE.NORMAL)
  })

  test('S02 contained: same transfer fails on chain', async () => {
    await send(conn, [ixSetContained(authority.publicKey, mintA, report(100n))], [authority])
    expect((await readGuard(conn, mintA))!.mode).toBe(MODE.CONTAINED)
    const before = await balance(conn, mintA, bob.publicKey)
    const r = await sendExpectFail(conn, [await transferIx(conn, mintA, alice.publicKey, bob.publicKey, TEN)], [alice])
    expect(customCode(r.err)).toBe(ERR.Contained)
    expect(await balance(conn, mintA, bob.publicKey)).toBe(before)
  })

  test('S04 unrelated mint: a Token-2022 mint without the hook still moves', async () => {
    const { mint } = await createMint(conn, payer, payer, null)
    await fund(conn, payer, payer, mint, alice.publicKey, TEN)
    await fund(conn, payer, payer, mint, bob.publicKey, 0n)
    await send(conn, [createTransferCheckedInstruction(ata(mint, alice.publicKey), mint, ata(mint, bob.publicKey), alice.publicKey, TEN, DECIMALS, [], TOKEN_2022_PROGRAM_ID)], [alice])
    expect(await balance(conn, mint, bob.publicKey)).toBe(TEN)
  })

  test('S05 unrelated org: org A contained, org B still NORMAL and moving', async () => {
    expect((await readGuard(conn, mintB))!.mode).toBe(MODE.NORMAL)
    await send(conn, [await transferIx(conn, mintB, alice.publicKey, bob.publicKey, TEN)], [alice])
    expect(await balance(conn, mintB, bob.publicKey)).toBe(TEN)
  })

  test('S06 idempotent: the same case twice leaves the same state', async () => {
    const g1 = await readGuard(conn, mintA)
    // a compute-budget ix makes this a different transaction from S02's, with the same containment inside
    await send(conn, [ComputeBudgetProgram.setComputeUnitLimit({ units: 199_999 }), ixSetContained(authority.publicKey, mintA, report(100n))], [authority])
    const g2 = await readGuard(conn, mintA)
    expect(g2).toEqual(g1)
  })

  test('S07 stale: older evidence cannot override newer state', async () => {
    const out = await expectFailure(send(conn, [ixSetContained(authority.publicKey, mintA, report(50n, 'c2'))], [authority]))
    expect(out).toContain(`0x${ERR.StaleReport.toString(16)}`)
    const out2 = await expectFailure(send(conn, [ixSetNormal(authority.publicKey, mintA, 99n)], [authority]))
    expect(out2).toContain(`0x${ERR.StaleReport.toString(16)}`)
    const g = (await readGuard(conn, mintA))!
    expect(g.mode).toBe(MODE.CONTAINED)
    expect(g.sourceSeq).toBe(100n)
  })

  test('S08 reset authority: a stranger cannot reset, the authority can', async () => {
    const out = await expectFailure(send(conn, [ixSetNormal(stranger.publicKey, mintA, 200n)], [stranger]))
    expect(out).toContain(`0x${ERR.Unauthorized.toString(16)}`)
    expect((await readGuard(conn, mintA))!.mode).toBe(MODE.CONTAINED)
    await send(conn, [ixSetNormal(authority.publicKey, mintA, 200n)], [authority])
    expect((await readGuard(conn, mintA))!.mode).toBe(MODE.NORMAL)
    await send(conn, [await transferIx(conn, mintA, alice.publicKey, bob.publicKey, TEN)], [alice])
  })
})

describe('no bypass', () => {
  beforeAll(async () => {
    await send(conn, [ixSetContained(authority.publicKey, mintA, report(300n, 'c3'))], [authority])
  })

  test('omitting the hook accounts does not skip the hook', async () => {
    const plain = createTransferCheckedInstruction(ata(mintA, alice.publicKey), mintA, ata(mintA, bob.publicKey), alice.publicKey, TEN, DECIMALS, [], TOKEN_2022_PROGRAM_ID)
    const r = await sendExpectFail(conn, [plain], [alice])
    expect(r.err).not.toBeNull()
  })

  test('pointing the hook at another mint\'s NORMAL Guard is refused', async () => {
    const ix = await transferIx(conn, mintA, alice.publicKey, bob.publicKey, TEN)
    const swapped = new TransactionInstruction({
      programId: ix.programId,
      data: ix.data,
      keys: ix.keys.map((k) => (k.pubkey.equals(guardPda(mintA)) ? { ...k, pubkey: guardPda(mintB) } : k)),
    })
    const r = await sendExpectFail(conn, [swapped], [alice])
    expect(r.err).not.toBeNull()
  })

  test('calling execute directly, outside a transfer, is refused', async () => {
    const ix = await transferIx(conn, mintB, alice.publicKey, bob.publicKey, TEN)
    // the hook's own accounts as Token-2022 would pass them: source, mint, destination, owner, meta list, Guard
    const direct = new TransactionInstruction({
      programId: PROGRAM_ID,
      data: Buffer.concat([Buffer.from([105, 37, 101, 197, 75, 251, 102, 26]), Buffer.alloc(8)]),
      keys: [
        { pubkey: ata(mintB, alice.publicKey), isSigner: false, isWritable: false },
        { pubkey: mintB, isSigner: false, isWritable: false },
        { pubkey: ata(mintB, bob.publicKey), isSigner: false, isWritable: false },
        { pubkey: alice.publicKey, isSigner: false, isWritable: false },
        { pubkey: metasPda(mintB), isSigner: false, isWritable: false },
        { pubkey: guardPda(mintB), isSigner: false, isWritable: false },
      ],
    })
    expect(ix.keys.length).toBeGreaterThan(4)
    const r = await sendExpectFail(conn, [direct], [alice])
    expect(r.err).not.toBeNull()
  })
})

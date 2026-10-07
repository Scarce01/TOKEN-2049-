// One-time devnet setup after `anchor deploy`: qUSD-S mint with the QUBEE hook, its Guard (NORMAL), the extra
// account list, Alice and Bob token accounts, 1,000 qUSD-S to Alice. Then the mint's hook authority is removed,
// so nobody can point the hook elsewhere and switch enforcement off. Writes public IDs to solana/devnet.json.
// Keys: secrets/solana/{deployer,alice,bob}.json (git-ignored). The deployer pays every fee.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AuthorityType, TOKEN_2022_PROGRAM_ID, createSetAuthorityInstruction, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { DECIMALS, createProtectedMint, guardPda, initGuardIx, initMetasIx, keypair, metasPda, send } from './lib'

const ROOT = join(import.meta.dir, '../..')
const KEYS = join(ROOT, 'secrets/solana')
const OUT = join(ROOT, 'solana/devnet.json')
const conn = new Connection(process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com', 'confirmed')
const program = new PublicKey(/\[programs\.devnet\][^[]*qubee_guard = "(\w+)"/.exec(readFileSync(join(ROOT, 'solana/Anchor.toml'), 'utf8'))![1]!)

if (existsSync(OUT)) throw new Error('solana/devnet.json exists: setup already ran (delete it to set up a new mint)')
mkdirSync(KEYS, { recursive: true })
const load = (name: string) => {
  const f = join(KEYS, `${name}.json`)
  if (!existsSync(f)) writeFileSync(f, JSON.stringify([...Keypair.generate().secretKey]))
  return keypair(f)
}
const deployer = keypair(join(KEYS, 'deployer.json'))
const alice = load('alice')
const bob = load('bob')
const step = (s: string) => console.log(`[setup] ${s}`)

step(`program ${program.toBase58()}, deployer ${deployer.publicKey.toBase58()}`)
const mint = await createProtectedMint(conn, deployer, program)
step(`qUSD-S mint ${mint.toBase58()}`)
const guardTx = await send(conn, [initGuardIx(program, mint, deployer.publicKey, 1), initMetasIx(program, mint, deployer.publicKey)], [deployer])
step(`guard ${guardPda(program, mint).toBase58()} NORMAL, extra account list ${metasPda(program, mint).toBase58()}`)
const ata = async (owner: PublicKey) => (await getOrCreateAssociatedTokenAccount(conn, deployer, mint, owner, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID)).address
const aliceAta = await ata(alice.publicKey)
const bobAta = await ata(bob.publicKey)
await mintTo(conn, deployer, mint, aliceAta, deployer, 1000n * 10n ** BigInt(DECIMALS), [], undefined, TOKEN_2022_PROGRAM_ID)
step('1,000 qUSD-S minted to Alice')
const lockTx = await send(conn, [createSetAuthorityInstruction(mint, deployer.publicKey, AuthorityType.TransferHookProgramId, null, [], TOKEN_2022_PROGRAM_ID)], [deployer])
step('hook authority removed: the hook program can no longer be changed on this mint')

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      cluster: 'devnet',
      programId: program.toBase58(),
      mint: mint.toBase58(),
      asset: 'qUSD-S',
      guardPda: guardPda(program, mint).toBase58(),
      extraAccountMetaList: metasPda(program, mint).toBase58(),
      orgId: 1,
      authority: deployer.publicKey.toBase58(),
      alice: alice.publicKey.toBase58(),
      bob: bob.publicKey.toBase58(),
      aliceAta: aliceAta.toBase58(),
      bobAta: bobAta.toBase58(),
      txs: { guard: guardTx, hookAuthorityRemoved: lockTx },
    },
    null,
    2,
  )}\n`,
)
step('wrote solana/devnet.json')

// Steps 4, 5 and 8 (20_data.md section 4): chain first, then the backend ledger, so every
// ledger tx_hash is real. Decoy accounts go through exactly the same path as ordinary ones.
//
// Usage: bun src/seed-chain.ts --org a [--fund-only] [--ledger-only]
// Env: DEPLOY_NAME, RPC_URL, SEEDER_PRIVATE_KEY (a Faucet seeder), ORG_SALT_A / ORG_SALT_B,
//      DATABASE_URL (quorum_svc), HOT_WALLET_ENC_KEY_A / _B
import { join } from 'node:path'
import {
  clients,
  db,
  encryptKey,
  loadDeployment,
  need,
  readJson,
  repoRoot,
  secretsDir,
  send,
  writeJson,
} from '@quorum/offchain'
import {
  DepositVaultAbi,
  FaucetAbi,
  KeyAction,
  KeyBindingTypes,
  KeyRegistryAbi,
  keyDomain,
  MockERC20Abi,
  QuorumVaultAbi,
  userIdHash,
} from '@quorum/shared'
import type { Address, Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { DecoyFile, DevUser } from './gen-keys'
import { HOT_PREFIXES, randomLabel, rewriteWhitelist, takenLabels, WHITELIST_PREFIXES } from './labels'
import type { Account } from './types'

const arg = (k: string) => process.argv.includes(`--${k}`)
const org = ((process.argv.includes('--org') ? process.argv[process.argv.indexOf('--org') + 1] : undefined) ?? 'a') as
  | 'a'
  | 'b'
const ORG = org.toUpperCase()
const d = loadDeployment()
const o = org === 'a' ? d.orgA : d.orgB
const c = clients(d, need('SEEDER_PRIVATE_KEY') as Hex)
const salt = need(`ORG_SALT_${ORG}`) as Hex
const schema = org === 'a' ? 'exchange_a' : 'exchange_b'
const BATCH = 20

const accounts = readJson<Account[]>(join(repoRoot, 'datasets', 'out', `all-accounts-${org}.json`))
const dev = readJson<Record<string, DevUser[]>>(join(secretsDir, 'dev-users.local.json'))
const decoys = readJson<DecoyFile>(join(secretsDir, 'decoys.local.json'), {})
const keyOf = new Map<string, Hex>()
for (const u of dev[org] ?? []) keyOf.set(u.userId, u.privateKey)
for (const a of decoys[org]?.accounts ?? []) if (a.privateKey) keyOf.set(a.userId, a.privateKey)

const uid = (a: Account) => userIdHash(salt, a.userId)

async function registerKeys() {
  const pending: { a: Account; pk: Hex }[] = []
  for (const a of accounts) {
    const pk = keyOf.get(a.userId)
    if (!pk) throw new Error(`no key for ${a.userId}; run gen-keys`)
    const cur = (await c.pub.readContract({
      address: d.keyRegistry,
      abi: KeyRegistryAbi,
      functionName: 'keyOf',
      args: [uid(a)],
    })) as Address
    if (cur === '0x0000000000000000000000000000000000000000') pending.push({ a, pk })
  }
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH)
    const ids: Hex[] = []
    const keys: Address[] = []
    const dls: bigint[] = []
    const sigs: Hex[] = []
    for (const { a, pk } of chunk) {
      const acct = privateKeyToAccount(pk)
      const nonce = (await c.pub.readContract({
        address: d.keyRegistry,
        abi: KeyRegistryAbi,
        functionName: 'keyNonce',
        args: [uid(a)],
      })) as bigint
      sigs.push(
        await acct.signTypedData({
          domain: keyDomain(d.chainId, d.keyRegistry),
          types: KeyBindingTypes,
          primaryType: 'KeyBinding',
          message: { userIdHash: uid(a), key: acct.address, action: KeyAction.REGISTER, nonce, deadline },
        }),
      )
      ids.push(uid(a))
      keys.push(acct.address)
      dls.push(deadline)
    }
    const tx = await send(c, {
      address: d.keyRegistry,
      abi: KeyRegistryAbi,
      functionName: 'registerBatch',
      args: [ids, keys, dls, sigs],
    })
    console.log(`registered ${chunk.length} keys tx=${tx}`)
  }
}

type LedgerRow = { userId: string; token: 'qUSD' | 'qETH'; amount: bigint; tx: Hex; block: bigint }

async function deposit(): Promise<LedgerRow[]> {
  const rows: LedgerRow[] = []
  for (const sym of ['qUSD', 'qETH'] as const) {
    const token = sym === 'qUSD' ? d.qUSD : d.qETH
    const todo: { a: Account; amt: bigint }[] = []
    for (const a of accounts) {
      const want = BigInt(a.deposits[sym])
      if (want === 0n) continue
      const have = (await c.pub.readContract({
        address: d.depositVault,
        abi: DepositVaultAbi,
        functionName: 'depositedOf',
        args: [uid(a), token],
      })) as bigint
      if (have < want) todo.push({ a, amt: want - have })
    }
    for (let i = 0; i < todo.length; i += BATCH) {
      const chunk = todo.slice(i, i + BATCH)
      const total = chunk.reduce((s, x) => s + x.amt, 0n)
      await send(c, {
        address: d.faucet,
        abi: FaucetAbi,
        functionName: 'drip',
        args: [token, c.account!.address, total],
      })
      await send(c, { address: token, abi: MockERC20Abi, functionName: 'approve', args: [d.depositVault, total] })
      const tx = await send(c, {
        address: d.depositVault,
        abi: DepositVaultAbi,
        functionName: 'depositBatch',
        args: [chunk.map((x) => uid(x.a)), token, chunk.map((x) => x.amt)],
      })
      const rc = await c.pub.getTransactionReceipt({ hash: tx })
      for (const x of chunk) rows.push({ userId: x.a.userId, token: sym, amount: x.amt, tx, block: rc.blockNumber })
      console.log(`deposited ${sym} for ${chunk.length} users tx=${tx}`)
    }
  }
  return rows
}

async function writeLedger(rows: LedgerRow[]) {
  const sql = db()
  const tokenAddr = { qUSD: d.qUSD, qETH: d.qETH }
  for (const a of accounts) {
    await sql`insert into ${sql(`${schema}.users`)} (user_id, user_id_hash, display_name, kyc_level, created_at, last_active_at)
              values (${a.userId}, ${uid(a)}, ${a.displayName}, ${a.kycLevel},
                      now() - make_interval(days => ${Math.floor(a.regDays)}), now() - make_interval(hours => ${Math.floor(168 / Math.max(a.activity, 0.1))}))
              on conflict (user_id) do nothing`
  }
  for (const r of rows) {
    await sql`insert into ${sql(`${schema}.deposits_ledger`)} (user_id, token, amount, tx_hash, block_number)
              values (${r.userId}, ${tokenAddr[r.token]}, ${r.amount.toString()}, ${r.tx}, ${r.block.toString()})`
  }
  // balances must equal on-chain depositedOf (acceptance check)
  for (const a of accounts) {
    for (const sym of ['qUSD', 'qETH'] as const) {
      const token = tokenAddr[sym]
      const onchain = (await c.pub.readContract({
        address: d.depositVault,
        abi: DepositVaultAbi,
        functionName: 'depositedOf',
        args: [uid(a), token],
      })) as bigint
      await sql`insert into ${sql(`${schema}.balances`)} (user_id, token, available) values (${a.userId}, ${token}, ${onchain.toString()})
                on conflict (user_id, token) do update set available = excluded.available, updated_at = now()`
    }
  }
  await seedHotWallets(sql)
  await sql.end()
}

/**
 * Vault rows, two real ops EOAs and the real whitelist. Labels come from the same random generator
 * decoy-admin uses for decoys (datasets/src/labels.ts), so no label in git marks a row as real or decoy.
 */
async function seedHotWallets(sql: ReturnType<typeof db>) {
  const enc = need(`HOT_WALLET_ENC_KEY_${ORG}`) as Hex
  const opsPath = join(secretsDir, 'ops-eoas.local.json')
  const ops = readJson<Record<string, { label: string; privateKey: Hex; address: Hex }[]>>(opsPath, {})
  const wlKey = `${org}:whitelist`
  if (!ops[org] || !ops[wlKey]) {
    const taken = await takenLabels(sql, schema)
    const mk = (label: string) => {
      const pk = generatePrivateKey()
      return { label, privateKey: pk, address: privateKeyToAccount(pk).address }
    }
    // ops-gas is the gas payer and has no decoy twin; the other EOA shares the decoy label pool.
    ops[org] ??= [mk('ops-gas-01'), mk(randomLabel(HOT_PREFIXES, taken))]
    ops[wlKey] ??= Array.from({ length: 4 }, () => mk(randomLabel(WHITELIST_PREFIXES, taken)))
    writeJson(opsPath, ops)
  }
  await rewriteWhitelist(sql, schema, ops[wlKey]!)
  const rows = [
    { label: 'vault-hot-01', address: o.hotVault, kind: 'vault', key: null as string | null },
    { label: 'vault-warm-01', address: o.warmVault, kind: 'vault', key: null },
    ...ops[org]!.map((e) => ({ label: e.label, address: e.address, kind: 'eoa', key: encryptKey(enc, e.privateKey) })),
  ]
  for (const r of rows) {
    await sql`insert into ${sql(`${schema}.hot_wallets`)} (label, chain, address, kind, private_key_enc)
              values (${r.label}, 'base-sepolia', ${r.address}, ${r.kind}, ${r.key})
              on conflict (label) do update set address = excluded.address`
  }
}

/** Step 8: always through fund() so asset conservation stays exact. Called by reset-demo too. */
async function fundVaults() {
  const plan: [Address, Address, bigint][] = [
    [o.hotVault, d.qUSD, 10_000_000_000n],
    [o.hotVault, d.qETH, 3n * 10n ** 18n],
    [o.warmVault, d.qUSD, 20_000_000_000n],
    [o.warmVault, d.qETH, 5n * 10n ** 18n],
  ]
  for (const [vault, token, amt] of plan) {
    const [, , funded] = (await c.pub.readContract({
      address: vault,
      abi: QuorumVaultAbi,
      functionName: 'outStats',
      args: [token],
    })) as [bigint, bigint, bigint]
    if (funded > 0n) continue
    await send(c, { address: d.faucet, abi: FaucetAbi, functionName: 'drip', args: [token, c.account!.address, amt] })
    await send(c, { address: token, abi: MockERC20Abi, functionName: 'approve', args: [vault, amt] })
    const tx = await send(c, { address: vault, abi: QuorumVaultAbi, functionName: 'fund', args: [token, amt] })
    console.log(`funded ${vault} ${token} ${amt} tx=${tx}`)
  }
}

if (arg('fund-only')) {
  await fundVaults()
} else if (arg('chain-only')) {
  await registerKeys()
  await deposit()
  await fundVaults()
} else if (arg('ledger-only')) {
  await writeLedger([])
} else {
  await registerKeys()
  const rows = await deposit()
  await writeLedger(rows)
  await fundVaults()
}
console.log('seed-chain done')

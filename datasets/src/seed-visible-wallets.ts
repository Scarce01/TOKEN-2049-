#!/usr/bin/env bun
// Puts 20 EOA rows into exchange_a.hot_wallets for the local attacker-visible list.
// One row comes from secrets/decoys.local.json (already funded on Ethereum Sepolia); 19 are synthetic.
// Balances and labels come from secrets/visible-wallets.layout.local.json (made once by makeLayout), never from
// this file, and the output treats every row the same: nothing here or in the logs tells which row is the decoy
// (rule 2, audit 2026-10-07 H3).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { clients, db, encryptKey, loadDeployment, need, readJson, secretsDir, send, writeJson } from '@quorum/offchain'
import { FaucetAbi } from '@quorum/shared'
import { erc20Abi, type Hex, parseEther } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { decoyRankOf, makeLayout, type VisibleLayout } from './visible-layout'

type SecretFile = Record<string, { wallets?: { label: string; address: Hex; privateKey: Hex }[] }>
type Stored = { label: string; address: Hex; privateKey: Hex; amount: string }

const CHAIN = 'ethereum-sepolia'

const storePath = join(secretsDir, 'visible-wallets.local.json')
const layoutPath = join(secretsDir, 'visible-wallets.layout.local.json')
const deployment = loadDeployment()
const encKey = need('HOT_WALLET_ENC_KEY') as Hex
const secrets = readJson<SecretFile>(join(secretsDir, 'decoys.local.json'))
const secretWallet = secrets.a?.wallets?.[0]
if (!secretWallet) throw new Error('secrets file has no org A wallet')

if (!existsSync(layoutPath)) writeJson(layoutPath, makeLayout(secretWallet.label))
const layout = readJson<VisibleLayout>(layoutPath)
if (decoyRankOf(layout) !== layout.decoyRank) throw new Error('layout file is inconsistent; delete it to regenerate')

const taken = new Set([secretWallet.label])
for (const row of layout.synthetic) {
  if (taken.has(row.label)) throw new Error('label collision in layout; delete it to regenerate')
  taken.add(row.label)
}

const stored = readJson<{ wallets: Stored[] }>(storePath, { wallets: [] })
const byLabel = new Map(stored.wallets.map((w) => [w.label, w]))
const synthetic: Stored[] = layout.synthetic.map((row) => {
  const prev = byLabel.get(row.label)
  if (prev) return { ...prev, amount: row.amount }
  const privateKey = generatePrivateKey()
  return {
    label: row.label,
    address: privateKeyToAccount(privateKey).address,
    privateKey,
    amount: row.amount,
  }
})
writeJson(storePath, { wallets: synthetic })

const c = clients(deployment, need('DEPLOYER_PRIVATE_KEY') as Hex)
const gasFloor = parseEther('0.002')

async function tokenBalance(address: Hex): Promise<bigint> {
  return c.pub.readContract({ address: deployment.qUSD, abi: erc20Abi, functionName: 'balanceOf', args: [address] })
}

// Every row, decoy included, goes through the same loop and prints the same line (no "secrets-file" line).
const funded: { label: string; address: Hex; amount: string }[] = [
  ...synthetic,
  { label: secretWallet.label, address: secretWallet.address, amount: layout.decoyAmount },
].sort((a, b) => a.label.localeCompare(b.label))
for (const row of funded) {
  const have = await tokenBalance(row.address)
  const want = BigInt(row.amount)
  if (have < want) {
    await send(c, {
      address: deployment.faucet,
      abi: FaucetAbi,
      functionName: 'drip',
      args: [deployment.qUSD, row.address, want - have],
    })
    console.log(`drip ${row.label}`)
  } else if (have > want) {
    throw new Error(`${row.label} balance is above its layout amount`)
  }
}

async function fundGas(address: Hex) {
  const bal = await c.pub.getBalance({ address })
  if (bal >= gasFloor) return
  const tx = await c.wallet!.sendTransaction({
    account: c.account!,
    chain: c.pub.chain,
    to: address,
    value: gasFloor,
  })
  await c.pub.waitForTransactionReceipt({ hash: tx })
  console.log(`gas top-up ${address} tx=${tx}`)
}
for (const row of funded) await fundGas(row.address)

const sql = db()
const rows: { label: string; address: string; privateKey: Hex }[] = [
  ...synthetic,
  { label: secretWallet.label, address: secretWallet.address, privateKey: secretWallet.privateKey },
]
// rows from an earlier layout would linger next to the new ones and break the ranking; drop them (this chain only)
await sql`delete from exchange_a.hot_wallets where chain = ${CHAIN} and kind = 'eoa'
          and not (label = any(${rows.map((r) => r.label)}))`
for (const row of rows) {
  const blob = encryptKey(encKey, row.privateKey)
  await sql`insert into exchange_a.hot_wallets (label, chain, address, kind, private_key_enc, status)
            values (${row.label}, ${CHAIN}, ${row.address}, 'eoa', ${blob}, 'active')
            on conflict (label) do update set
              chain = excluded.chain,
              address = excluded.address,
              kind = excluded.kind,
              private_key_enc = excluded.private_key_enc,
              status = excluded.status`
}
await sql.end()
console.log(`rows=${rows.length}`)

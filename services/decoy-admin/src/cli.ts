#!/usr/bin/env bun
// decoy-admin: the security lead places decoys (20_data.md section 4 steps 2 and 7; 32_phase2.md 2.3).
// Commands: accounts | wallets | register | life | configs
// Decoys are written to the exchange schema through the same shapes as real rows: no marker
// column, and IDs and keys come from the same generators.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { freshUserId, makeAccount } from '@quorum/datasets/src/gen-accounts'
import type { DecoyFile } from '@quorum/datasets/src/gen-keys'
import {
  HOT_PREFIXES,
  randomLabel,
  rewriteWhitelist,
  takenLabels,
  WHITELIST_PREFIXES,
} from '@quorum/datasets/src/labels'
import type { Account } from '@quorum/datasets/src/types'
import {
  clients,
  db,
  encryptKey,
  loadDeployment,
  need,
  readJson,
  repoRoot,
  rng,
  secretsDir,
  send,
  shuffle,
  writeJson,
} from '@quorum/offchain'
import {
  buildTree,
  decoyLeaf,
  decoySalt,
  decoyTag,
  FaucetAbi,
  nextPow2,
  ORGS,
  packTags,
  userIdHash,
} from '@quorum/shared'
import { type Hex, hexToBytes, parseEther } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { genWorkflowConfigs } from './configs'

const cmd = process.argv[2]
const flag = (k: string): string | undefined => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const org = (flag('org') ?? 'a') as 'a' | 'b'
const ORG = org.toUpperCase()
const decoyPath = join(secretsDir, 'decoys.local.json')
const outDir = join(repoRoot, 'datasets', 'out')

function loadDecoys(): DecoyFile {
  const f = readJson<DecoyFile>(decoyPath, {})
  f[org] ??= { accounts: [], wallets: [], addresses: [] }
  return f
}

function quorumK(): Uint8Array {
  const raw = readJson<{ k: Hex }>(join(secretsDir, 'quorum_k.local.json'), { k: '0x' as Hex })
  if (raw.k === '0x') {
    const k = generatePrivateKey()
    writeJson(join(secretsDir, 'quorum_k.local.json'), { k })
    return hexToBytes(k)
  }
  return hexToBytes(raw.k)
}

/** Step 2: sample decoy accounts from the top-50 feature distribution, merge and shuffle. */
function accounts() {
  const n = Number(flag('n') ?? (org === 'a' ? 10 : 5))
  const base = readJson<Account[]>(join(outDir, `accounts-${org}.json`))
  const top = [...base].sort((x, y) => y.balanceUsd - x.balanceUsd).slice(0, 50)
  const r = rng(Number(process.env.DECOY_SEED ?? Date.now() % 2 ** 31))
  const used = new Set(base.map((a) => a.userId))
  const made: Account[] = []
  for (let i = 0; i < n; i++) {
    // bootstrap a top-50 account, jitter its balance by +-25% so no copy is exact
    const src = top[Math.floor(r.next() * top.length)]!
    const a = makeAccount(org, freshUserId(org, r, used), r, src.balanceUsd * (0.75 + r.next() * 0.5))
    a.regDays = src.regDays * (0.8 + r.next() * 0.4)
    a.activity = src.activity * (0.8 + r.next() * 0.4)
    made.push(a)
  }
  const all = shuffle([...base, ...made], r.next)
  writeJson(join(outDir, `all-accounts-${org}.json`), all)
  const f = loadDecoys()
  f[org]!.accounts = made.map((a) => ({ userId: a.userId }))
  writeJson(decoyPath, f)
  console.log(
    `decoy accounts: ${made.length} mixed into ${all.length} (org ${org}); ids only in secrets/decoys.local.json`,
  )
}

/** Step 7: decoy EOA (looks like a legacy hot wallet) + 2 decoy recipient addresses. */
async function wallets() {
  const d = loadDeployment()
  const c = clients(d, need('SEEDER_PRIVATE_KEY') as Hex)
  const sql = db()
  const schema = org === 'a' ? 'exchange_a' : 'exchange_b'
  const f = loadDecoys()
  const enc = need(`HOT_WALLET_ENC_KEY_${ORG}`) as Hex
  const taken = await takenLabels(sql, schema)
  if (f[org]!.wallets.length === 0) {
    const pk = generatePrivateKey()
    f[org]!.wallets.push({
      label: randomLabel(HOT_PREFIXES, taken),
      address: privateKeyToAccount(pk).address,
      privateKey: pk,
      floorWei: '0',
      funded: false,
    })
  }
  if (f[org]!.addresses.length === 0) {
    for (let i = 0; i < 2; i++) {
      const label = randomLabel(WHITELIST_PREFIXES, taken)
      const pk = generatePrivateKey()
      f[org]!.addresses.push({ label, address: privateKeyToAccount(pk).address, privateKey: pk })
    }
  }
  writeJson(decoyPath, f)
  for (const w of f[org]!.wallets) {
    if (!w.funded) {
      await send(c, { address: d.faucet, abi: FaucetAbi, functionName: 'drip', args: [d.qUSD, w.address, 50_000_000n] })
      const tx = await c.wallet!.sendTransaction({
        account: c.account!,
        chain: c.pub.chain,
        to: w.address,
        value: parseEther('0.01'),
      })
      await c.pub.waitForTransactionReceipt({ hash: tx })
      w.funded = true
      w.floorWei = parseEther('0.01').toString() // decoys only receive: balance never goes below this
      writeJson(decoyPath, f)
    }
    await sql`insert into ${sql(`${schema}.hot_wallets`)} (label, chain, address, kind, private_key_enc)
              values (${w.label}, 'base-sepolia', ${w.address}, 'eoa', ${encryptKey(enc, w.privateKey)})
              on conflict (label) do nothing`
  }
  await rewriteWhitelist(sql, schema, f[org]!.addresses)
  await sql.end()
  console.log(`decoy wallets: ${f[org]!.wallets.length}, decoy addresses: ${f[org]!.addresses.length} (org ${org})`)
}

/** Registers traps (quorum_index), DECOY_TAGS / PATROL_DECOYS (workflows/.env) and the trap config. */
async function register() {
  const d = loadDeployment()
  const sql = db()
  const k = quorumK()
  const salt = need(`ORG_SALT_${ORG}`) as Hex
  const f = loadDecoys()
  const orgId = ORGS[org]
  const traps: { kind: string; label: string; ref: string }[] = []
  for (const a of f[org]!.accounts) {
    a.userIdHash = userIdHash(salt, a.userId)
    traps.push({ kind: 'account', label: `acct-${a.userIdHash.slice(2, 8)}`, ref: a.userIdHash })
  }
  for (const w of f[org]!.wallets) {
    traps.push({ kind: 'wallet_erc20', label: w.label, ref: w.address })
    traps.push({ kind: 'wallet_native', label: w.label, ref: w.address })
  }
  for (const a of f[org]!.addresses) traps.push({ kind: 'address', label: a.label, ref: a.address })
  traps.push({ kind: 'threshold', label: 'fake-large-withdrawal', ref: 'risk_config.large_withdrawal_threshold' })
  for (const t of traps) {
    await sql`insert into quorum_index.traps (org_id, label, kind, chain, ref) values (${orgId}, ${t.label}, ${t.kind}, 'base-sepolia', ${t.ref})
              on conflict (org_id, kind, ref) do nothing`
  }
  writeJson(decoyPath, f)
  await sql.end()

  // Tags for both orgs go into one DECOY_TAGS secret (8 bytes each, max ~128 per 2 KB secret).
  const all = readJson<DecoyFile>(decoyPath)
  const tags: Hex[] = []
  const patrol: { a: string; o: string; f: string }[] = []
  for (const [o, v] of Object.entries(all)) {
    for (const a of v.accounts) if (a.userIdHash) tags.push(decoyTag(k, 'acct', a.userIdHash))
    for (const a of v.addresses) tags.push(decoyTag(k, 'addr', a.address))
    for (const w of v.wallets) patrol.push({ a: w.address, o: ORGS[o as 'a' | 'b'], f: w.floorWei })
  }
  const kHex = readJson<{ k: Hex }>(join(secretsDir, 'quorum_k.local.json')).k
  upsertEnv(join(repoRoot, 'workflows', '.env'), {
    QUORUM_K: kHex,
    DECOY_TAGS: packTags(tags),
    PATROL_DECOYS: JSON.stringify(patrol),
  })
  genWorkflowConfigs(d)
  console.log(`registered ${traps.length} traps (org ${org}); ${tags.length} tags; workflow configs regenerated`)
}

/**
 * Phase 5 commit (35_phase5.md 5.1): salted leaves for every decoy account and wallet, padded with random
 * filler leaves to a power of two (>= 16) so the root hides the count. Proofs go to the workflow configs;
 * the root goes on chain at deploy (DECOY_ROOT_*) or later through ConfigTimelock.setRoot.
 */
function commit() {
  const d = loadDeployment()
  const k = quorumK()
  const f = loadDecoys()
  const entries: { ident: Hex; set: (i: number, path: Hex[]) => void }[] = []
  for (const a of f[org]!.accounts) {
    if (!a.userIdHash) throw new Error('run register first (userIdHash missing)')
    entries.push({ ident: a.userIdHash, set: (i, path) => Object.assign(a, { i, path }) })
  }
  for (const w of f[org]!.wallets) {
    entries.push({
      ident: `0x${w.address.slice(2).toLowerCase().padStart(64, '0')}` as Hex,
      set: (i, path) => Object.assign(w, { i, path }),
    })
  }
  const size = Math.max(16, nextPow2(entries.length))
  const leaves: Hex[] = entries.map((e, i) => decoyLeaf(d.chainId, e.ident, decoySalt(k, i)))
  while (leaves.length < size) leaves.push(generatePrivateKey()) // random filler leaves
  const tree = buildTree(leaves)
  entries.forEach((e, i) => {
    e.set(i, tree.proofs[i]!)
  })
  Object.assign(f[org]!, { root: { root: tree.root, leafCount: size } })
  writeJson(decoyPath, f)
  upsertEnv(join(repoRoot, 'contracts', '.env'), {
    [`DECOY_ROOT_${ORG}`]: tree.root,
    [`DECOY_LEAVES_${ORG}`]: String(size),
  })
  genWorkflowConfigs(d)
  console.log(`committed ${entries.length} decoys in ${size} leaves (org ${org}); root ${tree.root}`)
  console.log(
    'fresh deploy: DECOY_ROOT_* is in contracts/.env. Existing deploy: queue ConfigTimelock -> DecoyCommit.setRoot.',
  )
}

/** Life traces: ordinary addresses occasionally send SMALL amounts INTO the decoy wallet. Never out. */
async function life() {
  const d = loadDeployment()
  const c = clients(d, need('SEEDER_PRIVATE_KEY') as Hex)
  const f = loadDecoys()
  for (const w of f[org]!.wallets) {
    const amt = BigInt(1_000_000 + Math.floor(Math.random() * 4_000_000)) // 1 to 5 qUSD, kept small on purpose
    await send(c, { address: d.faucet, abi: FaucetAbi, functionName: 'drip', args: [d.qUSD, w.address, amt] })
    console.log(`life trace into ${w.label}: ${amt}`)
  }
}

function upsertEnv(path: string, kv: Record<string, string>) {
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {}
  for (const [key, val] of Object.entries(kv)) {
    const line = `${key}=${val}`
    text = new RegExp(`^${key}=.*$`, 'm').test(text)
      ? text.replace(new RegExp(`^${key}=.*$`, 'm'), line)
      : `${text}${text.endsWith('\n') || !text ? '' : '\n'}${line}\n`
  }
  writeFileSync(path, text)
}

switch (cmd) {
  case 'accounts':
    accounts()
    break
  case 'wallets':
    await wallets()
    break
  case 'register':
    await register()
    break
  case 'life':
    await life()
    break
  case 'commit':
    commit()
    break
  case 'configs':
    genWorkflowConfigs(loadDeployment())
    break
  default:
    console.log('usage: decoy-admin <accounts|wallets|register|commit|life|configs> [--org a|b]')
}

// Exchange A/B fake backend (the attack target). It forwards and executes; it never judges.
// It must not import any decoy list or Quorum decision logic (CLAUDE.md rule 1, D34).
import { requestId, txHash } from '@quorum/shared'
import type { Context, Next } from 'hono'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { type Address, erc20Abi, type Hex } from 'viem'
import { abis, pub, writeAndWait } from './chain'
import { audit, sql, T } from './db'
import { deployment, env, ORG, ORG_ID, org } from './env'
import { parseProbeBody, toAttackerHotWallet } from './hot-wallet-view'
import { signProbe } from './probe'
import { startWorkers } from './workers'

const app = new Hono()
// Public user routes only; admin routes stay same-origin.
app.use('/users/*', cors())
app.use('/withdrawals', cors())
app.use('/withdrawals/*', cors())

app.get('/health', (c) => c.json({ ok: true, org: ORG }))

// ---------- user routes ----------
app.get('/users/:userId', async (c) => {
  const [u] =
    await sql`select user_id, user_id_hash, display_name from ${T('users')} where user_id = ${c.req.param('userId')}`
  if (!u) return c.json({ error: 'not found' }, 404)
  const [n] =
    await sql`select coalesce(max(nonce), 0) + 1 as next from ${T('withdrawals')} where user_id = ${u.user_id}`
  return c.json({
    ...u,
    nextNonce: String(n?.next ?? 1),
    vault: org.hotVault,
    orgId: ORG_ID,
    chainId: deployment.chainId,
    requestBoard: deployment.requestBoard,
  })
})

type WithdrawalBody = {
  userId: string
  token: Address
  to: Address
  amount: string
  nonce: string
  deadline: string
  signature: Hex
  intent: Record<string, string>
}

async function insertWithdrawal(b: WithdrawalBody, userIdHash: string, source: string) {
  const id = crypto.randomUUID()
  const rid = requestId(ORG_ID, id)
  const vault = (b.intent.vault as Address) ?? org.hotVault
  const th = txHash({
    chainId: deployment.chainId,
    vault,
    requestId: rid,
    userIdHash: userIdHash as Hex,
    token: b.token,
    to: b.to,
    amount: BigInt(b.amount),
    nonce: BigInt(b.nonce),
    deadline: BigInt(b.deadline),
  })
  await sql`insert into ${T('withdrawals')} (id, user_id, user_id_hash, token, to_address, amount, nonce, deadline, request_id, tx_hash, vault, intent, user_sig, source)
            values (${id}, ${b.userId}, ${userIdHash}, ${b.token}, ${b.to}, ${b.amount}, ${b.nonce}, ${b.deadline}, ${rid}, ${th}, ${vault}, ${sql.json(b.intent)}, ${b.signature}, ${source})`
  return { id, requestId: rid, txHash: th }
}

app.post('/withdrawals', async (c) => {
  const b = (await c.req.json()) as WithdrawalBody
  const [u] = await sql`select user_id_hash from ${T('users')} where user_id = ${b.userId}`
  if (!u) return c.json({ error: 'unknown user' }, 404)
  // Business check only (enough balance on our own ledger), not a security decision.
  const res = await sql.begin(async (tx) => {
    const [bal] =
      await tx`select available from ${T('balances')} where user_id = ${b.userId} and token = ${b.token} for update`
    if (!bal || BigInt(bal.available) < BigInt(b.amount)) return null
    await tx`update ${T('balances')} set available = available - ${b.amount}, locked = locked + ${b.amount}, updated_at = now()
             where user_id = ${b.userId} and token = ${b.token}`
    return true
  })
  if (!res) return c.json({ error: 'insufficient balance' }, 400)
  return c.json(await insertWithdrawal(b, u.user_id_hash, 'user'))
})

app.get('/withdrawals/:id', async (c) => {
  const [w] = await sql`select id, status, case_display, request_id, tx_hash, execute_tx, created_at, updated_at
                        from ${T('withdrawals')} where id = ${c.req.param('id')}`
  return w ? c.json(w) : c.json({ error: 'not found' }, 404)
})

/** docs/47 3.4: relay a passkey registration (the user has no gas). The contract checks the signature. */
app.post('/keys/register', async (c) => {
  const b = (await c.req.json()) as { userIdHash: Hex; key: Address; deadline: string; sig: Hex }
  try {
    const hash = await writeAndWait({
      address: deployment.keyRegistry,
      abi: abis.KeyRegistryAbi,
      functionName: 'register',
      args: [b.userIdHash, b.key, BigInt(b.deadline), b.sig],
    })
    return c.json({ ok: true, tx: hash })
  } catch (e) {
    return c.json({ error: String(e).slice(0, 200) }, 400)
  }
})

/** docs/47 3.3: relay the user's CancelWithdrawal signature (the contract checks it; we only pay gas). */
app.post('/withdrawals/:id/cancel', async (c) => {
  const [w] = await sql`select id, tx_hash from ${T('withdrawals')} where id = ${c.req.param('id')}`
  if (!w) return c.json({ error: 'not found' }, 404)
  const b = (await c.req.json()) as { deadline: string; sig: Hex }
  try {
    const hash = await writeAndWait({
      address: org.receiver,
      abi: abis.QuorumReceiverAbi,
      functionName: 'userCancelVerdict',
      args: [w.tx_hash as Hex, BigInt(b.deadline), b.sig],
    })
    await sql`update ${T('withdrawals')} set status = 'failed', last_error = 'cancelled by user', updated_at = now() where id = ${w.id}`
    return c.json({ ok: true, tx: hash })
  } catch (e) {
    return c.json({ error: String(e).slice(0, 200) }, 400)
  }
})

// ---------- admin routes (the stolen credential; kept on purpose as attack entry points) ----------
async function admin(c: Context, next: Next) {
  if (c.req.header('authorization') !== `Bearer ${env.adminToken}`) return c.json({ error: 'unauthorized' }, 401)
  await audit('admin', `${c.req.method} ${c.req.path}`, {})
  await next()
}
app.use('/admin/*', admin)

app.get('/admin/risk-config', async (c) => c.json(await sql`select key, value from ${T('risk_config')} order by key`))

app.get('/admin/hot-wallets', async (c) => {
  const rows = await sql`select label, chain, address, kind, status from ${T('hot_wallets')} order by label`
  const balances = await pub.multicall({
    contracts: rows.map((r) => ({
      address: deployment.qUSD,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [r.address as Address],
    })),
    allowFailure: true,
  })
  return c.json(
    rows.map((r, i) => {
      const read = balances[i]
      const balance = read?.status === 'success' ? read.result.toString() : '0'
      return toAttackerHotWallet({
        label: r.label,
        chain: r.chain,
        address: r.address,
        kind: r.kind,
        status: r.status,
        balance,
      })
    }),
  )
})

/** Backend signs a 1 qUSD probe. The key does not leave this process. */
app.post('/admin/hot-wallets/transfer', async (c) => {
  try {
    const body = parseProbeBody(await c.req.json())
    const tx = await signProbe(body.address as Address, body.to as Address, body.amount)
    return c.json({ tx, from: body.address, to: body.to, amount: body.amount.toString() })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'transfer failed'
    return c.json({ error: message }, 400)
  }
})

app.get('/admin/whitelist', async (c) =>
  c.json(await sql`select label, address, chain from ${T('whitelist_addresses')} order by label`),
)

app.get('/admin/audit-log', async (c) => c.json(await sql`select * from ${T('audit_log')} order by id desc limit 200`))
app.delete('/admin/audit-log', async (c) => {
  const r = await sql`delete from ${T('audit_log')}`
  return c.json({ deleted: r.count })
})

/** Any user, any address, caller-supplied signature. Bypasses the balance ledger. */
app.post('/admin/withdrawals', async (c) => {
  const b = (await c.req.json()) as WithdrawalBody & { userIdHash?: string }
  let uidHash = b.userIdHash
  if (!uidHash) {
    const [u] = await sql`select user_id_hash from ${T('users')} where user_id = ${b.userId}`
    uidHash = u?.user_id_hash
  }
  if (!uidHash) return c.json({ error: 'unknown user' }, 404)
  return c.json(await insertWithdrawal(b, uidHash, 'admin'))
})

/** Registers any key for any userIdHash (attack entry point; the chain decides). */
app.post('/admin/register-key', async (c) => {
  const b = (await c.req.json()) as { userIdHash: Hex; key: Address; deadline: string; sig: Hex }
  const hash = await writeAndWait({
    address: deployment.keyRegistry,
    abi: abis.KeyRegistryAbi,
    functionName: 'register',
    args: [b.userIdHash, b.key, BigInt(b.deadline), b.sig],
  })
  return c.json({ tx: hash })
})

if (process.env.NO_WORKERS !== '1') startWorkers()
console.log(`exchange-api org=${ORG} on :${env.port}`)
export default { port: env.port, fetch: app.fetch }

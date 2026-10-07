// notifier: tells the user what the chain says about their withdrawals, independent of the exchange app
// (docs/47 3.5). Reads only public chain events. Delivery: NOTIFY_WEBHOOK_URL (team channel) and, when
// DATABASE_URL is set, a per-user URL from quorum_index.notify_channels (role notifier_svc: that table only).
// Starts at the latest block unless NOTIFY_FROM_BLOCK is set, so a restart does not replay old news.
import { db, loadDeployment } from '@quorum/offchain'
import { QuorumReceiverAbi, QuorumVaultAbi, RequestBoardAbi } from '@quorum/shared'
import { type Address, createPublicClient, defineChain, type Hex, http } from 'viem'
import { type Ev, type Note, notificationsFor, type Req } from './compose'

const d = loadDeployment()
const RPC = process.env.RPC_URL ?? (d.chainId === 31337 ? 'http://127.0.0.1:8545' : 'https://sepolia.base.org')
const chain = defineChain({
  id: d.chainId,
  name: 'quorum',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
})
const pub = createPublicClient({ chain, transport: http(RPC) })
const sql = process.env.DATABASE_URL ? db() : undefined
const webhook = process.env.NOTIFY_WEBHOOK_URL
const orgs = [d.orgA, d.orgB].filter(Boolean)
const tokenInfo = (t: Address) =>
  t.toLowerCase() === d.qETH.toLowerCase() ? { symbol: 'qETH', decimals: 18 } : { symbol: 'qUSD', decimals: 6 }

const reqs = new Map<Hex, Req>()
const seen = new Set<string>()
let cursor = process.env.NOTIFY_FROM_BLOCK ? BigInt(process.env.NOTIFY_FROM_BLOCK) : await pub.getBlockNumber()

async function deliver(n: Note) {
  const key = `${n.txHash}:${n.kind}`
  if (seen.has(key)) return
  seen.add(key)
  console.log(`notify ${n.kind} ${n.txHash.slice(0, 10)}: ${n.text}`)
  const targets = webhook ? [webhook] : []
  if (sql) {
    const rows = await sql`select url from quorum_index.notify_channels where user_id_hash = ${n.userIdHash}`
    for (const r of rows) targets.push(r.url as string)
  }
  for (const url of targets) {
    try {
      await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(n) })
    } catch (e) {
      console.log(`notify: delivery to ${new URL(url).host} failed: ${String(e).slice(0, 100)}`)
    }
  }
}

async function tick() {
  const latest = await pub.getBlockNumber()
  if (latest < cursor) return
  const range = { fromBlock: cursor, toBlock: latest }
  const evs: Ev[] = []
  for (const l of await pub.getContractEvents({
    address: d.requestBoard,
    abi: RequestBoardAbi,
    eventName: 'WithdrawalRequested',
    ...range,
  })) {
    const { request, intent } = l.args
    if (request && intent)
      reqs.set(request.txHash, {
        txHash: request.txHash,
        userIdHash: intent.userIdHash,
        to: intent.to,
        amount: intent.amount,
        token: intent.token,
      })
  }
  for (const o of orgs) {
    const at = { address: o!.receiver as Address, abi: QuorumReceiverAbi, ...range }
    for (const l of await pub.getContractEvents({ ...at, eventName: 'VerdictRecorded' })) {
      const txHash = l.args.txHash as Hex
      const v = (await pub.readContract({
        address: at.address,
        abi: QuorumReceiverAbi,
        functionName: 'verdictOf',
        args: [txHash],
      })) as {
        decision: number
        notBefore: bigint
      }
      evs.push({ kind: 'verdict', txHash, decision: Number(v.decision), notBefore: v.notBefore })
    }
    for (const l of await pub.getContractEvents({ ...at, eventName: 'VerdictHeld' }))
      evs.push({ kind: 'held', txHash: l.args.txHash as Hex, until: l.args.until as bigint })
    for (const l of await pub.getContractEvents({ ...at, eventName: 'UserCancelled' }))
      evs.push({ kind: 'userCancelled', txHash: l.args.txHash as Hex })
    for (const l of await pub.getContractEvents({ ...at, eventName: 'VerdictCancelled' }))
      evs.push({ kind: 'officerCancelled', txHash: l.args.txHash as Hex })
    for (const vault of [o!.hotVault, o!.warmVault] as Address[])
      for (const l of await pub.getContractEvents({
        address: vault,
        abi: QuorumVaultAbi,
        eventName: 'Executed',
        ...range,
      }))
        evs.push({ kind: 'paid', txHash: l.args.txHash as Hex })
  }
  const now = (await pub.getBlock()).timestamp
  for (const n of notificationsFor(reqs, evs, now, tokenInfo)) await deliver(n)
  cursor = latest + 1n
}

if (process.argv.includes('--once')) {
  await tick()
} else {
  const every = Number(process.env.NOTIFY_INTERVAL_MS ?? 10_000)
  for (;;) {
    try {
      await tick()
    } catch (e) {
      console.log(`notifier tick failed: ${String(e).slice(0, 200)}`)
    }
    await Bun.sleep(every)
  }
}

// keeper: sends approved withdrawals once they are due, so a delayed APPROVE pays out even when the
// exchange backend never comes back (docs/47 3.1). Reads only the chain; no database, no decoy list.
// KEEPER_PRIVATE_KEY pays gas. RPC_URL overrides the default RPC (e.g. a local fork). --once: one pass.
import { clients, loadDeployment, need, send } from '@quorum/offchain'
import { QuorumReceiverAbi, QuorumVaultAbi, RequestBoardAbi } from '@quorum/shared'
import { type Address, BaseError, ContractFunctionRevertedError, type Hex } from 'viem'
import { type Candidate, isDue, RETRY } from './due'

const d = loadDeployment()
const c = clients(d, need('KEEPER_PRIVATE_KEY') as Hex)
const STEP = 5_000n
const receiverOf = new Map<string, Address>(
  [d.orgA, d.orgB].filter(Boolean).map((o) => [String(o!.orgId).toLowerCase(), o!.receiver as Address]),
)
const open = new Map<Hex, Candidate & { receiver: Address }>()
let cursor = BigInt(process.env.KEEPER_FROM_BLOCK ?? d.resetBlock ?? d.startBlock)

async function scan() {
  const latest = await c.pub.getBlockNumber()
  while (cursor <= latest) {
    const to = cursor + STEP - 1n > latest ? latest : cursor + STEP - 1n
    const logs = await c.pub.getContractEvents({
      address: d.requestBoard,
      abi: RequestBoardAbi,
      eventName: 'WithdrawalRequested',
      fromBlock: cursor,
      toBlock: to,
    })
    for (const l of logs) {
      const { requestId, request, intent } = l.args
      if (!requestId || !request || !intent) continue
      const receiver = receiverOf.get(request.orgId.toLowerCase())
      if (!receiver) continue
      open.set(request.txHash, {
        txHash: request.txHash,
        receiver,
        vault: intent.vault,
        vaultTx: {
          requestId,
          userIdHash: intent.userIdHash,
          token: intent.token,
          to: intent.to,
          amount: intent.amount,
          nonce: intent.nonce,
          deadline: intent.deadline,
        },
      })
    }
    cursor = to + 1n
  }
}

function revertName(e: unknown): string | undefined {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError)
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName
  }
  return undefined
}

async function tick(): Promise<number> {
  await scan()
  const now = (await c.pub.getBlock()).timestamp
  let sent = 0
  for (const [h, cand] of [...open.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [v, held] = await Promise.all([
      c.pub.readContract({ address: cand.receiver, abi: QuorumReceiverAbi, functionName: 'verdictOf', args: [h] }),
      c.pub.readContract({ address: cand.receiver, abi: QuorumReceiverAbi, functionName: 'heldUntil', args: [h] }),
    ])
    const vs = v as { decision: number; used: boolean; released: boolean; notBefore: bigint; expiresAt: bigint }
    const what = isDue(cand, { ...vs, heldUntil: held as bigint }, now)
    if (what === 'drop') open.delete(h)
    if (what !== 'send') continue
    try {
      const tx = await send(c, {
        address: cand.vault,
        abi: QuorumVaultAbi,
        functionName: 'execute',
        args: [cand.vaultTx],
      })
      console.log(`keeper paid ${h.slice(0, 10)} tx=${tx}`)
      open.delete(h)
      sent++
    } catch (e) {
      const name = revertName(e)
      if (!name || !RETRY.has(name)) open.delete(h)
      console.log(`keeper ${h.slice(0, 10)} not sent: ${name ?? String(e).slice(0, 120)}`)
    }
  }
  return sent
}

if (process.argv.includes('--once')) {
  console.log(`keeper once: sent ${await tick()}`)
} else {
  const every = Number(process.env.KEEPER_INTERVAL_MS ?? 15_000)
  for (;;) {
    try {
      await tick()
    } catch (e) {
      console.log(`keeper tick failed: ${String(e).slice(0, 200)}`)
    }
    await Bun.sleep(every)
  }
}

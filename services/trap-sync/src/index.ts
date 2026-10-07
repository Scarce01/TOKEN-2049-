// trap-sync: marks traps tripped for the Console (trap_sync_svc). Tightening never depends on it.
// Uses a direct RPC (not the shared proxy) so decoy addresses never land in proxy logs.
import { clients, db, loadDeployment } from '@quorum/offchain'
import { QuorumReceiverAbi, RequestBoardAbi } from '@quorum/shared'
import { type Hex, parseAbiItem } from 'viem'
import { matchTrips, type Trap } from './match'

const d = loadDeployment()
const { pub } = clients(d)
const sql = db()
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const STEP = 500n

let cursor = BigInt(process.env.TRAP_SYNC_FROM_BLOCK ?? d.resetBlock ?? d.startBlock)
const lastNative = new Map<string, bigint>()

async function tick() {
  const traps = (await sql`select id, org_id, kind, ref, status from quorum_index.traps`) as unknown as Trap[]
  const latest = await pub.getBlockNumber()
  const walletAddrs = traps.filter((t) => t.kind === 'wallet_erc20').map((t) => t.ref as Hex)
  const nativeTraps = traps.filter((t) => t.kind === 'wallet_native' && t.status !== 'tripped')

  while (cursor <= latest) {
    const to = cursor + STEP - 1n > latest ? latest : cursor + STEP - 1n
    const [transfers, reqs, tight] = await Promise.all([
      walletAddrs.length
        ? pub.getLogs({
            address: [d.qUSD, d.qETH],
            event: TRANSFER,
            args: { from: walletAddrs },
            fromBlock: cursor,
            toBlock: to,
          })
        : Promise.resolve([]),
      pub.getContractEvents({
        address: d.requestBoard,
        abi: RequestBoardAbi,
        eventName: 'WithdrawalRequested',
        fromBlock: cursor,
        toBlock: to,
      }),
      pub.getContractEvents({
        address: [d.orgA.receiver, d.orgB.receiver],
        abi: QuorumReceiverAbi,
        eventName: 'Tightened',
        fromBlock: cursor,
        toBlock: to + 200n > latest ? latest : to + 200n,
      }),
    ])
    const trips = matchTrips(
      traps,
      d.chainId,
      transfers.map((l) => ({
        from: l.args.from as Hex,
        txHash: l.transactionHash,
        logIndex: l.logIndex,
        block: l.blockNumber,
      })),
      reqs.map((l) => {
        const a = l.args as { orgId: Hex; requestId: Hex; userIdHash: Hex; request: { to: Hex } }
        return {
          orgId: a.orgId,
          requestId: a.requestId,
          userIdHash: a.userIdHash,
          to: a.request.to,
          txHash: l.transactionHash,
          block: l.blockNumber,
        }
      }),
      tight.map((l) => ({ caseId: (l.args as { caseId: Hex }).caseId, block: l.blockNumber })),
      [],
    )
    await applyTrips(trips)
    cursor = to + 1n
  }

  // Native decoys: balance drop between ticks; find the decoy's own tx in the drop block.
  if (nativeTraps.length) {
    const bals = await Promise.all(
      nativeTraps.map((t) => pub.getBalance({ address: t.ref as Hex, blockNumber: latest })),
    )
    const drops: { address: Hex; block: bigint; txHash: Hex | null }[] = []
    for (const [i, t] of nativeTraps.entries()) {
      const prev = lastNative.get(t.ref)
      const now = bals[i]!
      if (prev !== undefined && now < prev) {
        const blk = await pub.getBlock({ blockNumber: latest, includeTransactions: true })
        const tx = blk.transactions.find((x) => x.from.toLowerCase() === t.ref.toLowerCase())
        drops.push({ address: t.ref as Hex, block: latest, txHash: tx?.hash ?? null })
      }
      lastNative.set(t.ref, now)
    }
    if (drops.length) {
      const tight = await pub.getContractEvents({
        address: [d.orgA.receiver, d.orgB.receiver],
        abi: QuorumReceiverAbi,
        eventName: 'Tightened',
        fromBlock: latest > 200n ? latest - 200n : 0n,
        toBlock: latest,
      })
      await applyTrips(
        matchTrips(
          nativeTraps,
          d.chainId,
          [],
          [],
          tight.map((l) => ({ caseId: (l.args as { caseId: Hex }).caseId, block: l.blockNumber })),
          drops,
        ),
      )
    }
  }
  await sql`update quorum_index.traps set last_checked = now()`
}

async function applyTrips(trips: ReturnType<typeof matchTrips>) {
  for (const t of trips) {
    const blk = await pub.getBlock({ blockNumber: t.block })
    await sql`update quorum_index.traps set status = 'tripped', tripped_tx = ${t.trippedTx}, case_id = ${t.caseId},
              tripped_at = to_timestamp(${Number(blk.timestamp)}) where id = ${t.id} and status <> 'tripped'`
    // log only the trap row id and case, never the decoy address (rule 2)
    console.log(`trap ${t.id} tripped case=${t.caseId?.slice(0, 10) ?? 'pending'}`)
  }
}

console.log('trap-sync started')
for (;;) {
  await tick().catch((e) => console.error('tick', String(e).slice(0, 200)))
  await Bun.sleep(4000)
}

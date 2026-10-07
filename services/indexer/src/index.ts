// Every event of our contracts -> chain_events; withdrawal / trap cases derived from them.
// Reorgs and backfill are Ponder's job.

import { ponder } from 'ponder:registry'
import { cases, chainEvents } from 'ponder:schema'
import {
  ColdVaultAbi,
  ConfigTimelockAbi,
  caseIdWithdrawal,
  DepositVaultAbi,
  KeyRegistryAbi,
  QuorumReceiverAbi,
  QuorumVaultAbi,
  RequestBoardAbi,
  ThreatRegistryAbi,
} from '@quorum/shared'
import type { Abi, Hex } from 'viem'

const CONTRACTS: Record<string, Abi> = {
  RequestBoard: RequestBoardAbi,
  KeyRegistry: KeyRegistryAbi,
  DepositVault: DepositVaultAbi,
  ConfigTimelock: ConfigTimelockAbi,
  QuorumReceiver: QuorumReceiverAbi,
  QuorumVault: QuorumVaultAbi,
  ColdVault: ColdVaultAbi,
  ThreatRegistry: ThreatRegistryAbi,
}

const jsonSafe = (v: unknown): unknown =>
  typeof v === 'bigint'
    ? v.toString()
    : Array.isArray(v)
      ? v.map(jsonSafe)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)]))
        : v

type Ev = {
  args: Record<string, unknown>
  log: { address: Hex; logIndex: number }
  block: { number: bigint; timestamp: bigint }
  transaction: { hash: Hex }
}
// biome-ignore lint/suspicious/noExplicitAny: Ponder context typing across a dynamic registration loop
type Ctx = { db: any; chain: { id: number } }

for (const [name, abi] of Object.entries(CONTRACTS)) {
  for (const item of abi) {
    if (item.type !== 'event') continue
    ponder.on(
      // biome-ignore lint/suspicious/noExplicitAny: dynamic event key
      `${name}:${item.name}` as any,
      (async ({ event, context }: { event: Ev; context: Ctx }) => {
        const a = event.args
        const caseId = (a.caseId as Hex | undefined) ?? caseForRequest(name, item.name, event)
        await context.db
          .insert(chainEvents)
          .values({
            chainId: context.chain.id,
            blockNumber: event.block.number,
            blockTime: event.block.timestamp,
            txHash: event.transaction.hash,
            logIndex: event.log.logIndex,
            contract: event.log.address,
            contractName: name,
            event: item.name,
            caseId: caseId ?? null,
            args: jsonSafe(a),
          })
          .onConflictDoNothing()
        await deriveCase(name, item.name, event, context, caseId)
        // biome-ignore lint/suspicious/noExplicitAny: see above
      }) as any,
    )
  }
}

function caseForRequest(contract: string, ev: string, e: Ev): Hex | undefined {
  if (contract === 'RequestBoard' && ev === 'WithdrawalRequested') {
    return caseIdWithdrawal(e.args.orgId as Hex, e.args.requestId as Hex)
  }
  return undefined
}

async function deriveCase(contract: string, ev: string, e: Ev, ctx: Ctx, caseId?: Hex) {
  const t = e.block.timestamp
  if (contract === 'RequestBoard' && ev === 'WithdrawalRequested' && caseId) {
    // resubmit re-emits the same requestId: one case per requestId
    const req = e.args.request as { txHash: Hex }
    await ctx.db
      .insert(cases)
      .values({
        caseId,
        orgId: e.args.orgId as Hex,
        kind: 'withdrawal',
        requestId: e.args.requestId as Hex,
        txHash: req.txHash,
        firstSeen: t,
        updatedAt: t,
      })
      .onConflictDoUpdate({ updatedAt: t })
  } else if (contract === 'QuorumReceiver' && ev === 'VerdictRecorded' && caseId) {
    await ctx.db
      .insert(cases)
      .values({
        caseId,
        kind: 'withdrawal',
        requestId: e.args.requestId as Hex,
        txHash: e.args.txHash as Hex,
        decision: Number(e.args.decision),
        publicReason: Number(e.args.publicReason),
        sealedReason: e.args.sealedReason as Hex,
        firstSeen: t,
        updatedAt: t,
      })
      .onConflictDoUpdate({
        decision: Number(e.args.decision),
        publicReason: Number(e.args.publicReason),
        sealedReason: e.args.sealedReason as Hex,
        updatedAt: t,
      })
  } else if (contract === 'QuorumReceiver' && ev === 'VerdictDowngraded') {
    // contract-side downgrade wins over what Cosign wrote (Console shows the contract result)
  } else if (contract === 'QuorumReceiver' && ev === 'Tightened' && caseId) {
    await ctx.db
      .insert(cases)
      .values({ caseId, kind: 'trap', firstSeen: t, updatedAt: t })
      .onConflictDoUpdate({ updatedAt: t })
  }
}

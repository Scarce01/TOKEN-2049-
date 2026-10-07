// Every event of our contracts -> chain_events; withdrawal / trap cases derived from them.
// Reorgs and backfill are Ponder's job.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ponder } from 'ponder:registry'
import { cases, chainEvents, snapshots } from 'ponder:schema'
import {
  ColdVaultAbi,
  ConfigTimelockAbi,
  caseIdWithdrawal,
  DecoyCommitAbi,
  DepositVaultAbi,
  KeyRegistryAbi,
  OfficerDeskAbi,
  PatrolStateAbi,
  QuorumReceiverAbi,
  QuorumVaultAbi,
  RequestBoardAbi,
  ThreatRegistryAbi,
} from '@quorum/shared'
import { type Abi, type Address, type Hex, parseAbi } from 'viem'

const CONTRACTS: Record<string, Abi> = {
  RequestBoard: RequestBoardAbi,
  KeyRegistry: KeyRegistryAbi,
  DepositVault: DepositVaultAbi,
  ConfigTimelock: ConfigTimelockAbi,
  QuorumReceiver: QuorumReceiverAbi,
  QuorumVault: QuorumVaultAbi,
  ColdVault: ColdVaultAbi,
  ThreatRegistry: ThreatRegistryAbi,
  OfficerDesk: OfficerDeskAbi, // was in the config but never handled, so its events were dropped
  PatrolState: PatrolStateAbi,
  DecoyCommit: DecoyCommitAbi,
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

// ---- per-org state snapshots (block filter "Snapshot", every PONDER_SNAPSHOT_EVERY blocks) ----

const dep = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', 'deployments', `${process.env.DEPLOY_NAME ?? 'base-sepolia'}.json`),
    'utf8',
  ),
)
type OrgJson = { receiver: Address; hotVault: Address; warmVault: Address; coldVault: Address }
const ORGS = Object.entries(dep as Record<string, unknown>)
  .filter(([k]) => /^org[A-Z]$/.test(k))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([k, v]) => ({ letter: k.slice(3), ...(v as OrgJson) }))
const TOKENS = { qUSD: dep.qUSD as Address, qETH: dep.qETH as Address }
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const
const receiverAbi = parseAbi([
  'function alert() view returns (uint8)',
  'function alertExpiresAt() view returns (uint64)',
  'function frozenUntil(address) view returns (uint64)',
])
const vaultAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function quota(address) view returns (uint256)',
  'function cap(address) view returns (uint256)',
])
const coldAbi = parseAbi(['function delay() view returns (uint64)'])
const erc20Abi = parseAbi(['function balanceOf(address) view returns (uint256)'])
const threatAbi = parseAbi(['function activeConfirmedCount() view returns (uint256)'])

ponder.on(
  // biome-ignore lint/suspicious/noExplicitAny: block filter key
  'Snapshot:block' as any,
  (async ({
    event,
    context,
  }: {
    event: { block: { number: bigint; timestamp: bigint } }
    // biome-ignore lint/suspicious/noExplicitAny: Ponder's client type is generated per config
    context: Ctx & { client: any }
  }) => {
    const calls: { address: Address; abi: Abi; functionName: string; args?: unknown[] }[] = [
      { address: dep.threatRegistry, abi: threatAbi, functionName: 'activeConfirmedCount' },
    ]
    for (const o of ORGS) {
      calls.push(
        { address: o.receiver, abi: receiverAbi, functionName: 'alert' },
        { address: o.receiver, abi: receiverAbi, functionName: 'alertExpiresAt' },
        { address: o.receiver, abi: receiverAbi, functionName: 'frozenUntil', args: [o.hotVault] },
        { address: o.receiver, abi: receiverAbi, functionName: 'frozenUntil', args: [o.warmVault] },
        { address: o.coldVault, abi: coldAbi, functionName: 'delay' },
      )
      for (const v of [o.hotVault, o.warmVault])
        for (const t of Object.values(TOKENS))
          for (const fn of ['balanceOf', 'quota', 'cap'])
            calls.push({ address: v, abi: vaultAbi, functionName: fn, args: [t] })
      // ColdVault has no balanceOf(token) view: ask the token for the vault's balance
      for (const t of Object.values(TOKENS))
        calls.push({ address: t, abi: erc20Abi, functionName: 'balanceOf', args: [o.coldVault] })
    }
    // allowFailure: one reverting view (cold balanceOf on some deployments) must not drop the snapshot
    let res: { status: string; result?: unknown }[]
    try {
      res = await context.client.multicall({
        contracts: calls,
        multicallAddress: MULTICALL3,
        retryEmptyResponse: false,
      })
    } catch (e) {
      // a node without state at this block (a fork loaded from a state dump, or a pruned public node) cannot
      // answer: skip this block's snapshot instead of retrying forever; events are still indexed
      if (/BlockOutOfRange|missing trie node|header not found|state.*not available/i.test(String(e))) return
      throw e
    }
    let i = 0
    const next = () => {
      const r = res[i++]!
      return r.status === 'success' ? (r.result as bigint | number) : 0n
    }
    const confirmed = Number(next())
    for (const o of ORGS) {
      const [alert, alertExp, hotF, warmF, delay] = [next(), next(), next(), next(), next()]
      const vaults: Record<string, Record<string, Record<string, string>>> = {}
      for (const tier of ['hot', 'warm']) {
        vaults[tier] = {}
        for (const t of Object.keys(TOKENS))
          vaults[tier][t] = { balance: String(next()), quota: String(next()), cap: String(next()) }
      }
      vaults.cold = { delay: { seconds: String(delay) } }
      for (const t of Object.keys(TOKENS)) vaults.cold[t] = { balance: String(next()) }
      await context.db
        .insert(snapshots)
        .values({
          chainId: context.chain.id,
          blockNumber: event.block.number,
          blockTime: event.block.timestamp,
          org: o.letter,
          alert: Number(alert),
          alertExpiresAt: BigInt(alertExp),
          hotFrozenUntil: BigInt(hotF),
          warmFrozenUntil: BigInt(warmF),
          activeConfirmed: confirmed,
          vaults,
        })
        .onConflictDoNothing()
    }
    // biome-ignore lint/suspicious/noExplicitAny: see above
  }) as any,
)

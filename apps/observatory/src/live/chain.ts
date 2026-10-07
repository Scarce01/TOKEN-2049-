// Live backend reads for the Quorum fork (this repo, apps/observatory). Public chain state only; decoy/trap data
// stays officer-only (CLAUDE.md rule 2) and is not read here. Addresses come from the repo's deployments
// file and event ABIs from packages/shared, so a redeploy or an interface change needs no edit here.
import { useEffect, useState } from 'react'
import { createPublicClient, formatUnits, http, parseAbi, parseEventLogs, type Address, type Hex, type Log } from 'viem'
import fork from '../deployment.json'
import { ColdVaultAbi, PatrolStateAbi, QuorumReceiverAbi, QuorumVaultAbi, ThreatRegistryAbi } from '../shared/abi'

export const RPC = (import.meta.env.VITE_RPC_URL as string) ?? (typeof location !== 'undefined' ? location.origin + '/rpc' : 'http://127.0.0.1:8545')
export const CHAIN_LABEL = fork.chainId === 84532 ? 'Base Sepolia fork' : `chain ${fork.chainId}`

/** Display names for the demo orgs; any other org in the deployment shows as "Org <letter>". */
const NAMES: Record<string, string> = { A: 'Bybit', B: 'Bitget' }

type OrgJson = { orgId: string; receiver: string; hotVault: string; warmVault: string; coldVault: string }
export type OrgRef = { letter: string; name: string; orgId: Hex; receiver: Address; hot: Address; warm: Address; cold: Address }
/** Every org in the deployment (orgA, orgB, ...): the network is not hardwired to two exchanges. */
export const ORGS: OrgRef[] = Object.entries(fork as unknown as Record<string, unknown>)
  .filter(([k]) => /^org[A-Z]$/.test(k))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([k, v]) => {
    const o = v as OrgJson
    const letter = k.slice(3)
    return { letter, name: NAMES[letter] ?? `Org ${letter}`, orgId: o.orgId as Hex, receiver: o.receiver as Address, hot: o.hotVault as Address, warm: o.warmVault as Address, cold: o.coldVault as Address }
  })
export const D = {
  chainId: fork.chainId,
  startBlock: BigInt(fork.startBlock),
  qUSD: fork.qUSD as Address,
  qETH: fork.qETH as Address,
  priceFeed: fork.priceFeed as Address,
  threatRegistry: fork.threatRegistry as Address,
  patrolState: fork.patrolState as Address,
}
const ORG_BY_ID = new Map(ORGS.map((o) => [o.orgId.toLowerCase(), o]))
const ORG_BY_ADDR = new Map(ORGS.flatMap((o) => [o.receiver, o.hot, o.warm, o.cold].map((a) => [a.toLowerCase(), o] as const)))
const TIER_BY_ADDR = new Map(ORGS.flatMap((o) => [[o.hot, 'hot'], [o.warm, 'warm'], [o.cold, 'cold']].map(([a, t]) => [a.toLowerCase(), t])))

// batch: one HTTP request per snapshot instead of ~50 (a slow fork otherwise piles up requests)
const client = createPublicClient({ transport: http(RPC, { batch: { batchSize: 100, wait: 10 } }) })

// one reverting view (e.g. cold vault balanceOf) must not take the whole snapshot offline
const safe = async <T,>(p: Promise<unknown>, d: T): Promise<T> => { try { return (await p) as T } catch { return d } }

const receiverAbi = parseAbi([
  'function alert() view returns (uint8)',
  'function alertExpiresAt() view returns (uint64)',
  'function frozenUntil(address) view returns (uint64)',
  'function mode() view returns (uint8)',
  'function lastPing() view returns (bytes32)',
])
const vaultAbi = parseAbi([
  'function quota(address) view returns (uint256)',
  'function cap(address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function hourCap(address) view returns (uint256)',
  'function dayCap(address) view returns (uint256)',
])
const coldAbi = parseAbi(['function delay() view returns (uint64)'])
const threatAbi = parseAbi(['function activeConfirmedCount() view returns (uint256)'])
const feedAbi = parseAbi(['function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)', 'function decimals() view returns (uint8)'])

export const ALERT = ['Normal', 'L1', 'L2', 'L3', 'CONFIRMED'] as const

export type TokenAmt = { qUSD: number; qETH: number }
export type LiveVault = {
  id: 'hot' | 'warm' | 'cold'
  address: Address
  balance: TokenAmt
  quota?: TokenAmt
  cap?: TokenAmt
  hourCap?: TokenAmt
  dayCap?: TokenAmt
  frozenUntil?: number
  coldDelayHours?: number
}
export type LiveOrg = OrgRef & {
  alert: number
  alertLabel: string
  alertExpiresAt: number
  mode: 'SIM' | 'PROD'
  /** Patrol ping note: the block number the last ping was anchored to (0 = never pinged) */
  lastPingBlock: number
  vaults: LiveVault[]
}
/** chainTime is the fork's latest block timestamp: freezes and expiries compare against it, not the wall clock. */
export type Live = { orgs: LiveOrg[]; activeConfirmed: number; block: number; chainTime: number; ethUsd: number; at: number }

const n6 = (x: bigint) => Number(formatUnits(x, 6))
const n18 = (x: bigint) => Number(formatUnits(x, 18))
const amt = (usd: bigint, eth: bigint): TokenAmt => ({ qUSD: n6(usd), qETH: n18(eth) })
export const usdOf = (a: TokenAmt, ethUsd: number) => a.qUSD + a.qETH * ethUsd

async function readOrg(o: OrgRef, block: bigint): Promise<LiveOrg> {
  const r = <T,>(fn: string, address: Address, args: unknown[], abi: unknown, d: T) =>
    safe<T>(client.readContract({ address, abi: abi as never, functionName: fn as never, args: args as never, blockNumber: block }), d)
  const tok = async (fn: string, v: Address) => amt(await r(fn, v, [D.qUSD], vaultAbi, 0n), await r(fn, v, [D.qETH], vaultAbi, 0n))
  const [alert, alertExp, hotFroze, warmFroze, mode, lastPing, coldDelay] = await Promise.all([
    r('alert', o.receiver, [], receiverAbi, 0),
    r('alertExpiresAt', o.receiver, [], receiverAbi, 0n),
    r('frozenUntil', o.receiver, [o.hot], receiverAbi, 0n),
    r('frozenUntil', o.receiver, [o.warm], receiverAbi, 0n),
    r('mode', o.receiver, [], receiverAbi, 1),
    r('lastPing', o.receiver, [], receiverAbi, '0x' as Hex),
    r('delay', o.cold, [], coldAbi, 0n),
  ])
  const [hotBal, hotQ, hotCap, hourCap, dayCap, warmBal, warmQ, warmCap, coldBal] = await Promise.all([
    tok('balanceOf', o.hot), tok('quota', o.hot), tok('cap', o.hot), tok('hourCap', o.hot), tok('dayCap', o.hot),
    tok('balanceOf', o.warm), tok('quota', o.warm), tok('cap', o.warm), tok('balanceOf', o.cold),
  ])
  return {
    ...o,
    alert: Number(alert),
    alertLabel: ALERT[Number(alert)] ?? 'Normal',
    alertExpiresAt: Number(alertExp),
    mode: Number(mode) === 0 ? 'PROD' : 'SIM',
    lastPingBlock: lastPing && lastPing !== '0x' ? Number(BigInt(lastPing)) : 0,
    vaults: [
      { id: 'hot', address: o.hot, balance: hotBal, quota: hotQ, cap: hotCap, hourCap, dayCap, frozenUntil: Number(hotFroze) },
      { id: 'warm', address: o.warm, balance: warmBal, quota: warmQ, cap: warmCap, frozenUntil: Number(warmFroze) },
      { id: 'cold', address: o.cold, balance: coldBal, coldDelayHours: Number(coldDelay) / 3600 },
    ],
  }
}

export async function readLive(): Promise<Live> {
  // every read pins the same block, so one snapshot is consistent
  const head = await client.getBlock()
  const [orgs, confirmed, round, dec] = await Promise.all([
    Promise.all(ORGS.map((o) => readOrg(o, head.number))),
    client.readContract({ address: D.threatRegistry, abi: threatAbi, functionName: 'activeConfirmedCount', blockNumber: head.number }),
    safe(client.readContract({ address: D.priceFeed, abi: feedAbi, functionName: 'latestRoundData', blockNumber: head.number }), [0n, 0n, 0n, 0n, 0n]),
    safe(client.readContract({ address: D.priceFeed, abi: feedAbi, functionName: 'decimals', blockNumber: head.number }), 8),
  ])
  const ethUsd = Number(formatUnits((round as readonly bigint[])[1] ?? 0n, Number(dec)))
  return { orgs, activeConfirmed: Number(confirmed), block: Number(head.number), chainTime: Number(head.timestamp), ethUsd, at: Date.now() }
}

// ---------------------------------------------------------------- event history

const EVENT_ABI = [...QuorumReceiverAbi, ...QuorumVaultAbi, ...ColdVaultAbi, ...PatrolStateAbi, ...ThreatRegistryAbi]
/** Events the security console shows; everything else in the logs is ignored. */
const SHOWN = new Set([
  'AlertSet', 'FreezeSet', 'Tightened', 'Ping', 'VerdictRecorded', 'ActionFailed', 'ActionStale',
  'Executed', 'QuotaZeroed', 'QuotaRefilled', 'TopUp', 'Swept', 'DelayRaised', 'DelayLowered',
  'ThreatAdded', 'AssetCheckpoint', 'PatrolStateUpdated', 'ThresholdCommitted', 'ThresholdRevealed',
])
export type ChainEvent = {
  name: string
  org?: OrgRef
  tier?: string
  args: Record<string, unknown>
  block: number
  time: number
  tx: string
  logIndex: number
}

let cache: { to: bigint; toHash?: Hex; events: ChainEvent[] } = { to: D.startBlock - 1n, events: [] }
const blockTime = new Map<string, number>() // by block hash: a fork reset reuses numbers, never hashes

/** Incremental: only new blocks are fetched. A reset or reorg (cached head hash changed) refetches all.
 * Calls share one in-flight read, so two pollers never append the same logs twice. */
let reading: Promise<ChainEvent[]> | null = null
export function readEvents(): Promise<ChainEvent[]> {
  reading ??= fetchEvents().finally(() => { reading = null })
  return reading
}
async function fetchEvents(): Promise<ChainEvent[]> {
  const head = await client.getBlock()
  if (cache.to >= D.startBlock) {
    const at = head.number >= cache.to ? await safe<{ hash: Hex | null } | null>(client.getBlock({ blockNumber: cache.to }), null) : null
    if (!at || at.hash !== cache.toHash) cache = { to: D.startBlock - 1n, events: [] }
  }
  if (head.number > cache.to) {
    const addresses = [...ORGS.flatMap((o) => [o.receiver, o.hot, o.warm, o.cold]), D.threatRegistry, D.patrolState]
    const logs = await client.getLogs({ address: addresses, fromBlock: cache.to + 1n, toBlock: head.number })
    const parsed = parseEventLogs({ abi: EVENT_ABI as never, logs: logs as Log[], strict: false }) as unknown as (Log & { eventName: string; args: Record<string, unknown> })[]
    const keep = parsed.filter((l) => SHOWN.has(l.eventName))
    const missing = [...new Set(keep.map((l) => l.blockHash!).filter((h) => !blockTime.has(h)))]
    await Promise.all(missing.map(async (h) => blockTime.set(h, Number((await client.getBlock({ blockHash: h })).timestamp))))
    const fresh = keep.map((l): ChainEvent => {
      const a = l.args
      const byId = typeof a.orgId === 'string' ? ORG_BY_ID.get(a.orgId.toLowerCase()) : typeof a.reporterOrg === 'string' ? ORG_BY_ID.get(a.reporterOrg.toLowerCase()) : undefined
      const byAddr = ORG_BY_ADDR.get(l.address.toLowerCase()) ?? (typeof a.vault === 'string' ? ORG_BY_ADDR.get(a.vault.toLowerCase()) : undefined)
      const tier = TIER_BY_ADDR.get(l.address.toLowerCase()) ?? (typeof a.vault === 'string' ? TIER_BY_ADDR.get(a.vault.toLowerCase()) : undefined)
      return { name: l.eventName, org: byId ?? byAddr, tier, args: a, block: Number(l.blockNumber), time: blockTime.get(l.blockHash!) ?? 0, tx: l.transactionHash!, logIndex: l.logIndex! }
    })
    const seen = new Set(cache.events.map((e) => `${e.tx}:${e.logIndex}`))
    cache = { to: head.number, toHash: head.hash, events: [...cache.events, ...fresh.filter((e) => !seen.has(`${e.tx}:${e.logIndex}`))] }
  }
  return cache.events
}

export type Case = { caseId: string; org?: OrgRef; block: number; time: number; tx: string; events: ChainEvent[] }
/** Group events into cases. A case is every event sharing a tx in which something carried a caseId
 * (the CRE report tx: Tightened/ReportProcessed carry the id, QuotaZeroed/FreezeSet/Swept/ThreatAdded share the tx). */
export function buildCases(events: ChainEvent[]): Case[] {
  const caseOfTx = new Map<string, string>()
  for (const e of events) if (typeof e.args.caseId === 'string') caseOfTx.set(e.tx, e.args.caseId as string)
  const byId = new Map<string, Case>()
  for (const e of events) {
    const cid = caseOfTx.get(e.tx)
    if (!cid) continue
    const c = byId.get(cid) ?? { caseId: cid, org: e.org, block: e.block, time: e.time, tx: e.tx, events: [] }
    c.events.push(e)
    if (!c.org && e.org) c.org = e.org
    if (e.block < c.block) { c.block = e.block; c.time = e.time; c.tx = e.tx }
    byId.set(cid, c)
  }
  return [...byId.values()].sort((a, b) => b.block - a.block)
}

/** Token amount of an event arg (qUSD 6 decimals, qETH 18). */
export function tokenAmount(token: unknown, raw: unknown): { sym: 'qUSD' | 'qETH' | '?'; value: number } {
  const t = String(token ?? '').toLowerCase()
  const v = typeof raw === 'bigint' ? raw : 0n
  if (t === D.qUSD.toLowerCase()) return { sym: 'qUSD', value: n6(v) }
  if (t === D.qETH.toLowerCase()) return { sym: 'qETH', value: n18(v) }
  return { sym: '?', value: Number(v) }
}

export type LiveState<T> = { data?: T; error?: string; loading: boolean; at?: number }

/** Polls fn every ms; `bump` changes force an immediate re-read. */
export function useLive<T>(fn: () => Promise<T>, ms = 5000, bump = 0): LiveState<T> {
  const [s, setS] = useState<LiveState<T>>({ loading: true })
  useEffect(() => {
    let on = true
    let inFlight = false // skip a tick while the previous read is still running
    const run = () => {
      if (inFlight) return
      inFlight = true
      fn()
        .then((data) => on && setS({ data, loading: false, at: Date.now() }))
        .catch((e) => on && setS((p) => ({ ...p, error: String(e?.message ?? e), loading: false })))
        .finally(() => { inFlight = false })
    }
    run()
    const t = setInterval(run, ms)
    return () => {
      on = false
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bump])
  return s
}

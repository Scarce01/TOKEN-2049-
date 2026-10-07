// Patrol verify-edge (docs/36_phase6.md 6.4): an off-chain tracer (Trek) only PROPOSES edges; CRE re-reads each
// transfer and writes a derived THREAT only when the money really moved out of a listed suspect. Pure functions:
// the handler does the reads (anchor header, receipts, one Multicall3 call) and the report write.
import type { Address, Hex } from 'viem'
import { evidenceHash } from '../../../../packages/shared/src/index'

export const MAX_EDGES = 12 // docs/36 6.4: at most 12 edges per call, one call per 30 s (HTTP trigger quota)
export const NATIVE_LOG_INDEX = 0xffffffff // Trek's marker for a native transfer (no log)
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const ZERO32 = `0x${'00'.repeat(32)}`

export type EdgeIn = {
  parent: Address
  child: Address
  txHash: Hex
  logIndex: number
  token: Address
  amount: bigint
  parentEvidence: Hex
}
export type EdgePayload = { orgId: Hex; edges: EdgeIn[] }

const isAddr = (s: unknown): s is string => typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s)
const isHex32 = (s: unknown): s is string => typeof s === 'string' && /^0x[0-9a-fA-F]{64}$/.test(s)

/** Strict parse of the HTTP body. Throws on anything malformed: an untrusted caller gets no partial processing. */
export function parseEdgePayload(json: string, maxEdges = MAX_EDGES): EdgePayload {
  // biome-ignore lint/suspicious/noExplicitAny: validated field by field below
  let p: any
  try {
    p = JSON.parse(json)
  } catch {
    throw new Error('verify-edge payload is not json')
  }
  if (p?.v !== 1) throw new Error('verify-edge payload version must be 1')
  if (!isHex32(p.orgId)) throw new Error('verify-edge orgId')
  if (!Array.isArray(p.edges) || p.edges.length === 0 || p.edges.length > maxEdges)
    throw new Error(`verify-edge needs 1 to ${maxEdges} edges`)
  const edges = p.edges.map((e: Record<string, unknown>, i: number): EdgeIn => {
    const ok =
      isAddr(e.parent) &&
      isAddr(e.child) &&
      isHex32(e.txHash) &&
      Number.isInteger(e.logIndex) &&
      (e.logIndex as number) >= 0 &&
      (e.logIndex as number) <= NATIVE_LOG_INDEX &&
      isAddr(e.token) &&
      typeof e.amount === 'string' &&
      /^[0-9]{1,78}$/.test(e.amount) &&
      isHex32(e.parentEvidence) &&
      e.parentEvidence !== ZERO32
    if (!ok) throw new Error(`verify-edge edge ${i} is malformed`)
    return {
      parent: (e.parent as string).toLowerCase() as Address,
      child: (e.child as string).toLowerCase() as Address,
      txHash: (e.txHash as string).toLowerCase() as Hex,
      logIndex: e.logIndex as number,
      token: (e.token as string).toLowerCase() as Address,
      amount: BigInt(e.amount as string),
      parentEvidence: (e.parentEvidence as string).toLowerCase() as Hex,
    }
  })
  return { orgId: (p.orgId as string).toLowerCase() as Hex, edges }
}

export type LogView = { address: string; topics: string[]; data: string; index: number }
export type ReceiptView = { status: bigint; blockNumber: bigint; logs: LogView[] } | null

const topicAddr = (t: string | undefined) => (t && t.length === 66 ? `0x${t.slice(26)}`.toLowerCase() : '')

/** Why this edge cannot be verified ('' = it can). The transfer must be the exact log the tracer named. */
export function checkEdge(
  e: EdgeIn,
  r: ReceiptView,
  anchor: bigint,
  minAmount: Map<string, bigint>,
  protectedAddrs: Set<string>,
): string {
  if (e.logIndex === NATIVE_LOG_INDEX) return 'native-unsupported' // a receipt carries no value for native ETH
  const min = minAmount.get(e.token)
  if (min === undefined) return 'unknown-token'
  if (e.parent === e.child) return 'self-edge'
  if (protectedAddrs.has(e.child)) return 'protected-child'
  if (e.amount < min) return 'below-min-amount' // blunts dusting: 1 wei from a suspect must not flag a victim
  if (!r) return 'no-receipt'
  if (r.status !== 1n) return 'reverted'
  if (r.blockNumber > anchor) return 'not-settled' // every node must see the same receipt (rule 5)
  const l = r.logs.find((x) => x.index === e.logIndex)
  if (!l) return 'log-missing'
  if (l.address.toLowerCase() !== e.token || l.topics.length !== 3 || l.topics[0]?.toLowerCase() !== TRANSFER_TOPIC)
    return 'not-transfer'
  if (topicAddr(l.topics[1]) !== e.parent) return 'from-mismatch'
  if (topicAddr(l.topics[2]) !== e.child) return 'to-mismatch'
  if (BigInt(l.data) !== e.amount) return 'amount-mismatch'
  return ''
}

export type Threat = {
  suspect: Address
  chainId: bigint
  evidenceHash: Hex
  fingerprintHash: Hex
  expiresAt: bigint
  parentEvidence: Hex
  proof: Hex
}
export type EdgeResult = { i: number; reason: string }

/**
 * Edges are taken in the order given (Trek sends lower hops first). A parent counts when it is a listed suspect
 * whose evidence is still valid on chain at the anchor, or when it was verified earlier in this same batch (the
 * Receiver applies the THREAT actions in order, so the registry sees the parent before the child).
 */
export function decideEdges(x: {
  chainId: bigint
  edges: EdgeIn[]
  receipts: ReceiptView[]
  suspectsOnChain: Set<string> // parent addresses listed at the anchor
  evidenceOnChain: Set<string> // parent evidence hashes still valid at the anchor
  anchorNumber: bigint
  anchorTime: bigint
  ttl: bigint
  minAmount: Map<string, bigint>
  protectedAddrs: Set<string>
}): { threats: Threat[]; results: EdgeResult[] } {
  const threats: Threat[] = []
  const results: EdgeResult[] = []
  const freshAddr = new Set<string>()
  const freshEv = new Set<string>()
  x.edges.forEach((e, i) => {
    let reason = checkEdge(e, x.receipts[i] ?? null, x.anchorNumber, x.minAmount, x.protectedAddrs)
    const ev = evidenceHash(x.chainId, e.txHash, e.logIndex).toLowerCase()
    if (!reason && !(x.suspectsOnChain.has(e.parent) || freshAddr.has(e.parent))) reason = 'parent-not-suspect'
    if (!reason && !(x.evidenceOnChain.has(e.parentEvidence) || freshEv.has(e.parentEvidence)))
      reason = 'parent-evidence-invalid'
    if (!reason && freshEv.has(ev)) reason = 'duplicate'
    results.push({ i, reason: reason || 'ok' })
    if (reason) return
    freshAddr.add(e.child)
    freshEv.add(ev)
    threats.push({
      suspect: e.child,
      chainId: x.chainId,
      evidenceHash: ev as Hex,
      fingerprintHash: ZERO32 as Hex,
      expiresAt: x.anchorTime + x.ttl,
      parentEvidence: e.parentEvidence,
      proof: '0x',
    })
  })
  return { threats, results }
}

/** One line for the log: counts per reason, sorted, no addresses. */
export function summarize(results: EdgeResult[]): string {
  const m = new Map<string, number>()
  for (const r of results) m.set(r.reason, (m.get(r.reason) ?? 0) + 1)
  return [...m.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, n]) => `${k}=${n}`)
    .join(' ')
}

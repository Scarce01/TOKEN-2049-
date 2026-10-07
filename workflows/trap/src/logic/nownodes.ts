// Pure NOWNodes receipt check. The HTTP call itself stays in workflow.ts.
// A contradicting receipt stops the trap (D48); an unavailable one does not. The trap rules do not change.

export type SourceLog = { address: string; topics: string[]; data: string; index: number }

type RpcLog = { address?: string; topics?: string[]; data?: string; logIndex?: string }

/** JSON-RPC body for eth_getTransactionReceipt. Key order is fixed. */
export function receiptRequestBody(txHash: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [txHash] })
}

/**
 * Canonical text for consensus. `miss` means the node returned a null receipt.
 * Throws on a JSON-RPC error or a non-JSON body. Status is a decimal string.
 */
export function canonicalReceipt(body: string): string {
  let parsed: { error?: { code?: number }; result?: { status?: string; logs?: RpcLog[] } | null }
  try {
    parsed = JSON.parse(body) as typeof parsed
  } catch {
    throw new Error('nownodes body is not json')
  }
  if (parsed.error) throw new Error(`nownodes rpc ${parsed.error.code ?? 'error'}`)
  if (!parsed.result) return 'miss'
  const status = BigInt(parsed.result.status ?? '0x0').toString()
  const rows = (parsed.result.logs ?? [])
    .map((l) => {
      const index = BigInt(l.logIndex ?? '0x0').toString()
      const topics = (l.topics ?? []).map((t) => t.toLowerCase()).join(',')
      const data = (l.data ?? '0x').toLowerCase()
      return `${index}|${(l.address ?? '').toLowerCase()}|${topics}|${data}`
    })
    .sort()
  return `ok|${status}|${rows.join(';')}`
}

export function secondSourceHasLog(canonical: string, log: SourceLog): boolean {
  if (!canonical.startsWith('ok|')) return false
  const after = canonical.slice(3)
  const bar = after.indexOf('|')
  if (bar < 0) return false
  if (after.slice(0, bar) !== '1') return false
  const needle = `${BigInt(log.index).toString()}|${log.address.toLowerCase()}|${log.topics.map((t) => t.toLowerCase()).join(',')}|${log.data.toLowerCase()}`
  const rows = after.slice(bar + 1)
  if (rows.length === 0) return false
  return rows.split(';').includes(needle)
}

/** Short log line. Does not include log payloads. */
export function summarizeSecondSource(canonical: string): string {
  if (!canonical.startsWith('ok|')) return canonical
  const after = canonical.slice(3)
  const bar = after.indexOf('|')
  const status = after.slice(0, bar)
  const rows = after.slice(bar + 1)
  const n = rows.length === 0 ? 0 : rows.split(';').length
  return `status=${status} logs=${n}`
}

// NOWNodes endpoints by chain id (audit 2026-10-07 H1). A chain without one gets '' and the trap acts on the
// CRE receipt alone (H2: the second source must not be able to veto tightening where it cannot answer).
const NOWNODES_URL: Record<number, string> = { 11155111: 'https://eth-sepolia.nownodes.io' }

export function nownodesUrlFor(chainId: number): string {
  return NOWNODES_URL[chainId] ?? ''
}

export function secondSourceAvailable(url: string): boolean {
  return url !== ''
}

/** Node-mode result when NOWNodes could not answer (HTTP error, non-JSON body, JSON-RPC error). */
export const UNAVAILABLE = 'unavailable'

/**
 * How the trap treats the second source (audit H2). `contradiction` is D48: a receipt exists but disagrees with
 * the trigger log, so no action. `unavailable` (null receipt, error, nodes disagree) is not a contradiction: a late
 * or down NOWNodes must not suppress tightening, so the trap acts on the CRE receipt alone.
 */
export function secondSourceVerdict(canonical: string, log: SourceLog): 'match' | 'unavailable' | 'contradiction' {
  if (canonical === 'miss' || canonical === UNAVAILABLE) return 'unavailable'
  return secondSourceHasLog(canonical, log) ? 'match' : 'contradiction'
}

import { describe, expect, test } from 'bun:test'
import { type Hex, pad } from 'viem'
import { evidenceHash } from '../../../packages/shared/src/index'
import {
  checkEdge,
  decideEdges,
  type EdgeIn,
  MAX_EDGES,
  NATIVE_LOG_INDEX,
  parseEdgePayload,
  type ReceiptView,
  summarize,
  TRANSFER_TOPIC,
} from '../src/logic/edges'

const ORG = `0x${'ae'.repeat(32)}` as Hex
const TOKEN = '0x6666666666666666666666666666666666666666' as Hex
const SUS = '0x1111111111111111111111111111111111111111' as Hex // listed suspect (Trap A recipient)
const H1 = '0x2222222222222222222222222222222222222222' as Hex
const H2 = '0x3333333333333333333333333333333333333333' as Hex
const VAULT = '0x4444444444444444444444444444444444444444' as Hex
const ROOT_EV = `0x${'77'.repeat(32)}` as Hex
const TX1 = `0x${'a1'.repeat(32)}` as Hex
const TX2 = `0x${'a2'.repeat(32)}` as Hex

const edge = (o: Partial<EdgeIn> = {}): EdgeIn => ({
  parent: SUS,
  child: H1,
  txHash: TX1,
  logIndex: 2,
  token: TOKEN,
  amount: 5_000_000n,
  parentEvidence: ROOT_EV,
  ...o,
})
const transferLog = (from: string, to: string, amount: bigint, index: number, token = TOKEN) => ({
  address: token,
  topics: [TRANSFER_TOPIC, pad(from as `0x${string}`), pad(to as `0x${string}`)],
  data: pad(`0x${amount.toString(16)}`),
  index,
})
const receipt = (logs: ReturnType<typeof transferLog>[], blockNumber = 100n, status = 1n): ReceiptView => ({
  status,
  blockNumber,
  logs,
})
const MIN = new Map([[TOKEN, 1_000_000n]])
const PROT = new Set([VAULT])

describe('verify-edge payload', () => {
  const body = (edges: unknown[]) =>
    JSON.stringify({
      v: 1,
      orgId: ORG,
      edges: edges.map((e) => ({ ...(e as object) })),
    })
  const raw = {
    parent: SUS,
    child: H1,
    txHash: TX1,
    logIndex: 2,
    token: TOKEN,
    amount: '5000000',
    parentEvidence: ROOT_EV,
  }
  test('a well-formed body parses, addresses lowercased, amount as bigint', () => {
    const p = parseEdgePayload(body([{ ...raw, child: H1.toUpperCase().replace('0X', '0x') }]))
    expect(p.orgId).toBe(ORG)
    expect(p.edges[0]).toEqual(edge())
  })
  test('malformed input is rejected as a whole (untrusted caller)', () => {
    expect(() => parseEdgePayload('nope')).toThrow('not json')
    expect(() => parseEdgePayload(JSON.stringify({ v: 2, orgId: ORG, edges: [raw] }))).toThrow('version')
    expect(() => parseEdgePayload(body([]))).toThrow('1 to 12')
    expect(() => parseEdgePayload(body(Array(MAX_EDGES + 1).fill(raw)))).toThrow('1 to 12')
    expect(() => parseEdgePayload(body([{ ...raw, amount: '-1' }]))).toThrow('malformed')
    expect(() => parseEdgePayload(body([{ ...raw, parentEvidence: `0x${'00'.repeat(32)}` }]))).toThrow('malformed')
    expect(() => parseEdgePayload(body([{ ...raw, child: '0x12' }]))).toThrow('malformed')
  })
})

describe('verify-edge single edge check', () => {
  const ok = receipt([transferLog(SUS, H1, 5_000_000n, 2)])
  test('the named Transfer log matches', () => {
    expect(checkEdge(edge(), ok, 100n, MIN, PROT)).toBe('')
  })
  test('every mismatch has its own reason', () => {
    expect(checkEdge(edge({ logIndex: NATIVE_LOG_INDEX }), ok, 100n, MIN, PROT)).toBe('native-unsupported')
    expect(checkEdge(edge({ token: H2 }), ok, 100n, MIN, PROT)).toBe('unknown-token')
    expect(checkEdge(edge({ child: SUS }), ok, 100n, MIN, PROT)).toBe('self-edge')
    expect(checkEdge(edge({ child: VAULT }), ok, 100n, MIN, PROT)).toBe('protected-child')
    expect(checkEdge(edge({ amount: 1n }), ok, 100n, MIN, PROT)).toBe('below-min-amount')
    expect(checkEdge(edge(), null, 100n, MIN, PROT)).toBe('no-receipt')
    expect(checkEdge(edge(), receipt([transferLog(SUS, H1, 5_000_000n, 2)], 100n, 0n), 100n, MIN, PROT)).toBe(
      'reverted',
    )
    expect(checkEdge(edge(), ok, 99n, MIN, PROT)).toBe('not-settled')
    expect(checkEdge(edge({ logIndex: 3 }), ok, 100n, MIN, PROT)).toBe('log-missing')
    expect(checkEdge(edge(), receipt([transferLog(SUS, H1, 5_000_000n, 2, H2)]), 100n, MIN, PROT)).toBe('not-transfer')
    expect(checkEdge(edge({ parent: H2 }), ok, 100n, MIN, PROT)).toBe('from-mismatch')
    expect(checkEdge(edge({ child: H2 }), ok, 100n, MIN, PROT)).toBe('to-mismatch')
    expect(checkEdge(edge({ amount: 4_000_000n }), ok, 100n, MIN, PROT)).toBe('amount-mismatch')
  })
})

describe('verify-edge batch decision', () => {
  const base = {
    chainId: 84532n,
    suspectsOnChain: new Set([SUS]),
    evidenceOnChain: new Set([ROOT_EV]),
    anchorNumber: 100n,
    anchorTime: 1_760_000_000n,
    ttl: 86_400n,
    minAmount: MIN,
    protectedAddrs: PROT,
  }
  const ev1 = evidenceHash(84532n, TX1, 2).toLowerCase() as Hex

  test('two hops in one batch: the child of a verified edge can be the parent of the next', () => {
    const e1 = edge()
    const e2 = edge({ parent: H1, child: H2, txHash: TX2, logIndex: 0, amount: 4_000_000n, parentEvidence: ev1 })
    const d = decideEdges({
      ...base,
      edges: [e1, e2],
      receipts: [receipt([transferLog(SUS, H1, 5_000_000n, 2)]), receipt([transferLog(H1, H2, 4_000_000n, 0)])],
    })
    expect(d.results.map((r) => r.reason)).toEqual(['ok', 'ok'])
    expect(d.threats.map((t) => t.suspect)).toEqual([H1, H2])
    // the workflow computes evidence and expiry itself; nothing from the tracer is trusted for these
    expect(d.threats[0]?.evidenceHash).toBe(ev1)
    expect(d.threats[0]?.parentEvidence).toBe(ROOT_EV)
    expect(d.threats[1]?.parentEvidence).toBe(ev1)
    expect(d.threats[0]?.expiresAt).toBe(1_760_000_000n + 86_400n)
    expect(d.threats[0]?.proof).toBe('0x')
  })

  test('a child that comes before its parent in the batch is rejected (parents first)', () => {
    const e2 = edge({ parent: H1, child: H2, txHash: TX2, logIndex: 0, amount: 4_000_000n, parentEvidence: ev1 })
    const d = decideEdges({
      ...base,
      edges: [e2, edge()],
      receipts: [receipt([transferLog(H1, H2, 4_000_000n, 0)]), receipt([transferLog(SUS, H1, 5_000_000n, 2)])],
    })
    expect(d.results.map((r) => r.reason)).toEqual(['parent-not-suspect', 'ok'])
  })

  test('a real transfer from an unlisted address cannot flag anyone (compromised tracer)', () => {
    const d = decideEdges({
      ...base,
      suspectsOnChain: new Set(),
      edges: [edge()],
      receipts: [receipt([transferLog(SUS, H1, 5_000_000n, 2)])],
    })
    expect(d.results[0]?.reason).toBe('parent-not-suspect')
    expect(d.threats).toEqual([])
  })

  test('an expired or unknown parent evidence is rejected', () => {
    const d = decideEdges({
      ...base,
      evidenceOnChain: new Set(),
      edges: [edge()],
      receipts: [receipt([transferLog(SUS, H1, 5_000_000n, 2)])],
    })
    expect(d.results[0]?.reason).toBe('parent-evidence-invalid')
  })

  test('the same edge twice in a batch is written once', () => {
    const r = receipt([transferLog(SUS, H1, 5_000_000n, 2)])
    const d = decideEdges({ ...base, edges: [edge(), edge()], receipts: [r, r] })
    expect(d.results.map((x) => x.reason)).toEqual(['ok', 'duplicate'])
    expect(d.threats.length).toBe(1)
    expect(summarize(d.results)).toBe('duplicate=1 ok=1')
  })
})

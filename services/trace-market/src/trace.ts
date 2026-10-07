// Lookup over data/trace_index.json (analysis/trace_bybit/trace_index.py): the addresses that received tainted
// funds downstream of `address`, each with the edge that tainted it (parent + evidence tx). REPLAY data only.
import index from '../data/trace_index.json'

type Node = { hop: number; taintPct: number; tainted: number; breakpoint: string | null; from: string | null; evidenceTx: string | null; block: number | null }
type Case = { chain: string; unit: string; window: number[]; seeds: string[]; nodes: Record<string, Node> }

const cases = index.cases as Record<string, Case>
const children = new Map<string, string[]>() // `${case}:${parent}` -> child addresses
for (const [id, c] of Object.entries(cases))
  for (const [a, n] of Object.entries(c.nodes)) if (n.from) children.set(`${id}:${n.from}`, [...(children.get(`${id}:${n.from}`) ?? []), a])

export function trace(address: string, maxDepth = 2, maxLinked = 20) {
  const a = address.toLowerCase()
  const caseId = Object.keys(cases).find((id) => cases[id]!.nodes[a])
  if (!caseId) return null
  const c = cases[caseId]!
  const linked = []
  let frontier = [a]
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next = frontier.flatMap((p) => children.get(`${caseId}:${p}`) ?? []).sort((x, y) => c.nodes[y]!.tainted - c.nodes[x]!.tainted || x.localeCompare(y))
    for (const x of next) {
      const n = c.nodes[x]!
      linked.push({ address: x, relation: 'RECEIVED_TAINTED_FROM', from: n.from, depth, confidence: 'LINKED', taintPct: n.taintPct, tainted: n.tainted, breakpoint: n.breakpoint, evidenceTx: n.evidenceTx, block: n.block })
    }
    frontier = next
  }
  return {
    source: index.source,
    traceCase: caseId,
    chain: c.chain,
    unit: c.unit,
    window: c.window,
    seed: a,
    note: 'LINKED is a lead for an analyst, not a confirmed attacker. Paying for a trace does not change any classification.',
    linked: linked.slice(0, maxLinked),
    totalLinked: linked.length,
  }
}

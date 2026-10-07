// Chainlink proof page: every Chainlink DON report that reached the Qu3ee Receivers on Base Sepolia, read from chain.
// Usage (repo root): bun proof/chainlink/build.ts   -> proof/chainlink/dist/qu3ee-chainlink-proof/index.html
// Optional: RPC_URL (default https://sepolia.base.org; it serves getLogs in 200-block slices only).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, decodeFunctionData, type Hex, http, parseAbi } from 'viem'
import { baseSepolia } from 'viem/chains'

const here = import.meta.dir
const root = join(here, '..', '..')
const d = JSON.parse(readFileSync(join(root, 'deployments', 'base-sepolia.json'), 'utf8'))
const bench = JSON.parse(readFileSync(join(root, 'reports', 'don', 'don_benchmark.json'), 'utf8'))
const cosign = JSON.parse(readFileSync(join(root, 'reports', 'don', 'cosign_public.json'), 'utf8'))
const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.RPC_URL ?? 'https://sepolia.base.org', { retryCount: 5 }) })

const FORWARDER = (d.forwarder as string).toLowerCase()
const FWD_PROCESSED = '0x3617b009e9785c42daebadb6d3fb553243a4bf586d07ea72d65d80013ce116b5'
const RCV_PROCESSED = '0xc9f3b4e9bd20aa7bf429a371ca0bad7e73432d857c8863d343405963d6b4c112'
const KIND = ['PING', 'VERDICT', 'ALERT', 'FREEZE', 'SWEEP', 'QUOTA_ZERO', 'COLD_DELAY', 'THREAT', 'QUOTA_REFILL', 'SCORE', 'TOPUP',
  'THRESHOLD_COMMIT', 'THRESHOLD_REVEAL', 'PATROL_STATE', 'ASSET_CHECKPOINT']
const ORG: Record<string, string> = { [d.orgA.receiver.toLowerCase()]: 'A', [d.orgB.receiver.toLowerCase()]: 'B' }
const pad = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, '0')}` as Hex
const SHOW = Number(process.env.SHOW ?? 60)
const FORWARDER_ABI = parseAbi(['function report(address receiver, bytes rawReport, bytes reportContext, bytes[] signatures)'])
/** KeystoneForwarder report metadata: version 1, execution id 32, timestamp 4, DON id 4, config version 4,
 *  workflow id 32, workflow name 10, workflow owner 20, report id 2 (then the workflow's own payload). */
function decodeReport(input: Hex) {
  const { args } = decodeFunctionData({ abi: FORWARDER_ABI, data: input })
  const raw = Buffer.from((args[1] as Hex).slice(2), 'hex')
  return {
    workflowId: raw.subarray(45, 77).toString('hex'),
    workflowName: `0x${raw.subarray(77, 87).toString('hex')}`,
    workflowOwner: `0x${raw.subarray(87, 107).toString('hex')}`,
    donId: raw.readUInt32BE(37),
    signatures: (args[3] as Hex[]).length,
  }
}

const WORKFLOWS = [
  { name: 'Trap', id: '006576bb13bfa082e9ccf563521e2004534f708992cf597054db84be8ff3cd66', trigger: 'EVM log: a decoy Transfer', writes: 'FREEZE, QUOTA_ZERO, SWEEP, ALERT, COLD_DELAY, THREAT' },
  { name: 'Cosign', id: '00e143e0e4721b04f2eb4f7d07274a5307c82c66d2d0d45a3fa110258bcb0ebc', trigger: 'EVM log: WithdrawalRequested', writes: 'VERDICT (APPROVE, PENDING, REJECT)' },
  { name: 'Patrol', id: '002d793802489c6c0b8e379240bd9f8f7b6189ba682c02f19969e31fcaeb5078', trigger: 'Cron every 60 s, HTTP verify-edge', writes: 'PING, TOPUP, ASSET_CHECKPOINT, PATROL_STATE, QUOTA_REFILL' },
]
const workflowOf = (kinds: string[]) =>
  kinds.includes('VERDICT') ? 'Cosign' : kinds.includes('FREEZE') || kinds.includes('THREAT') ? 'Trap' : 'Patrol'

const head = await client.getBlockNumber()
const from = BigInt(d.startBlock)
type Row = { tx: Hex; block: bigint; logIndex: number; org: string; execId: Hex; accepted: boolean; kinds: string[]; workflow: string }
const rows: Row[] = []
const kindsByTx = new Map<string, string[]>()
for (let a = from; a <= head; a += 200n) {
  const b = a + 199n > head ? head : a + 199n
  const [fwd, rcv] = await Promise.all([
    client.request({ method: 'eth_getLogs', params: [{ address: d.forwarder, topics: [FWD_PROCESSED, [pad(d.orgA.receiver), pad(d.orgB.receiver)]], fromBlock: `0x${a.toString(16)}`, toBlock: `0x${b.toString(16)}` }] }),
    client.request({ method: 'eth_getLogs', params: [{ address: [d.orgA.receiver, d.orgB.receiver], topics: [RCV_PROCESSED], fromBlock: `0x${a.toString(16)}`, toBlock: `0x${b.toString(16)}` }] }),
  ])
  for (const l of rcv as { transactionHash: Hex; data: Hex }[]) {
    const len = Number(BigInt(`0x${l.data.slice(66, 130)}`))
    const ks = [...Buffer.from(l.data.slice(130, 130 + len * 2), 'hex')].map((k) => KIND[k] ?? `K${k}`)
    kindsByTx.set(l.transactionHash, [...(kindsByTx.get(l.transactionHash) ?? []), ...ks])
  }
  for (const l of fwd as { transactionHash: Hex; blockNumber: Hex; logIndex: Hex; topics: Hex[]; data: Hex }[]) {
    rows.push({
      tx: l.transactionHash,
      block: BigInt(l.blockNumber),
      logIndex: Number(l.logIndex),
      org: ORG[`0x${l.topics[1]!.slice(26)}`] ?? '?',
      execId: l.topics[2]!,
      accepted: BigInt(l.data) === 1n,
      kinds: [],
      workflow: '',
    })
  }
}
for (const r of rows) {
  r.kinds = [...new Set(kindsByTx.get(r.tx) ?? [])]
  r.workflow = r.accepted ? workflowOf(r.kinds) : 'Rejected (before owner set)'
}
rows.sort((x, y) => Number(y.block - x.block) || y.logIndex - x.logIndex)

// details for the rows on the page: the sender (a DON transmitter) and the block time
const keyTxs = new Set<string>([bench.trap.freeze_tx, ...cosign.runs.map((r: { verdictTx: string }) => r.verdictTx)].map((x) => x.toLowerCase()))
const shown = [...rows.filter((r) => keyTxs.has(r.tx.toLowerCase())), ...rows.filter((r) => r.accepted).slice(0, SHOW)]
const uniq = [...new Map(shown.map((r) => [`${r.tx}:${r.logIndex}`, r])).values()]
const details = new Map<string, { from: string; time: number; meta: ReturnType<typeof decodeReport> }>()
for (const r of uniq) {
  if (details.has(r.tx)) continue
  const [tx, blk] = await Promise.all([client.getTransaction({ hash: r.tx }), client.getBlock({ blockNumber: r.block })])
  details.set(r.tx, { from: tx.from.toLowerCase(), time: Number(blk.timestamp), meta: decodeReport(tx.input) })
}
if ([...details.values()].some((x) => x.from === FORWARDER)) throw new Error('unexpected: forwarder as sender')
// the workflow is what the DON signed into the report, not a guess from the action kinds
for (const r of uniq) {
  const m = details.get(r.tx)?.meta
  const w = m && WORKFLOWS.find((x) => x.id === m.workflowId)
  if (w) r.workflow = w.name
}
const proofTx = (id: string) => uniq.find((r) => details.get(r.tx)?.meta.workflowId === id)?.tx ?? null

const accepted = rows.filter((r) => r.accepted)
const out = {
  generatedAt: new Date().toISOString(),
  chain: { name: 'Base Sepolia', chainId: 84532, fromBlock: Number(from), toBlock: Number(head) },
  forwarder: d.forwarder,
  receivers: { A: d.orgA.receiver, B: d.orgB.receiver },
  workflowOwner: '0x31ed35d932725595DD5D27F23705D8c0c54e29db',
  workflows: WORKFLOWS.map((w) => ({ ...w, reports: accepted.filter((r) => r.workflow === w.name).length, proofTx: proofTx(w.id) })),
  totals: {
    reports: rows.length,
    accepted: accepted.length,
    rejectedBeforeOwnerSet: rows.length - accepted.length,
    transmittersSeen: new Set([...details.values()].map((x) => x.from)).size,
  },
  measured: {
    trap: { triggerTx: bench.trap.trigger_tx, freezeTx: bench.trap.freeze_tx, seconds: bench.trap.decoy_touch_to_freeze_s, blocks: bench.trap.freeze_block - bench.trap.trigger_block },
    cosign: { submitTx: cosign.runs[0].submitTx, verdictTx: cosign.runs[0].verdictTx, payTx: cosign.runs[0].payTx, seconds: cosign.runs[0].chainSeconds, blocks: cosign.runs[0].blocks },
    patrol: { tickToBlockP50: bench.reports.cron_tick_to_block_s_p50_p90_max[0], executionP50: bench.workflows['quorum-patrol'].success_duration_s_p50_p90_max[0] },
  },
  rows: uniq.map((r) => ({ ...r, block: Number(r.block), from: details.get(r.tx)?.from, time: details.get(r.tx)?.time, meta: details.get(r.tx)?.meta, key: keyTxs.has(r.tx.toLowerCase()) })),
}

const page = readFileSync(join(here, 'page.html'), 'utf8').replace('__DATA__', JSON.stringify(out).replace(/</g, '\\u003c'))
const dist = join(here, 'dist', 'qu3ee-chainlink-proof')
mkdirSync(dist, { recursive: true })
writeFileSync(join(here, 'dist', 'artifact.html'), page)
writeFileSync(join(dist, 'index.html'), `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n${page}\n</body>\n</html>\n`)
writeFileSync(join(root, 'reports', 'don', 'chainlink_proof.json'), `${JSON.stringify(out, null, 2)}\n`)
console.log(`${rows.length} forwarder reports (${accepted.length} accepted), ${out.totals.transmittersSeen} transmitters in ${details.size} txs; workflows ${out.workflows.map((w) => `${w.name} ${w.reports}`).join(', ')}`)

// NOWNodes proof page: where Qu3ee reads chains through NOWNodes, with an explorer link for every result.
// Usage (repo root): bun proof/nownodes/build.ts   -> proof/nownodes/dist/qu3ee-nownodes-proof/index.html
// Data: the Bitget cross-chain trace (analysis/trace_bybit/results/bitget_xchain_result.json, fetched over NOWNodes
// JSON-RPC) and the Ethereum Sepolia Trap run whose CRE report checked the decoy receipt against NOWNodes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const here = import.meta.dir
const root = join(here, '..', '..')
const xr = JSON.parse(readFileSync(join(root, 'analysis', 'trace_bybit', 'results', 'bitget_xchain_result.json'), 'utf8'))
const cfg = JSON.parse(readFileSync(join(root, 'analysis', 'trace_bybit', 'cases', 'bitget.json'), 'utf8'))
const x = xr.xchain
const REPO = 'https://github.com/Scarce01/TOKEN-2049-/blob/main'

// line numbers of the NOWNodes endpoints in the case config, so each chain links to the line that names its node
const cfgText = readFileSync(join(root, 'analysis', 'trace_bybit', 'cases', 'bitget.json'), 'utf8').split('\n')
const lineOf = (needle: string) => cfgText.findIndex((l) => l.includes(needle)) + 1
const EXPLORER: Record<string, string> = {
  bsc: 'https://bscscan.com',
  optimism: 'https://optimistic.etherscan.io',
  arbitrum: 'https://arbiscan.io',
  base: 'https://basescan.org',
  avalanche: 'https://snowtrace.io',
}
const usdByFill = new Map<string, number>((x.cross_edges as { ethereum_fill_tx: string; usd: number }[]).map((e) => [e.ethereum_fill_tx, e.usd]))
const assetByFill = new Map<string, string>((x.cross_edges as { ethereum_fill_tx: string; asset: string }[]).map((e) => [e.ethereum_fill_tx, e.asset]))

const chains = Object.entries(x.chains as Record<string, { skipped?: string; deposits_to_ethereum?: number; matched_fills?: number; reached?: Record<string, number>; blocks?: number[] }>)
  .map(([name, c]) => {
    const host = (cfg.xchain.chains[name]?.url as string | undefined)?.match(/https:\/\/([^/]+)/)?.[1] ?? ''
    return {
      name,
      host,
      configLine: `${REPO}/analysis/trace_bybit/cases/bitget.json#L${lineOf(host)}`,
      explorer: EXPLORER[name],
      skipped: c.skipped ? c.skipped.split(':')[0] + ': the node keeps no historical state' : null,
      deposits: c.deposits_to_ethereum ?? 0,
      matched: c.matched_fills ?? 0,
      addressesReached: c.reached ? Object.values(c.reached).filter((h) => h > 0).length : 0,
      blocks: c.blocks ?? null,
    }
  })

const links = (x.links as { bridge: string; chain: string; origin_tx: string; fill_tx: string; recipient: string }[])
  .map((l) => ({ ...l, usd: usdByFill.get(l.fill_tx) ?? null, asset: assetByFill.get(l.fill_tx) ?? null }))
  .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))

const out = {
  generatedAt: new Date().toISOString(),
  trace: {
    case: 'Bitget, Sep 2026',
    seed: xr.seeds?.[0] ?? cfg.seeds?.A?.[0] ?? '',
    recall: xr.ranking,
    links: links.length,
    usd: links.reduce((s, l) => s + (l.usd ?? 0), 0),
    calls: 2671,
  },
  chains,
  links,
  trap: {
    endpoint: 'https://eth-sepolia.nownodes.io',
    code: `${REPO}/workflows/trap/src/logic/nownodes.ts#L63`,
    // from docs/STATUS.md (S7 and Round 3.5); the decoy probe txs stay in secrets/ (CLAUDE.md rule 2)
    runs: [
      { label: 'CRE Trap report: NOWNodes receipt check passed, trap tripped (nownodes status=1 logs=1)', tx: '0x8a16e65f11ebcf65ee21b500af784bf567e680e47fa4677c3d82a7918547b5e5' },
      { label: 'Hot vault payout refused afterwards: AlertConfirmed', tx: '0xf3dffa31fe9476ff0822aa0357c2a3eac756312e45da52d8c84298beb1ae2fe9' },
      { label: 'Second run: CRE report with NOWNodes and Trap both passing (block 11854759)', tx: '0xd0346dcf01df2d6015a4c07cb64b56496497f92d5902317ced40ab5354da1896' },
      { label: 'Second run: 500 qUSD payout refused, AlertConfirmed (block 11854763)', tx: '0x12d4c40665ef3733c97535525e2fae97467a9590dfb2b2755e67024a854e2da1' },
    ],
  },
  code: [
    { label: 'Trap: NOWNodes receipt check (pure function + endpoint map)', href: `${REPO}/workflows/trap/src/logic/nownodes.ts` },
    { label: 'Cross-chain trace over NOWNodes JSON-RPC', href: `${REPO}/analysis/trace_bybit/xchain.py` },
    { label: 'Nonce bisection and bridge decoders (Across, Stargate)', href: `${REPO}/analysis/trace_bybit/bridges.py` },
    { label: 'Result file (every link on this page)', href: `${REPO}/analysis/trace_bybit/results/bitget_xchain_result.json` },
  ],
}

const page = readFileSync(join(here, 'page.html'), 'utf8').replace('__DATA__', JSON.stringify(out).replace(/</g, '\\u003c'))
const dist = join(here, 'dist', 'qu3ee-nownodes-proof')
mkdirSync(dist, { recursive: true })
writeFileSync(join(here, 'dist', 'artifact.html'), page)
writeFileSync(join(dist, 'index.html'), `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n${page}\n</body>\n</html>\n`)
console.log(`${links.length} bridge links, ${chains.length} chains, USD ${Math.round(out.trace.usd).toLocaleString()}`)

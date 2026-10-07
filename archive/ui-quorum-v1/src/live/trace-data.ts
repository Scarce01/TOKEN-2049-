// Faithful-to-logic data for the Attack & Trace lab.
// Real headline numbers from the Quorum tracing backtest (docs/research/tracing_backtest.md, Bybit case,
// seed 0x4766…86e2, FBI PSA I-022625-PSA): 51/51 FBI-listed wallets within 3 hops, first touched 16 min
// after the hack vs the FBI list 5 days later; proportional ("haircut") taint, keep following >= 50%,
// rank by tainted amount, <= 4 hops, candidates >= 10% taint, stops at exchanges/bridges/services/burn.
// The GRAPH BELOW is a compact illustrative structure (a handful of nodes standing in for the 41/42/51
// real wallets) so the animation is legible; the taint math and the stop rules are the real ones.

export type NodeType = 'seed' | 'wallet' | 'exchange' | 'bridge' | 'service' | 'burn'
export type TraceNode = {
  id: string
  label: string
  addr: string
  type: NodeType
  hop: number
  x: number
  y: number
  taintPpm: number // share of this address's inflow that is tainted
  taintedEth: number // tainted amount carried here
  fbi?: boolean // on the FBI PSA list (the ground truth)
  stop?: boolean // tracing stops here (exchange / bridge / service / burn)
}
export type TraceEdge = { from: string; to: string; eth: number; hop: number }

// taint keeps >= 50% to be followed; candidates listed at >= 10%
export const TAU_FOLLOW_PPM = 500_000
export const TAU_CANDIDATE_PPM = 100_000
export const MAX_HOP = 4

export const SEED = '0x47666fab8bd0ac7003bce3f5c3585383f09486e2'

export const NODES: TraceNode[] = [
  { id: 'seed', label: 'Thief entry', addr: SEED, type: 'seed', hop: 0, x: 90, y: 230, taintPpm: 1_000_000, taintedEth: 401_346, fbi: true },
  // hop 1 (stands in for 41 wallets): two hubs hold the most tainted ETH
  { id: 'h1a', label: 'Hub A', addr: '0x7a3f…91c2', type: 'wallet', hop: 1, x: 300, y: 120, taintPpm: 1_000_000, taintedEth: 197_400, fbi: true },
  { id: 'h1b', label: 'Hub B', addr: '0x91c2…a0d4', type: 'wallet', hop: 1, x: 300, y: 240, taintPpm: 1_000_000, taintedEth: 98_200, fbi: true },
  { id: 'h1c', label: 'Spray wallet', addr: '0xbe20…44e1', type: 'wallet', hop: 1, x: 300, y: 350, taintPpm: 1_000_000, taintedEth: 52_900, fbi: true },
  // hop 2 (stands in for 42)
  { id: 'h2a', label: 'Layer wallet', addr: '0x5c11…d07a', type: 'wallet', hop: 2, x: 520, y: 90, taintPpm: 940_000, taintedEth: 92_100, fbi: true },
  { id: 'ex1', label: 'eXch (no KYC)', addr: '0x2e8f…77b2', type: 'exchange', hop: 2, x: 520, y: 200, taintPpm: 820_000, taintedEth: 61_000, stop: true },
  { id: 'br1', label: 'THORChain router', addr: '0x1b2c…ea90', type: 'bridge', hop: 2, x: 520, y: 310, taintPpm: 760_000, taintedEth: 48_500, stop: true },
  { id: 'h2b', label: 'Layer wallet', addr: '0x0e8a…f3c1', type: 'wallet', hop: 2, x: 520, y: 400, taintPpm: 910_000, taintedEth: 40_300, fbi: true },
  // hop 3 (completes 51/51 FBI)
  { id: 'h3a', label: 'Cash-out wallet', addr: '0x7c00…12aa', type: 'wallet', hop: 3, x: 740, y: 90, taintPpm: 880_000, taintedEth: 70_200, fbi: true },
  { id: 'h3b', label: 'Cash-out wallet', addr: '0x36ed…55a1', type: 'wallet', hop: 3, x: 740, y: 180, taintPpm: 300_000, taintedEth: 18_900, fbi: false },
  { id: 'svc1', label: 'Deposit service (50+ senders)', addr: '0x9b2e…41d0', type: 'service', hop: 3, x: 740, y: 320, taintPpm: 180_000, taintedEth: 12_100, stop: true },
  { id: 'burn', label: 'Burn / redeem', addr: '0x0000…0000', type: 'burn', hop: 3, x: 740, y: 410, taintPpm: 1_000_000, taintedEth: 9_400, stop: true },
]

export const EDGES: TraceEdge[] = [
  { from: 'seed', to: 'h1a', eth: 197_400, hop: 1 },
  { from: 'seed', to: 'h1b', eth: 98_200, hop: 1 },
  { from: 'seed', to: 'h1c', eth: 52_900, hop: 1 },
  { from: 'h1a', to: 'h2a', eth: 92_100, hop: 2 },
  { from: 'h1a', to: 'ex1', eth: 61_000, hop: 2 },
  { from: 'h1b', to: 'br1', eth: 48_500, hop: 2 },
  { from: 'h1c', to: 'h2b', eth: 40_300, hop: 2 },
  { from: 'h2a', to: 'h3a', eth: 70_200, hop: 3 },
  { from: 'h2a', to: 'h3b', eth: 18_900, hop: 3 },
  { from: 'h2b', to: 'svc1', eth: 12_100, hop: 3 },
  { from: 'h2b', to: 'burn', eth: 9_400, hop: 3 },
]

export const HOP_COUNT = [0, 41, 42, 51] // cumulative FBI-listed found by hop (real)
export const HEADLINE = {
  found: '51 / 51',
  truth: 'FBI PSA I-022625-PSA',
  firstTouch: '16 min after the hack',
  fbiList: 'FBI list published 5 days later',
  precision: 'top 102 by tainted amount contain all 51',
  note: 'Bitget, where money left over Stargate / Across bridges: 8 / 14 (cross-chain handed off to a firm).',
}

// What a compromised exchange backend exposes (GET /admin/hot-wallets). No "is-decoy" marker — the decoy
// is indistinguishable, and the attacker's own "rank by balance" picks it first. (services/redteam)
export type HotWallet = { label: string; address: string; kind: 'eoa' | 'vault'; balanceEth: number; decoy?: boolean }
export const HOT_WALLETS: HotWallet[] = [
  { label: 'hot-main-01', address: '0x3f8a…1c47', kind: 'eoa', balanceEth: 1240 },
  { label: 'hot-overflow-07', address: '0x5c11…d07a', kind: 'eoa', balanceEth: 8820, decoy: true },
  { label: 'ops-gas-02', address: '0x77aa…9e10', kind: 'eoa', balanceEth: 46 },
  { label: 'hot-main-02', address: '0x1be2…4421', kind: 'eoa', balanceEth: 2110 },
  { label: 'vault-hot', address: '0x4b2c…f031', kind: 'vault', balanceEth: 0 },
]

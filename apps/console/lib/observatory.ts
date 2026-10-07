// Observatory model: pure terrain generation and replay state. No three.js, no React, so it is testable.
// Everything here is synthetic (source: assumed). Real data enters only through `Replay` (see demoReplay).

export const R = 15
export type Kind = 'terrain' | 'vault' | 'decoy' | 'account'
export type Exchange = { id: string; name: string; served: boolean; q: number; r: number }
export type Cell = {
  key: string
  q: number
  r: number
  x: number
  y: number
  kind: Kind
  exchange: string
  served: boolean
  tier?: 'Hot' | 'Warm' | 'Cold'
  quota: number
  height: number
  index: number
}

/** One incident replay. Times are seconds from replay start. Backend seam: build this from /api/timeline points. */
export type Replay = {
  caseLabel: string
  duration: number
  hitAt: number
  freezeAt: number
  shareAt: number
  /** cell key of the touched object; officer-only once it comes from the server */
  threatKey: string
  /** exchange whose hot vault is restricted, and the exchange that receives the shared threat */
  frozenExchange: string
  sharedExchange: string
  source: 'testnet_measured' | 'public_onchain' | 'assumed'
}

export const EXCHANGES: Exchange[] = [
  { id: 'A', name: 'Atlas', served: true, q: -5, r: 10 },
  { id: 'B', name: 'Beacon', served: true, q: 38, r: 15 },
  { id: 'C', name: 'Cinder', served: false, q: -43, r: 17 },
  { id: 'D', name: 'Delta', served: true, q: 0, r: -27 },
  { id: 'E', name: 'Ember', served: false, q: 48, r: -28 },
  { id: 'F', name: 'Fjord', served: false, q: -42, r: -29 },
]
export const TIERS = [
  { name: 'Hot', dr: 6, height: 62 },
  { name: 'Warm', dr: 4, height: 122 },
  { name: 'Cold', dr: 1, height: 195 },
] as const

// Synthetic positions for the demo only; with live data these come from an officer-only server route (rule 2).
export const DEMO_DECOY_KEYS = ['4:5', '29:7', '9:12']

export const demoReplay: Replay = {
  caseLabel: 'DEMO-024',
  duration: 12,
  hitAt: 1,
  freezeAt: 4,
  shareAt: 8,
  threatKey: '9:12',
  frozenExchange: 'A',
  sharedExchange: 'B',
  source: 'assumed',
}

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

export function stateAt(rp: Replay, t: number) {
  return { hit: t >= rp.hitAt, frozen: t >= rp.freezeAt, shared: t >= rp.shareAt }
}

function hexDistance(q: number, r: number, cq: number, cr: number) {
  const dq = q - cq
  const dr = r - (q - (Math.abs(q) % 2)) / 2 - cr + (cq - (Math.abs(cq) % 2)) / 2
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr))
}

function regionAt(q: number, r: number) {
  const west = -23 + Math.sin(r * 0.105) * 6 + Math.sin(r * 0.28 + 1) * 2.1
  const east = 20 + Math.sin((r - 12) * 0.105) * 4.5 + Math.sin((r - 12) * 0.27) * 1.6
  const north = -11 + Math.sin(q * 0.095) * 5.5 + Math.sin(q * 0.25 + 2) * 2
  const westWidth = 1.3 + (Math.sin(r * 0.14 + 1) + 1) * 1.1
  const eastWidth = 1.1 + (Math.sin(r * 0.18 - 1) + 1) * 1.15
  const northWidth = 1.1 + (Math.sin(q * 0.13) + 1) * 0.95
  const river =
    Math.min(Math.abs(q - west) / westWidth, Math.abs(q - east) / eastWidth, Math.abs(r - north) / northWidth) < 1
  const col = q < west ? 2 : q > east ? 1 : 0
  return { river, region: EXCHANGES[col + (r < north ? 3 : 0)] }
}

export function buildCells(decoyKeys: string[]): Cell[] {
  const cells: Cell[] = []
  const decoys = decoyKeys.map((k) => k.split(':').map(Number))
  for (let q = -60; q < 100; q++)
    for (let r = -45; r < 65; r++) {
      const { river, region } = regionAt(q, r)
      if (river) continue
      const key = `${q}:${r}`
      const seed = ((((q * 73 + r * 37) % 101) + 101) % 101) / 101
      const radius = hexDistance(q, r, region.q, region.r)
      const tier = radius <= 2 ? TIERS[2] : radius <= 4 ? TIERS[1] : radius <= 6 ? TIERS[0] : null
      const kind: Kind = decoyKeys.includes(key) ? 'decoy' : tier ? 'vault' : seed > 0.94 ? 'account' : 'terrain'
      const quota = kind === 'vault' ? 120 + Math.round(seed * 80) : Math.round((0.2 + seed * 4) * 100) / 100
      const ridge = ((Math.sin(q * 0.17 + r * 0.073) + 1) / 2) ** 3 * 100
      const hills = (Math.sin(q * 0.085 - r * 0.13) * Math.cos(r * 0.105 + q * 0.025) + 1) * 39
      const peaks = Math.max(0, Math.sin(q * 0.41 - r * 0.27) * Math.cos(r * 0.31)) * 65
      const basin = Math.exp(-((q - 9) ** 2 + (r - 12) ** 2) / 100)
      const center = Math.exp(-((q - region.q) ** 2 + (r - region.r + 3) ** 2) / 95)
      let base =
        12 + (ridge + hills + peaks) * (1 - Math.max(basin * 0.88, center * 0.85)) + seed * 16 + (seed > 0.94 ? 32 : 0)
      // Keep a low basin around every decoy so terrain cannot bury the signal.
      let clear = 0
      for (const [hq, hr] of decoys) {
        const dx = (q - hq) * 22.5
        const dz = (r - hr) * 26
        clear = Math.max(clear, 1 - Math.min(1, Math.max(0, Math.hypot(dx, dz) - 95) / 150))
        const fwd = dx * 0.26 + dz * 0.965
        const side = Math.abs(dx * 0.965 - dz * 0.26)
        if (fwd > 0 && fwd < 350 && side < 65) clear = Math.max(clear, (1 - side / 65) * (1 - fwd / 350))
      }
      base = base * (1 - clear) + 13 * clear
      cells.push({
        key,
        q,
        r,
        x: (q - 18.5) * R * 1.5,
        y: (r - 9.5 + (Math.abs(q) % 2) * 0.5) * R * Math.sqrt(3),
        kind,
        exchange: region.id,
        served: region.served,
        tier: tier?.name,
        quota,
        height: kind === 'vault' ? tier!.height : kind === 'decoy' ? 23 : base,
        index: cells.length + 1,
      })
    }
  return cells
}

export function hotVault(cells: Cell[], exchangeId: string) {
  const e = EXCHANGES.find((x) => x.id === exchangeId)!
  return cells.find((c) => c.q === e.q && c.r === e.r + 6)!
}

/** Column height at replay time t: the frozen hot vault sinks, served terrain carries a wave from the threat. */
export function heightAt(
  c: Cell,
  t: number,
  rp: Replay,
  ctx: { threat: Cell; vault: Cell; target: Cell },
  motion = true,
) {
  const h = c.height
  if (c.kind === 'vault' && c.tier === 'Hot' && c.exchange === rp.frozenExchange && t >= rp.freezeAt)
    return Math.max(3, h * (1 - clamp((t - rp.freezeAt) / 0.65, 0, 1)))
  if (!motion || !c.served || c.kind === 'vault' || c.kind === 'decoy' || t < rp.hitAt || t >= rp.duration - 2)
    return Math.max(2, h)
  const { threat, vault, target } = ctx
  const d = Math.hypot(c.x - threat.x, c.y - threat.y)
  const toVault = Math.hypot(vault.x - threat.x, vault.y - threat.y)
  const toNet = Math.hypot(target.x - threat.x, target.y - threat.y)
  const front =
    t <= rp.freezeAt
      ? ((t - rp.hitAt) * toVault) / (rp.freezeAt - rp.hitAt)
      : toVault + ((t - rp.freezeAt) * (toNet - toVault)) / (rp.shareAt - rp.freezeAt)
  const fade = clamp(t - rp.hitAt, 0, 1) * clamp((rp.duration - 2 - t) / 1.5, 0, 1)
  return Math.max(
    2,
    h +
      fade *
        (40 * Math.exp(-(((d - front) / 28) ** 2)) +
          23 * Math.exp(-(((d - front + 62) / 23) ** 2)) -
          6 * Math.exp(-(((d - front - 38) / 20) ** 2))),
  )
}

export function labelOf(c: Cell, decoyKeys: string[], masked: boolean) {
  if (c.kind === 'decoy')
    return masked ? 'Protected object' : `Honeypot ${String(decoyKeys.indexOf(c.key) + 1).padStart(2, '0')}`
  if (c.kind === 'vault') return `${c.tier} vault ${c.exchange}`
  if (c.kind === 'terrain') return `Terrain ${c.key}`
  return `Account ${String(c.index).padStart(3, '0')}`
}

/** Quorum multi-agency world — territories, protected infrastructure, incident clock (demo fixture) */
export type WorldMode = 'live' | 'trace'

export type Tiers = 1 | 2 | 3
export type Agency = {
  id: string
  letter: string
  name: string
  protected: boolean
  /** Voronoi seed */
  x: number
  z: number
  /** radial / tangential unit vectors of the territory frame */
  u: [number, number]
  v: [number, number]
  tiers?: Tiers
  core?: [number, number]
  /** exchange partner whose mark floats over the vault */
  brand?: 'bybit' | 'bitget'
  vault?: [number, number]
}
export type Decoy = { id: string; name: string; agency: string; x: number; z: number }

/** the central commons that hosts the one Global Quorum Core */
export const HUB = { x: 0.4, z: -0.3, weight: 2.05 }
export const GLOBAL: [number, number] = [HUB.x, HUB.z]

const RING = 17.2
const SPEC: [string, string, boolean, Tiers | 0, number, number][] = [
  // letter, name, protected, vault tiers, angle jitter, radius jitter
  ['A', 'Harbor Exchange', true, 3, 0.02, 0.2],
  ['B', 'Kestrel Custody', true, 3, -0.05, -0.6],
  ['C', 'Meridian DAO', false, 0, 0.04, 0.5],
  ['D', 'Halcyon Treasury', true, 2, -0.02, -0.2],
  ['E', 'Sable Agents', true, 1, 0.05, 0.6],
  ['F', 'Lumen Bank', false, 0, -0.03, -0.4],
  ['G', 'Vela Prime', true, 2, 0.01, 0.1],
]

export const loc = (a: Agency, du: number, dv: number): [number, number] => [a.x + a.u[0] * du + a.v[0] * dv, a.z + a.u[1] * du + a.v[1] * dv]

export const AGENCIES: Agency[] = SPEC.map(([letter, name, prot, tiers, aj, rj], i) => {
  const ang = 2.55 + i * (Math.PI * 2 / SPEC.length) + aj
  const u: [number, number] = [Math.cos(ang), Math.sin(ang)]
  const v: [number, number] = [-u[1], u[0]]
  const a: Agency = { id: `ag-${letter.toLowerCase()}`, letter, name, protected: prot, x: HUB.x + u[0] * (RING + rj), z: HUB.z + u[1] * (RING + rj), u, v }
  if (prot) {
    a.tiers = tiers as Tiers
    a.brand = i % 2 ? 'bitget' : 'bybit'
    a.core = loc(a, -3.6, 0.6)
    a.vault = loc(a, 1.9, 3.3)
  }
  return a
})
export const agency = (id: string) => AGENCIES.find((a) => a.id === id)!
export const PROTECTED = AGENCIES.filter((a) => a.protected)

/** sub-seeds give each territory lobes, long arms and asymmetric coastlines (local frame du, dv, weight) */
export const LOBES: Record<string, [number, number, number][]> = {
  'ag-a': [[5.5, 4.5, 1.15], [3, -7, 1.2]],
  'ag-b': [[6.5, -3, 1.1]],
  'ag-c': [[4, 6.5, 1.25], [9, 8, 1.4]],
  'ag-d': [[5, 5, 1.1], [7.5, -5.5, 1.35]],
  'ag-e': [[7, 0, 1.3]],
  'ag-f': [[3.5, -6, 1.2], [8, -2, 1.4]],
  'ag-g': [[6, 4, 1.15]],
}

/** the wider Quorum network — unnamed districts that continue beyond the camera */
export type District = { letter: string; x: number; z: number; w: number; density: number; lobes: [number, number, number][] }
const rnd = (i: number, k: number) => { const s = Math.sin(i * 91.7 + k * 47.3) * 43758.5453; return s - Math.floor(s) }
const LETTERS = 'HIJKLMNOPQRSTUVWXYZ'
export const DISTRICTS: District[] = (() => {
  const out: District[] = []
  const rings: [number, number][] = [[34, 11], [50, 15], [68, 19], [90, 24], [116, 28], [146, 32]]
  let i = 0
  for (const [r, n] of rings) for (let k = 0; k < n; k++, i++) {
    const ang = (k / n) * Math.PI * 2 + rnd(i, 1) * 0.5 + r * 0.013
    const rr = r + (rnd(i, 2) - 0.5) * 9
    const x = HUB.x + Math.cos(ang) * rr, z = HUB.z + Math.sin(ang) * rr
    const lobes: [number, number, number][] = Array.from({ length: 1 + Math.floor(rnd(i, 3) * 3) }, (_, j) => {
      const la = rnd(i, 10 + j) * Math.PI * 2, ld = 4 + rnd(i, 20 + j) * 6
      return [Math.cos(la) * ld, Math.sin(la) * ld, 1.05 + rnd(i, 30 + j) * 0.35]
    })
    out.push({ letter: i < LETTERS.length ? LETTERS[i] : `${LETTERS[i % LETTERS.length]}${Math.floor(i / LETTERS.length) + 1}`, x, z, w: 0.95 + rnd(i, 4) * 0.25, density: 0.3 + rnd(i, 5) * 0.7, lobes })
  }
  return out
})()

/** decoys: positioned in each protected territory's local frame */
const DECOY_SPEC: [string, string, number, number][] = [
  ['ag-a', 'DW-07', 5.6, -2.6],
  ['ag-a', 'DW-12', -0.4, -4.4],
  ['ag-b', 'DW-21', 4.8, -2.4],
  ['ag-b', 'DW-24', -1.2, 4.4],
  ['ag-d', 'DW-34', 5.4, -2.2],
  ['ag-d', 'DW-38', -0.8, -4.2],
  ['ag-e', 'DW-41', 4.6, -2.0],
  ['ag-g', 'DW-52', 5.0, -2.6],
]
export const DECOYS: Decoy[] = DECOY_SPEC.map(([ag, name, du, dv]) => {
  const [x, z] = loc(agency(ag), du, dv)
  return { id: `dc-${name.slice(3)}`, name, agency: ag, x, z }
})
export const ORIGIN_DECOY = DECOYS[0]
export const ORIGIN_AGENCY = agency(ORIGIN_DECOY.agency)
/** protected agencies that receive shared intelligence, nearest first */
export const RECEIVERS = PROTECTED.filter((a) => a.id !== ORIGIN_AGENCY.id)
  .map((a) => ({ a, d: Math.hypot(a.x - ORIGIN_AGENCY.x, a.z - ORIGIN_AGENCY.z) }))
  .sort((p, q) => p.d - q.d)
  .map((p) => p.a)

/** Incident clock (seconds) */
export const T = {
  approach: 0,
  trigger: 0.6,
  marker: 1.1,
  pulse: 1.5,
  ripple: 1.8,
  beeGo: 1.2,
  toVault: 1.9,
  toVaultEnd: 3.0,
  email: 3.05,
  toLocal: 2.6,
  toLocalEnd: 3.5,
  toGlobal: 3.7,
  toGlobalEnd: 5.1,
  liftoff: 5.4,
  dispatch: 6.0,
  dispatchGap: 0.75,
  dispatchDur: 1.8,
  end: 14,
}
export const arriveAt = (i: number) => T.dispatch + i * T.dispatchGap + T.dispatchDur
export const ALL_RECEIVED = arriveAt(RECEIVERS.length - 1)

export const STEPS: { at: number; label: string }[] = [
  { at: T.approach, label: 'Hostile wallet approaches DW-07' },
  { at: T.trigger, label: 'Decoy DW-07 triggered' },
  { at: T.marker, label: 'Malicious interaction marked' },
  { at: T.beeGo, label: 'Patrol bee dispatched to DW-07' },
  { at: T.ripple, label: 'Incident ripple expanding' },
  { at: T.toVault, label: 'Alert routed to Agency A vault' },
  { at: T.toLocal, label: 'Bee couriers signal to local core' },
  { at: T.email, label: 'Vault incident notice delivered' },
  { at: T.toGlobal, label: 'Evidence routed to Quorum Core' },
  { at: T.liftoff, label: 'Verified · courier dispatched' },
  { at: T.dispatch, label: 'Protected agencies receiving' },
  { at: ALL_RECEIVED, label: 'Network aware · 4 of 4 protected' },
]
export const stepAt = (t: number) => (t < 0 ? -1 : STEPS.reduce((a, s, i) => (t >= s.at ? i : a), 0))

/** Trace Origin clock — awareness contracts back to the source */
export const TR = { cut: [2.2, 3.1, 4.0], area: 4.8, found: 6.2, end: 7.6 }
export function traceCaption(tr: number) {
  if (tr < TR.cut[0]) return 'Contracting from network-wide awareness'
  if (tr < TR.area) return `Narrowing · ${4 - TR.cut.filter((c) => tr >= c).length} candidate routes`
  if (tr < TR.found) return 'One territory · Agency A'
  return 'Origin · Decoy DW-07'
}
/** candidate origins during trace narrowing; the last one is the true source */
export const TRACE_CANDIDATES = ['ag-b', 'ag-g', 'ag-e', 'ag-a']

/** world position + structure top height, for overlays and routes */
export const TOP = { global: 14.6, core: 3.0, decoy: 1.7, vault: [0, 1.5, 2.4, 3.2] as const }

export type Pickable = { kind: 'global' } | { kind: 'core' | 'vault' | 'area'; agency: string } | { kind: 'decoy'; id: string }
export const parsePick = (id: string): Pickable | null => {
  const [k, v] = id.split(':')
  if (k === 'global') return { kind: 'global' }
  if (k === 'decoy') return DECOYS.some((d) => d.id === v) ? { kind: 'decoy', id: v } : null
  if ((k === 'core' || k === 'vault' || k === 'area') && AGENCIES.some((a) => a.id === v)) return { kind: k, agency: v }
  return null
}
export function anchorOf(id: string): [number, number, number] | null {
  const p = parsePick(id)
  if (!p) return null
  if (p.kind === 'global') return [GLOBAL[0], TOP.global, GLOBAL[1]]
  if (p.kind === 'decoy') { const d = DECOYS.find((x) => x.id === p.id)!; return [d.x, TOP.decoy, d.z] }
  const a = agency(p.agency)
  if (p.kind === 'core' && a.core) return [a.core[0], TOP.core, a.core[1]]
  if (p.kind === 'vault' && a.vault) return [a.vault[0], TOP.vault[a.tiers!], a.vault[1]]
  return [a.x, 0.4, a.z]
}

/** hover copy — name plus one line */
export function hoverOf(id: string): [string, string] | null {
  const p = parsePick(id)
  if (!p) return null
  if (p.kind === 'global') return ['Global Quorum Core', 'Network verification · 5 agencies']
  if (p.kind === 'decoy') { const d = DECOYS.find((x) => x.id === p.id)!; return [`Decoy ${d.name}`, `Agency ${agency(d.agency).letter} · honeypot`] }
  const a = agency(p.agency)
  if (p.kind === 'core') return [`Local Core · ${a.letter}`, a.name]
  if (p.kind === 'vault') return [`Vault · ${['', 'Hot', 'Hot + Warm', 'Hot + Warm + Cold'][a.tiers!]}`, a.name]
  return a.protected ? [a.name, 'Protected by Quorum'] : ['NOT ONBOARDED', 'No Quorum protection active']
}

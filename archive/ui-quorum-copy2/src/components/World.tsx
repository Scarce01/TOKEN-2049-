import { Suspense, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import chainlinkPng from '../imports/chainlink.png'
import nownodesPng from '../imports/nownodes_-_Copy.png'
import bybitPng from '../imports/bybit-community.png'
import bitgetPng from '../imports/bitget.png'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Line, OrbitControls, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import {
  AGENCIES, ALL_RECEIVED, DECOYS, DISTRICTS, GLOBAL, HUB, LOBES, ORIGIN_AGENCY, ORIGIN_DECOY, PROTECTED, RECEIVERS, T, TOP, TR, TRACE_CANDIDATES,
  anchorOf, arriveAt, hoverOf, loc, parsePick, type Agency, type Decoy, type District, type WorldMode,
} from './worldData'

/* ------------------------------------------------------------------ shared state */

export type SceneState = { t: number; tr: number; mode: WorldMode; selected: string | null; hover: string | null }
const SCtx = createContext<React.RefObject<SceneState> | null>(null)
const useS = () => useContext(SCtx)!.current!

const cl = (x: number) => Math.max(0, Math.min(1, x))
const ss = (t: number, a: number, b: number) => { const x = cl((t - a) / (b - a)); return x * x * (3 - 2 * x) }
const bell = (x: number) => Math.exp(-x * x)
const h01 = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s) }
/** 0 → 1 → 0 envelope: rises at a, holds, decays over `fall` after b */
const env = (t: number, a: number, b: number, fall = 0.6) => ss(t, a, a + 0.25) * (1 - ss(t, b, b + fall))
const live = (S: SceneState) => S.mode === 'live' && S.t >= 0
const tracing = (S: SceneState) => S.mode === 'trace' && S.tr >= 0
/** when each agency's local core receives the signal */
const receivedAt = (id: string) => (id === ORIGIN_AGENCY.id ? T.toLocalEnd : (() => { const i = RECEIVERS.findIndex((a) => a.id === id); return i < 0 ? Infinity : arriveAt(i) })())

const C = {
  wave: new THREE.Color('#e7b25a'),
  ack: new THREE.Color('#f3cf84'),
  red: new THREE.Color('#e2432f'),
  trace: new THREE.Color('#ff6a3d'),
  graphite: '#2a2a2e',
  graphite2: '#38373a',
  gold: '#b98d3c',
  honey: new THREE.Color('#ffb52e'),
  alarm: new THREE.Color('#ff3b24'),
}
/** matte architectural stone — warm ash, taupe, almond, apricot-grey */
const STONE = ['#8d8074', '#887a6d', '#918376', '#84786c', '#8b7c6e', '#8f8278'].map((c) => new THREE.Color(c))
const STONE_OUT = new THREE.Color('#77706a')
const STONE_HUB = new THREE.Color('#988a7b')

/* ------------------------------------------------------------------ territory field */

const RC = 0.5
const SQ3 = Math.sqrt(3)
const HUB_I = AGENCIES.length
const DIST0 = HUB_I + 1
const AG_I = Object.fromEntries(AGENCIES.map((a, i) => [a.id, i])) as Record<string, number>
type Seed = { x: number; z: number; w: number; reg: number }
const SEEDS: Seed[] = [
  ...AGENCIES.flatMap((a, i) => [{ x: a.x, z: a.z, w: 1, reg: i }, ...(LOBES[a.id] ?? []).map(([du, dv, w]) => { const [x, z] = loc(a, du, dv); return { x, z, w, reg: i } })]),
  { x: HUB.x, z: HUB.z, w: HUB.weight, reg: HUB_I },
  ...DISTRICTS.flatMap((d, j) => [{ x: d.x, z: d.z, w: d.w, reg: DIST0 + j }, ...d.lobes.map(([dx, dz, w]) => ({ x: d.x + dx, z: d.z + dz, w, reg: DIST0 + j }))]),
]
/** smooth value noise */
const vn = (x: number, z: number) => {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz)
  const a = h01(xi, zi), b = h01(xi + 1, zi), c = h01(xi, zi + 1), d = h01(xi + 1, zi + 1)
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz
}
const fbm = (x: number, z: number) => vn(x, z) * 0.6 + vn(x * 2.1 + 5.2, z * 2.1 - 1.3) * 0.3 + vn(x * 4.3 - 2, z * 4.3 + 7) * 0.1
const riverW = (x: number, z: number, rad: number) => (1.1 + 0.35 * Math.sin(x * 0.17 + z * 0.09) + 0.25 * Math.sin(z * 0.31 - x * 0.07)) * (1 + rad / 140)

/** structure footprints that sit on a flattened plateau */
const PADS: [number, number, number, number][] = [
  [GLOBAL[0], GLOBAL[1], 5.4, 0.18],
  ...PROTECTED.flatMap((a) => [[a.core![0], a.core![1], 1.8, 0.12], [a.vault![0], a.vault![1], 2.3, 0.14]] as [number, number, number, number][]),
  ...DECOYS.map((d) => [d.x, d.z, 1.05, 0.08] as [number, number, number, number]),
]
const padTop = (id: 'global' | 'core' | 'vault' | 'decoy') => ({ global: 0.18, core: 0.12, vault: 0.14, decoy: 0.08 })[id]
const nearPad = (x: number, z: number, m: number) => PADS.some(([px, pz, pr]) => Math.hypot(x - px, z - pz) < pr + m)

type Field = { n: number; rc: number; x: Float32Array; z: Float32Array; y: Float32Array; reg: Int16Array; dO: Float32Array; base: THREE.Color[] }
type Wave = { x: number; z: number; t0: number; reg: number; amp: number; v: number; life: number; rings: number }
type Bridge = { a: THREE.Vector3; b: THREE.Vector3; t0: number }

function buildField(rc: number, r0: number, r1: number): Field {
  const xs: number[] = [], zs: number[] = [], ys: number[] = [], rg: number[] = [], base: THREE.Color[] = []
  const qn = Math.ceil(r1 / (1.5 * rc)), rn = Math.ceil(r1 / (SQ3 * rc))
  for (let q = -qn; q <= qn; q++) {
    for (let r = -rn; r <= rn; r++) {
      const x = q * 1.5 * rc, z = (r + (q & 1) * 0.5) * SQ3 * rc
      const rad = Math.hypot(x - HUB.x, z - HUB.z)
      if (rad < r0 || rad >= r1) continue
      // warped weighted Voronoi over lobed seeds — rivers meander along region borders
      const wx = x + 1.9 * Math.sin(z * 0.13 + 1.3) + 0.8 * Math.sin(z * 0.41), wz = z + 1.9 * Math.sin(x * 0.12 - 0.7) + 0.8 * Math.sin(x * 0.37)
      let d1 = Infinity, d2 = Infinity, r1i = 0
      for (const s of SEEDS) {
        const d = Math.hypot(wx - s.x, wz - s.z) * s.w
        if (d < d1) { if (s.reg !== r1i) d2 = d1; d1 = d; r1i = s.reg } else if (s.reg !== r1i && d < d2) d2 = d
      }
      const pad = nearPad(x, z, 1.2)
      const gap = d2 - d1, erode = 1.5 * fbm(x * 0.16 + 3, z * 0.16)
      const w = riverW(x, z, rad) * (r1i === HUB_I ? 1.45 : 1) + erode
      const islet = gap > 0.45 && vn(x * 0.55, z * 0.55) > 0.86
      if (gap < w && !pad && !islet) continue
      // inland honey ponds break up large territories
      if (!pad && fbm(x * 0.075 + 11, z * 0.075 - 4) > 0.73) continue
      // mostly flat: soft stepped relief and gentle ridges, flattened plateaus under structures
      const n = fbm(x * 0.09, z * 0.09)
      let y = Math.floor(Math.max(0, n - 0.42) * 9) * 0.04 + 0.05 * Math.max(0, 1 - Math.abs(vn(x * 0.06 + 9, z * 0.06) * 2 - 1) * 5)
      y += h01(Math.round(x * 2), Math.round(z * 2)) > 0.93 ? 0.03 : 0
      for (const [px, pz, pr, ph] of PADS) if (Math.hypot(x - px, z - pz) < pr) y = ph
      const ag = AGENCIES[r1i]
      const tone = r1i === HUB_I ? STONE_HUB : ag && !ag.protected ? STONE_OUT : STONE[r1i % STONE.length]
      const c = tone.clone().multiplyScalar((0.93 + 0.12 * h01(x, z)) * (1 - 0.5 * ss(rad, 36, 170)))
      xs.push(x); zs.push(z); ys.push(y); rg.push(r1i); base.push(c)
    }
  }
  const nn = xs.length
  const dO = new Float32Array(nn)
  for (let i = 0; i < nn; i++) dO[i] = Math.hypot(xs[i] - ORIGIN_DECOY.x, zs[i] - ORIGIN_DECOY.z)
  return { n: nn, rc, x: Float32Array.from(xs), z: Float32Array.from(zs), y: Float32Array.from(ys), reg: Int16Array.from(rg), dO, base }
}
/** animated near field, static midground, coarse far field that fades into the night */
const NEAR_R = 44
const FIELD = buildField(RC, 0, NEAR_R)
const MID = buildField(RC, NEAR_R, 96)
const FAR = buildField(RC * 2, 96, 205)
/** per-tile ripple displacement, shared with low-rise structures riding the near field */
const DY = new Float32Array(FIELD.n)

/** wave sources + river bridges derived from the incident clock and real territory geometry */
const ORIGIN_V = 4.6
const { WAVES, BRIDGES } = (() => {
  const F = FIELD, oi = AG_I[ORIGIN_AGENCY.id]
  const waves: Wave[] = [{ x: ORIGIN_DECOY.x, z: ORIGIN_DECOY.z, t0: T.ripple, reg: oi, amp: 0.9, v: ORIGIN_V, life: 7, rings: 4 }]
  const bridges: Bridge[] = []
  for (const a of PROTECTED) {
    if (a.id === ORIGIN_AGENCY.id) continue
    const ri = AG_I[a.id]
    let best = -1, bd = Infinity
    for (let i = 0; i < F.n; i++) if (F.reg[i] === ri && F.dO[i] < bd) { bd = F.dO[i]; best = i }
    if (best < 0 || bd > 22) continue
    let src = -1, sd = Infinity
    for (let i = 0; i < F.n; i++) if (F.reg[i] === oi) { const d = Math.hypot(F.x[i] - F.x[best], F.z[i] - F.z[best]); if (d < sd) { sd = d; src = i } }
    const t0 = T.ripple + F.dO[src] / ORIGIN_V
    bridges.push({ a: new THREE.Vector3(F.x[src], 0.2, F.z[src]), b: new THREE.Vector3(F.x[best], 0.2, F.z[best]), t0 })
    // softer acknowledgement wave in the receiving territory
    waves.push({ x: F.x[best], z: F.z[best], t0: t0 + 0.7, reg: ri, amp: 0.26, v: 4.0, life: 4.4, rings: 2 })
  }
  waves.push({ x: ORIGIN_AGENCY.core![0], z: ORIGIN_AGENCY.core![1], t0: T.toLocalEnd, reg: oi, amp: 0.16, v: 4.4, life: 2.8, rings: 1 })
  waves.push({ x: GLOBAL[0], z: GLOBAL[1], t0: T.toGlobalEnd, reg: HUB_I, amp: 0.22, v: 4, life: 2.6, rings: 2 })
  RECEIVERS.forEach((a, i) => waves.push({ x: a.core![0], z: a.core![1], t0: arriveAt(i), reg: AG_I[a.id], amp: 0.16, v: 4.2, life: 3.2, rings: 1 }))
  return { WAVES: waves, BRIDGES: bridges }
})()
const RING_GAP = 2.9

/* ------------------------------------------------------------------ DOM overlays */

function Overlay({ at, layer = 10, render }: { at: THREE.Vector3; layer?: number; render: (el: HTMLDivElement, S: SceneState) => boolean }) {
  const S = useS()
  const { gl } = useThree()
  const el = useRef<HTMLDivElement | null>(null)
  const v = useMemo(() => new THREE.Vector3(), [])
  useEffect(() => {
    const parent = gl.domElement.parentElement
    if (!parent) return
    const w = document.createElement('div')
    w.className = 'pointer-events-none absolute left-0 top-0'
    w.style.zIndex = String(layer)
    const inner = document.createElement('div')
    inner.className = '-translate-x-1/2 -translate-y-full'
    const content = document.createElement('div')
    inner.appendChild(content)
    w.appendChild(inner)
    parent.appendChild(w)
    el.current = content
    return () => { el.current = null; w.remove() }
  }, [gl, layer])
  useFrame(({ camera, size }) => {
    const d = el.current
    if (!d) return
    const w = d.parentElement!.parentElement!
    v.copy(at).project(camera)
    const sx = (v.x + 1) * size.width / 2, sy = (1 - v.y) * size.height / 2
    const show = render(d, S) && v.z < 1 && sx > 40 && sx < size.width - 40 && sy > 60 && sy < size.height - 80
    w.style.visibility = show ? 'visible' : 'hidden'
    w.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`
  })
  return null
}
const setCls = (el: HTMLElement, c: string) => { if (el.className !== c) el.className = c }
const setTxt = (el: HTMLElement, t: string) => { if (el.textContent !== t) el.textContent = t }

function AgencyLabel({ a }: { a: Agency }) {
  const at = useMemo(() => new THREE.Vector3(a.x + a.u[0] * 2.4 + a.v[0] * 0.6, 0.7, a.z + a.u[1] * 2.4 + a.v[1] * 0.6), [a])
  const build = (el: HTMLDivElement) => {
    if (!el.childElementCount) el.innerHTML = '<div class="flex items-center gap-1.5 justify-center"><span></span><span class="font-mono text-[11px] tracking-[0.22em] text-[#efe7d6]"></span></div><div class="mt-0.5 text-center font-mono text-[9px] tracking-[0.18em]"></div>'
    return el.children as unknown as HTMLElement[]
  }
  return (
    <Overlay at={at} render={(el, S) => {
      const [row, sub] = build(el)
      const dot = row.children[0] as HTMLElement, name = row.children[1] as HTMLElement
      setTxt(name, `AGENCY ${a.letter}`)
      let tone = a.protected ? 'bg-[#d6a61f]' : 'border border-[#8a877f]'
      let line = a.protected ? 'PROTECTED' : 'UNPROTECTED'
      let lineCls = a.protected ? 'text-[#c9a65a]' : 'text-[#7d7a73]'
      let op = a.protected ? 1 : 0.7
      if (live(S) && a.id === ORIGIN_AGENCY.id && S.t >= T.trigger) { tone = 'bg-[#ff4b38] shadow-[0_0_8px_#ff4b38]'; line = 'INCIDENT ORIGIN'; lineCls = 'text-[#ff8f7c]' }
      if (tracing(S)) {
        const isO = a.id === ORIGIN_AGENCY.id
        if (isO) { tone = 'bg-[#ff4b38] shadow-[0_0_8px_#ff4b38]'; if (S.tr >= TR.area) { line = 'TRACE · ORIGIN'; lineCls = 'text-[#ff8f7c]' } }
        else if (S.tr >= TR.area) op = 0.35
      }
      if (S.selected) op = Math.min(op, 0.45)
      setCls(dot, `w-1.5 h-1.5 rounded-full ${tone}`)
      setTxt(sub, line); setCls(sub, `mt-0.5 text-center font-mono text-[9px] tracking-[0.18em] ${lineCls}`)
      el.style.opacity = String(op)
      setCls(el, 'px-2 py-1 transition-opacity duration-500 [text-shadow:0_1px_8px_rgba(5,8,16,.9)]')
      return true
    }} />
  )
}

/** the wider network — name only, fading with the night */
const NEAR_DISTRICTS = DISTRICTS.filter((d, i) => Math.hypot(d.x - HUB.x, d.z - HUB.z) < 40 && i % 2 === 0)
function DistrictLabel({ d }: { d: District }) {
  const at = useMemo(() => new THREE.Vector3(d.x, 0.6, d.z), [d])
  return (
    <Overlay at={at} render={(el, S) => {
      if (!el.childElementCount) {
        el.className = 'text-center font-mono [text-shadow:0_1px_8px_rgba(5,8,16,.9)] transition-opacity duration-500'
        el.innerHTML = `<div class="text-[10px] tracking-[0.22em] text-[#b8ae9e]">AGENCY ${d.letter}</div><div class="text-[8.5px] tracking-[0.18em] text-[#6f6b64]">UNPROTECTED</div>`
      }
      el.style.opacity = S.selected ? '0.25' : '0.6'
      return true
    }} />
  )
}

/** brief acknowledgement over a receiving Local Core */
function ReceivedLabel({ a, i, text }: { a: Agency; i: number; text?: string }) {
  const at = useMemo(() => new THREE.Vector3(a.core![0], TOP.core + 1.1, a.core![1]), [a])
  const t0 = receivedAt(a.id)
  return (
    <Overlay at={at} layer={22} render={(el, S) => {
      const age = live(S) ? S.t - t0 : -1
      const on = age >= 0 && age < 3
      if (on) {
        setCls(el, 'tag-in whitespace-nowrap px-2 py-1 rounded-[3px] bg-[#1a1408]/85 border border-[#d6a61f]/40 font-mono text-[9.5px] font-medium tracking-[0.2em] text-[#f3cf84] shadow-[0_0_18px_rgba(255,190,80,.25)]')
        setTxt(el, text ?? (i % 2 ? 'NETWORK ALERT RECEIVED' : 'THREAT INTEL RECEIVED'))
        el.style.opacity = String(1 - ss(age, 2.4, 3))
      }
      return on
    }} />
  )
}

function HoverLabel({ id }: { id: string }) {
  const at = useMemo(() => { const p = anchorOf(id)!; return new THREE.Vector3(p[0], p[1] + 0.8, p[2]) }, [id])
  const copy = hoverOf(id)
  return (
    <Overlay at={at} layer={30} render={(el) => {
      if (!copy) return false
      if (!el.childElementCount) {
        el.className = 'px-2.5 py-1.5 rounded-[4px] bg-[#0c1018]/92 border border-white/10 backdrop-blur-sm shadow-[0_6px_18px_rgba(0,0,0,.35)]'
        el.innerHTML = `<div class="text-[12px] font-medium text-[#f0ece2] whitespace-nowrap"></div><div class="font-mono text-[10px] text-[#9d988c] whitespace-nowrap"></div>`
        setTxt(el.children[0] as HTMLElement, copy[0]); setTxt(el.children[1] as HTMLElement, copy[1])
      }
      return true
    }} />
  )
}

/* ------------------------------------------------------------------ terrain + river */

type Pick = { hover: (id: string | null) => void; select: (id: string | null) => void }
const pickOf = (pick: Pick, id: string) => ({
  onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); pick.hover(id) },
  onPointerOut: () => pick.hover(null),
  onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); pick.select(id) },
})
const regionPick = (ri: number) => (ri === HUB_I ? 'global' : ri < HUB_I ? `area:${AGENCIES[ri].id}` : null)

const tileGeo = (rc: number) => {
  const sh = new THREE.Shape()
  for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; const p: [number, number] = [Math.cos(a) * rc * 0.94, Math.sin(a) * rc * 0.94]; if (k) sh.lineTo(...p); else sh.moveTo(...p) }
  const g = new THREE.ExtrudeGeometry(sh, { depth: 1.2, bevelEnabled: true, bevelSize: 0.02 * rc * 2, bevelThickness: 0.02, bevelSegments: 1 })
  g.rotateX(-Math.PI / 2)
  g.translate(0, -1.2, 0)
  return g
}
const noRay = () => null

/** static midground / far field — same honeycomb continuing beyond the view */
function StaticField({ F }: { F: Field }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const geo = useMemo(() => tileGeo(F.rc), [F])
  useEffect(() => {
    const mesh = ref.current!, m = new THREE.Matrix4()
    for (let i = 0; i < F.n; i++) { m.makeTranslation(F.x[i], F.y[i], F.z[i]); mesh.setMatrixAt(i, m); mesh.setColorAt(i, F.base[i]) }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [F])
  return (
    <instancedMesh ref={ref} args={[geo, undefined, F.n]} raycast={noRay} receiveShadow={F === MID}>
      <meshStandardMaterial roughness={0.92} metalness={0.02} />
    </instancedMesh>
  )
}

function Terrain({ pick }: { pick: Pick }) {
  const S = useS()
  const ref = useRef<THREE.InstancedMesh>(null)
  const geo = useMemo(() => tileGeo(RC), [])
  const m = useMemo(() => new THREE.Matrix4(), [])
  const col = useMemo(() => new THREE.Color(), [])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const F = FIELD, t = S.t, L = live(S), TRc = tracing(S), tr = S.tr
    const sel = S.selected?.split(':')[1]
    const selReg = sel && AG_I[sel] !== undefined ? AG_I[sel] : S.selected === 'global' ? HUB_I : -1
    const trig = L ? ss(t, T.trigger, T.trigger + 0.6) : TRc ? 1 : 0
    // trace: a ring of awareness contracting from the network edge onto the source decoy
    const ringR = 40 * (1 - ss(tr, 0.2, TR.found))
    const oi = AG_I[ORIGIN_AGENCY.id]
    for (let i = 0; i < F.n; i++) {
      const x = F.x[i], z = F.z[i], reg = F.reg[i]
      let dy = 0, glow = 0, ack = 0
      if (L) for (let wi = 0; wi < WAVES.length; wi++) {
        const w = WAVES[wi]
        if (w.reg !== reg) continue
        const age = t - w.t0
        if (age < 0 || age > w.life) continue
        const d = wi === 0 ? F.dO[i] : Math.hypot(x - w.x, z - w.z)
        const front = d - age * w.v
        if (front > 1.5) continue
        // concentric rings trailing the wavefront: a broad physical signal, not a shockwave
        let k = 0
        for (let r = 0; r < w.rings; r++) k += bell((front + r * RING_GAP) / 1.25) * (1 - r * 0.3)
        k *= (1 - age / w.life) * w.amp * Math.exp(-d / 26)
        dy += k
        if (wi === 0) glow += k; else ack += k
      }
      DY[i] = dy
      col.copy(F.base[i])
      if (selReg === reg) col.multiplyScalar(1.1)
      if (glow > 0) col.lerp(C.wave, cl(glow * 1.6))
      if (ack > 0) col.lerp(C.ack, cl(ack * 2.4))
      if (trig > 0 && reg === oi && F.dO[i] < 4.5) col.lerp(C.red, trig * 0.42 * (1 - F.dO[i] / 4.5) ** 1.6)
      if (TRc) {
        const k = bell((F.dO[i] - ringR) / 1.1) * (1 - ss(tr, TR.found, TR.end))
        if (k > 0.01) { col.lerp(C.trace, k * 0.7); dy += k * 0.2 }
        const cut = TRACE_CANDIDATES.findIndex((id) => AG_I[id] === reg)
        const out = reg !== oi && ((cut >= 0 && cut < 3 && tr >= TR.cut[cut]) || tr >= TR.area)
        if (out) col.multiplyScalar(1 - 0.38 * ss(tr, cut >= 0 && cut < 3 ? TR.cut[cut] : TR.area, (cut >= 0 && cut < 3 ? TR.cut[cut] : TR.area) + 0.6))
      }
      m.makeTranslation(x, F.y[i] + dy, z)
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, col)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={ref} args={[geo, undefined, FIELD.n]} castShadow receiveShadow frustumCulled={false}
      onPointerMove={(e) => { e.stopPropagation(); if (e.instanceId !== undefined) pick.hover(regionPick(FIELD.reg[e.instanceId])) }}
      onPointerOut={() => pick.hover(null)}
      onClick={(e) => { e.stopPropagation(); if (e.instanceId !== undefined) pick.select(regionPick(FIELD.reg[e.instanceId])) }}>
      <meshStandardMaterial roughness={0.9} metalness={0.02} />
    </instancedMesh>
  )
}

/* low-rise city fabric — open streets, occasional clusters, distant district lights */
type Bldg = { x: number; z: number; y: number; s: number; h: number; tile: number; lit: number; c: THREE.Color }
const BLDGS: Bldg[] = (() => {
  const out: Bldg[] = []
  const dens = (reg: number) => {
    if (reg === HUB_I) return 0.006
    const a = AGENCIES[reg]
    if (a) return a.protected ? 0.016 + 0.012 * (a.tiers ?? 1) + 0.005 * DECOYS.filter((d) => d.agency === a.id).length : 0.014
    return 0.012 + 0.035 * DISTRICTS[reg - DIST0].density
  }
  for (const F of [FIELD, MID, FAR]) for (let i = 0; i < F.n; i++) {
    const x = F.x[i], z = F.z[i]
    if (h01(x * 1.7 + 3, z * 1.3) > dens(F.reg[i]) * (F === FAR ? 2.2 : 1) * (0.6 + 0.8 * vn(x * 0.2, z * 0.2))) continue
    if (nearPad(x, z, 1.3) || DECOYS.some((d) => Math.hypot(d.x - x, d.z - z) < 2)) continue
    const r = h01(z, x)
    const h = (0.16 + r * r * r * r * 1.5) * (F === FAR ? 1.5 : 1)
    const g = 0.2 + 0.07 * h01(x + 2, z)
    out.push({ x, z, y: F.y[i], s: F.rc / RC, h, tile: F === FIELD ? i : -1, lit: h01(x - 4, z + 9), c: new THREE.Color(g, g * 0.94, g * 0.88) })
  }
  return out
})()

function CityFabric() {
  const blocks = useRef<THREE.InstancedMesh>(null), lamps = useRef<THREE.InstancedMesh>(null)
  const geo = useMemo(() => { const g = new THREE.CylinderGeometry(RC * 0.8, RC * 0.86, 1, 6); g.rotateY(Math.PI / 6); g.translate(0, 0.5, 0); return g }, [])
  const capGeo = useMemo(() => { const g = new THREE.CylinderGeometry(RC * 0.5, RC * 0.5, 0.04, 6); g.rotateY(Math.PI / 6); return g }, [])
  const lit = useMemo(() => BLDGS.map((b, i) => [b, i] as const).filter(([b]) => b.lit < 0.55), [])
  const m = useMemo(() => new THREE.Matrix4(), [])
  const place = (live: boolean) => {
    const B = blocks.current!, L = lamps.current!
    BLDGS.forEach((b, i) => {
      if (live && b.tile < 0) return
      const dy = b.tile >= 0 ? DY[b.tile] : 0
      m.makeScale(b.s, b.h, b.s).setPosition(b.x, b.y + dy, b.z); B.setMatrixAt(i, m)
      if (!live) B.setColorAt(i, b.c)
    })
    lit.forEach(([b], j) => {
      if (live && b.tile < 0) return
      const dy = b.tile >= 0 ? DY[b.tile] : 0
      m.makeScale(b.s, b.s, b.s).setPosition(b.x, b.y + dy + b.h + 0.02, b.z); L.setMatrixAt(j, m)
      if (!live) L.setColorAt(j, new THREE.Color('#ffb24a').multiplyScalar(0.35 + b.lit))
    })
    B.instanceMatrix.needsUpdate = L.instanceMatrix.needsUpdate = true
    if (!live) { B.instanceColor!.needsUpdate = L.instanceColor!.needsUpdate = true; B.computeBoundingSphere(); L.computeBoundingSphere() }
  }
  useEffect(() => place(false)) // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(() => place(true))
  return (
    <>
      <instancedMesh ref={blocks} args={[geo, undefined, BLDGS.length]} castShadow receiveShadow raycast={noRay}>
        <meshStandardMaterial roughness={0.6} metalness={0.3} />
      </instancedMesh>
      <instancedMesh ref={lamps} args={[capGeo, undefined, lit.length]} raycast={noRay}>
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </>
  )
}

/* real dark honey: slow two-phase flow along a meandering direction field, viscous streaks, soft glints */
export const HONEY_VERT = /* glsl */ `
varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`
export const HONEY_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAge;   // origin ripple age (s), < 0 when idle
uniform float uAgeG;  // quorum core broadcast age
uniform vec2 uO;
uniform vec2 uG;
varying vec3 vW;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
vec2 flowDir(vec2 p) { float a = noise(p * 0.03) * 9.0 + noise(p * 0.009 + 3.0) * 4.0; return vec2(cos(a), sin(a)); }
float layer(vec2 p, vec2 d, float ph) {
  vec2 q = p - d * ph * 5.0;
  vec2 f = vec2(dot(q, d), dot(q, vec2(-d.y, d.x)));
  return fbm(f * vec2(0.16, 0.55));
}
float surf(vec2 p) {
  vec2 d = flowDir(p);
  float t = uTime * 0.035;
  float a = fract(t), b = fract(t + 0.5);
  float w = abs(a - 0.5) * 2.0;
  return mix(layer(p, d, a), layer(p + 13.7, d, b), w);
}
void main() {
  vec2 p = vW.xz;
  float h = surf(p);
  float e = 0.18;
  float gx = surf(p + vec2(e, 0.0)) - h, gz = surf(p + vec2(0.0, e)) - h;
  vec3 n = normalize(vec3(-gx / e * 0.45, 1.0, -gz / e * 0.45));
  vec3 V = normalize(cameraPosition - vW);
  // thick slow currents
  vec2 d = flowDir(p);
  float cur = smoothstep(0.52, 0.8, fbm(p * 0.045 - d * uTime * 0.05));
  vec3 deep = vec3(0.07, 0.028, 0.006), mid = vec3(0.2, 0.085, 0.014), caramel = vec3(0.42, 0.2, 0.04);
  vec3 col = mix(deep, mid, smoothstep(0.25, 0.8, h));
  col = mix(col, caramel, cur * 0.3 + smoothstep(0.62, 0.82, h) * 0.18);
  // glossy surface: moon key + warm city bounce, soft rim of night sky
  vec3 L1 = normalize(vec3(-0.45, 0.75, 0.4));
  vec3 L2 = normalize(vec3(uG.x - vW.x, 9.0, uG.y - vW.z));
  float s1 = pow(max(dot(reflect(-L1, n), V), 0.0), 70.0);
  float s2 = pow(max(dot(reflect(-L2, n), V), 0.0), 26.0) * exp(-length(p - uG) / 20.0);
  float fr = pow(1.0 - max(dot(n, V), 0.0), 4.0);
  col += vec3(1.0, 0.86, 0.62) * s1 * 0.55 + vec3(1.0, 0.68, 0.28) * s2 * 1.1 + vec3(0.05, 0.07, 0.13) * fr;
  col += vec3(0.42, 0.22, 0.05) * exp(-length(p - uG) / 16.0) * 0.32;
  // incident signal crossing the channels
  if (uAge >= 0.0) {
    float r = length(p - uO) - uAge * 4.6;
    float ring = exp(-r * r / 1.4) + 0.5 * exp(-pow(r + 2.9, 2.0) / 1.4);
    col += vec3(1.0, 0.62, 0.22) * ring * (1.0 - clamp(uAge / 7.0, 0.0, 1.0)) * 0.9;
  }
  if (uAgeG >= 0.0) {
    float r = length(p - uG) - uAgeG * 6.0;
    col += vec3(1.0, 0.78, 0.36) * exp(-r * r / 2.0) * (1.0 - clamp(uAgeG / 5.0, 0.0, 1.0)) * 0.6;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`

function Honey() {
  const S = useS()
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: HONEY_VERT, fragmentShader: HONEY_FRAG, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uAge: { value: -1 }, uAgeG: { value: -1 },
      uO: { value: new THREE.Vector2(ORIGIN_DECOY.x, ORIGIN_DECOY.z) }, uG: { value: new THREE.Vector2(GLOBAL[0], GLOBAL[1]) },
    }]),
  }), [])
  useFrame(({ clock }) => {
    const u = mat.uniforms
    u.uTime.value = clock.elapsedTime
    u.uAge.value = live(S) && S.t >= T.ripple ? S.t - T.ripple : -1
    u.uAgeG.value = live(S) && S.t >= T.toGlobalEnd ? S.t - T.toGlobalEnd : -1
  })
  return (
    <mesh rotation-x={-Math.PI / 2} position={[HUB.x, -0.32, HUB.z]} material={mat} raycast={noRay}>
      <circleGeometry args={[260, 64]} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ night sky */

const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
void main() {
  float y = normalize(vDir).y;
  vec3 horizon = vec3(0.055, 0.075, 0.13), zenith = vec3(0.012, 0.018, 0.04), below = vec3(0.04, 0.05, 0.085);
  vec3 c = y > 0.0 ? mix(horizon, zenith, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(horizon, below, clamp(-y * 4.0, 0.0, 1.0));
  c += vec3(0.05, 0.045, 0.06) * exp(-abs(y) * 14.0);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`
const FOG = '#0f1526'
function Sky() {
  const g = useRef<THREE.Group>(null)
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: SKY_FRAG,
  }), [])
  const stars = useMemo(() => {
    const n = 900, p = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const a = h01(i, 7) * Math.PI * 2, y = 0.12 + Math.pow(h01(i, 8), 0.7) * 0.88, r = Math.sqrt(1 - y * y)
      p.set([Math.cos(a) * r * 420, y * 420, Math.sin(a) * r * 420], i * 3)
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(p, 3))
    return geo
  }, [])
  useFrame(({ camera }) => { g.current!.position.copy(camera.position) })
  return (
    <group ref={g}>
      <mesh material={mat} raycast={noRay} renderOrder={-1}><sphereGeometry args={[480, 32, 16]} /></mesh>
      <points geometry={stars} raycast={noRay}><pointsMaterial size={1.3} sizeAttenuation={false} color="#c9d3ea" transparent opacity={0.35} fog={false} depthWrite={false} /></points>
    </group>
  )
}

/* ------------------------------------------------------------------ shared geometry */

const hexRing = (r: number, tube: number) => { const g = new THREE.TorusGeometry(r, tube, 4, 6); g.rotateX(Math.PI / 2); g.rotateY(Math.PI / 6); return g }
const gold = { color: C.gold, metalness: 0.85, roughness: 0.32 }
const graphite = { color: C.graphite, metalness: 0.35, roughness: 0.55 }

/** expanding ground pulse ring under a structure */
function PulseRing({ x, z, y = 0.2, r = 1, at, color = '#ffc54a' }: { x: number; z: number; y?: number; r?: number; at: (S: SceneState) => number; color?: string }) {
  const S = useS()
  const ref = useRef<THREE.Mesh>(null)
  const geo = useMemo(() => hexRing(1, 0.035), [])
  useFrame(() => {
    const mesh = ref.current!
    const age = at(S)
    const on = age >= 0 && age < 1.6
    mesh.visible = on
    if (!on) return
    mesh.scale.setScalar(r * (1 + age * 1.8))
    ;(mesh.material as THREE.MeshBasicMaterial).opacity = (1 - age / 1.6) * 0.9
  })
  return <mesh ref={ref} geometry={geo} position={[x, y, z]}><meshBasicMaterial color={color} transparent toneMapped={false} depthWrite={false} /></mesh>
}

/* ------------------------------------------------------------------ holographic brand emblems (supplied PNG artwork) */

const GLOW_TEX = (() => {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d')!, r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r; g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
})()

/** logo plane always faces the camera; artwork is drawn untouched, glow + plate + ring sit behind/below it */
function Emblem({ src, y, size, glow = '#ffc54a', act }: { src: string; y: number; size: number; glow?: string; act?: (S: SceneState) => number }) {
  const S = useS()
  const tex = useTexture(src)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const img = tex.image as { width: number; height: number }
  const asp = img.width / img.height
  const bb = useRef<THREE.Group>(null), ring = useRef<THREE.Mesh>(null)
  const glowM = useRef<THREE.MeshBasicMaterial>(null), ringM = useRef<THREE.MeshBasicMaterial>(null)
  const ringGeo = useMemo(() => { const g = new THREE.TorusGeometry(size * 0.55, 0.015, 6, 64); g.rotateX(Math.PI / 2); return g }, [size])
  const seed = useMemo(() => Math.random() * 10, [])
  useFrame(({ camera, clock }) => {
    const now = clock.elapsedTime + seed
    const k = act ? act(S) : 0
    bb.current!.quaternion.copy(camera.quaternion)
    bb.current!.position.y = y + Math.sin(now * 1.1) * size * 0.06
    bb.current!.scale.setScalar(1 + k * 0.12)
    glowM.current!.opacity = 0.35 + 0.08 * Math.sin(now * 1.7) + k * 0.6
    ring.current!.rotation.y = now * 0.4
    ringM.current!.opacity = 0.5 + k * 0.5
  })
  return (
    <group raycast={noRay}>
      <mesh ref={ring} geometry={ringGeo} position-y={y - size * 0.72}><meshBasicMaterial ref={ringM} color={glow} transparent toneMapped={false} depthWrite={false} /></mesh>
      <group ref={bb}>
        <mesh position-z={-0.02} raycast={noRay}><planeGeometry args={[size * 2.1, size * 2.1]} /><meshBasicMaterial ref={glowM} map={GLOW_TEX} color={glow} transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
        <mesh position-z={-0.01} raycast={noRay}><circleGeometry args={[size * 0.62, 48]} /><meshBasicMaterial color="#10131c" transparent opacity={0.35} depthWrite={false} /></mesh>
        <mesh raycast={noRay}><planeGeometry args={[size * asp, size]} /><meshBasicMaterial map={tex} transparent alphaTest={0.02} toneMapped={false} /></mesh>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ Global Quorum Core — the capital */

/** tapering tower segments: [radius bottom, radius top, height] */
const SPINE: [number, number, number][] = [[1.25, 1.12, 1.6], [1.08, 0.94, 1.7], [0.9, 0.76, 1.8], [0.72, 0.58, 1.7], [0.54, 0.4, 1.4]]
function GlobalCore({ pick }: { pick: Pick }) {
  const S = useS()
  const halos = useRef<(THREE.Mesh | null)[]>([]), crown = useRef<THREE.Group>(null)
  const shaft = useRef<THREE.MeshStandardMaterial>(null), cryst = useRef<THREE.MeshStandardMaterial>(null), lamp = useRef<THREE.PointLight>(null)
  const seams = useRef<THREE.MeshStandardMaterial>(null)
  const [x, z] = GLOBAL
  const y0 = padTop('global')
  const pylons = useMemo(() => Array.from({ length: 6 }, (_, k) => { const a = (k * Math.PI) / 3 + Math.PI / 6; return { a, x: Math.cos(a) * 2.35, z: Math.sin(a) * 2.35 } }), [])
  const segs = useMemo(() => SPINE.reduce<{ y: number; s: [number, number, number] }[]>((acc, s, i) => [...acc, { y: i ? acc[i - 1].y + acc[i - 1].s[2] + 0.12 : 1.05, s }], []), [])
  const HALO = useMemo(() => [{ g: hexRing(2.9, 0.07), y: 5.0, tilt: 0 }, { g: hexRing(2.15, 0.055), y: 6.9, tilt: 0.06 }, { g: hexRing(1.45, 0.045), y: 8.7, tilt: -0.05 }, { g: hexRing(3.15, 0.022), y: 5.0, tilt: 0 }], [])
  const rBase = useMemo(() => hexRing(3.05, 0.03), [])
  useFrame(({ clock }, dt) => {
    const now = clock.elapsedTime
    const act = live(S) ? env(S.t, T.toGlobalEnd, ALL_RECEIVED + 0.6, 1.4) : 0
    const burst = live(S) ? bell((S.t - T.toGlobalEnd - 0.15) / 0.35) : 0
    halos.current.forEach((h, i) => {
      if (!h) return
      h.rotation.y += dt * (i % 2 ? -1 : 1) * (0.1 + i * 0.04 + act * 0.8)
      h.position.y = HALO[i].y + Math.sin(now * 0.7 + i) * 0.07
    })
    crown.current!.rotation.y += dt * 0.25
    crown.current!.position.y = 10.2 + Math.sin(now * 0.9) * 0.08
    shaft.current!.emissiveIntensity = 0.6 + 0.1 * Math.sin(now * 1.4) + act * 1.4 + burst * 2.4
    seams.current!.emissiveIntensity = 0.35 + act * 0.9 + burst * 1.6
    cryst.current!.emissiveIntensity = 0.45 + act * 1.2 + burst * 2
    lamp.current!.intensity = 9 + act * 16 + burst * 24
  })
  return (
    <group position={[x, y0, z]} {...pickOf(pick, 'global')}>
    <group scale={1.3}>
      {/* stepped hex plinth */}
      <mesh position-y={0.16} castShadow receiveShadow><cylinderGeometry args={[3.55, 3.8, 0.32, 6]} /><meshStandardMaterial {...graphite} color={C.graphite2} /></mesh>
      <mesh position-y={0.46} castShadow receiveShadow><cylinderGeometry args={[3.0, 3.2, 0.28, 6]} /><meshStandardMaterial {...graphite} /></mesh>
      <mesh position-y={0.72} castShadow receiveShadow><cylinderGeometry args={[2.3, 2.5, 0.24, 6]} /><meshStandardMaterial {...graphite} color="#232327" /></mesh>
      <mesh geometry={rBase} position-y={0.61}><meshStandardMaterial {...gold} /></mesh>
      {/* six leaning buttresses forming a hex cage around the spine */}
      {pylons.map((p, i) => (
        <group key={i} position={[p.x, 0.84, p.z]} rotation-y={-p.a}>
          <mesh position={[-0.32, 2.3, 0]} rotation-z={0.16} castShadow>
            <boxGeometry args={[0.26, 4.7, 0.5]} />
            <meshStandardMaterial {...graphite} />
          </mesh>
          <mesh position={[-0.17, 2.3, 0]} rotation-z={0.16}>
            <boxGeometry args={[0.03, 4.3, 0.12]} />
            <meshStandardMaterial {...gold} emissive="#ffb43a" emissiveIntensity={0.18} />
          </mesh>
        </group>
      ))}
      {/* tapering dark spine with lit seams */}
      {segs.map(({ y, s: [rb, rt, h] }, i) => (
        <group key={i} position-y={y}>
          <mesh position-y={h / 2} castShadow receiveShadow><cylinderGeometry args={[rt, rb, h, 6]} /><meshStandardMaterial {...graphite} color={i % 2 ? '#2b2b2f' : '#26262a'} /></mesh>
          {[0, 1, 2, 3, 4, 5].map((k) => {
            const ang = (k * Math.PI) / 3 + Math.PI / 6, rr = ((rb + rt) / 2) * 0.87
            return <mesh key={k} position={[Math.cos(ang) * rr, h / 2, Math.sin(ang) * rr]} rotation-y={-ang + Math.PI / 2}>
              <boxGeometry args={[0.05, h * 0.78, 0.02]} />
              <meshStandardMaterial ref={i === 0 && k === 0 ? seams : undefined} color="#2a1c08" emissive="#ffb43a" emissiveIntensity={0.35} toneMapped={false} />
            </mesh>
          })}
          <mesh position-y={h + 0.06}><cylinderGeometry args={[rt + 0.06, rt + 0.06, 0.12, 6]} /><meshStandardMaterial {...gold} /></mesh>
        </group>
      ))}
      {/* inner light visible between buttresses */}
      <mesh position-y={2.6}><cylinderGeometry args={[1.35, 1.35, 3.2, 6, 1, true]} /><meshPhysicalMaterial color="#e9c37a" transparent opacity={0.1} roughness={0.1} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <mesh position-y={9.9}><cylinderGeometry args={[0.06, 0.12, 1.4, 6]} /><meshStandardMaterial ref={shaft} color="#5a3d10" emissive="#ffb43a" emissiveIntensity={0.6} toneMapped={false} /></mesh>
      {HALO.map((h, i) => (
        <mesh key={i} ref={(m) => { halos.current[i] = m }} geometry={h.g} rotation-x={h.tilt}>
          <meshStandardMaterial {...gold} emissive="#ffb43a" emissiveIntensity={i === 1 ? 0.25 : 0.08} />
        </mesh>
      ))}
      <group ref={crown}>
        <mesh position-y={0.4}><cylinderGeometry args={[0, 0.5, 0.8, 6]} /><meshStandardMaterial ref={cryst} color="#c99a3a" metalness={0.6} roughness={0.25} emissive="#ffb43a" emissiveIntensity={0.45} /></mesh>
        <mesh position-y={-0.3} rotation-x={Math.PI}><cylinderGeometry args={[0, 0.5, 0.6, 6]} /><meshStandardMaterial color="#8d6a2c" metalness={0.7} roughness={0.3} /></mesh>
      </group>
      <pointLight ref={lamp} position-y={3} color="#ffb655" distance={14} decay={1.5} />
      {/* outer floating crown rings — the capital's signature */}
      {[0, 1, 2].map((i) => <mesh key={`cr${i}`} position-y={11.4 + i * 0.32} rotation-y={i * 0.5}><torusGeometry args={[0.9 - i * 0.22, 0.02, 6, 6]} /><meshStandardMaterial {...gold} emissive="#ffb43a" emissiveIntensity={0.6} /></mesh>)}
      <mesh position-y={6} raycast={noRay}><cylinderGeometry args={[0.04, 0.04, 12, 6, 1, true]} /><meshBasicMaterial color="#ffc54a" transparent opacity={0.35} toneMapped={false} depthWrite={false} /></mesh>
      <PulseRing x={0} z={0} y={0.9} r={3.4} at={(s) => (live(s) ? s.t - T.toGlobalEnd : -1)} />
      <PulseRing x={0} z={0} y={0.95} r={6} at={(s) => (live(s) ? s.t - T.toGlobalEnd - 0.4 : -1)} />
    </group>
      <Suspense fallback={null}>
        <Emblem src={chainlinkPng} y={17.6} size={2.4} glow="#7d9cff" act={(s) => (live(s) ? env(s.t, T.toGlobalEnd, ALL_RECEIVED + 0.6, 1.4) : 0)} />
      </Suspense>
    </group>
  )
}

/* ------------------------------------------------------------------ Local Agency Core */

function LocalCore({ a, pick }: { a: Agency; pick: Pick }) {
  const S = useS()
  const ring = useRef<THREE.Mesh>(null), shaft = useRef<THREE.MeshStandardMaterial>(null), ringMat = useRef<THREE.MeshStandardMaterial>(null)
  const [x, z] = a.core!
  const y0 = padTop('core')
  const geoR = useMemo(() => hexRing(0.98, 0.05), [])
  const at = receivedAt(a.id)
  useFrame(({ clock }, dt) => {
    const now = clock.elapsedTime
    const age = live(S) ? S.t - at : -1
    const burst = age >= 0 ? Math.exp(-age * 1.8) : 0
    const aware = age >= 0 ? 1 : 0
    ring.current!.rotation.y += dt * (0.2 + burst * 3)
    ring.current!.position.y = 2.05 + Math.sin(now + x) * 0.04 + burst * 0.25
    ring.current!.scale.setScalar(1 + burst * 0.25)
    shaft.current!.emissiveIntensity = 0.45 + aware * 0.5 + burst * 3.5
    ringMat.current!.emissiveIntensity = 0.05 + aware * 0.35 + burst * 2.5
  })
  return (
    <group position={[x, y0, z]} {...pickOf(pick, `core:${a.id}`)}>
      <mesh position-y={0.13} castShadow receiveShadow><cylinderGeometry args={[1.2, 1.32, 0.26, 6]} /><meshStandardMaterial {...graphite} color={C.graphite2} /></mesh>
      <mesh position-y={0.32} castShadow><cylinderGeometry args={[0.55, 0.7, 0.2, 6]} /><meshStandardMaterial {...gold} /></mesh>
      {[0, 2, 4].map((k) => {
        const ang = (k * Math.PI) / 3 + Math.PI / 6
        return (
          <group key={k} position={[Math.cos(ang) * 0.82, 0.26, Math.sin(ang) * 0.82]} rotation-y={-ang}>
            <mesh position={[-0.12, 1.05, 0]} rotation-z={0.12} castShadow><boxGeometry args={[0.18, 2.1, 0.36]} /><meshStandardMaterial {...graphite} /></mesh>
          </group>
        )
      })}
      <mesh position-y={1.45}><cylinderGeometry args={[0.11, 0.13, 2.4, 6]} /><meshStandardMaterial ref={shaft} color="#4a3210" emissive="#ffb43a" emissiveIntensity={0.45} toneMapped={false} /></mesh>
      <mesh ref={ring} geometry={geoR}><meshStandardMaterial ref={ringMat} {...gold} emissive="#ffb43a" emissiveIntensity={0.05} /></mesh>
      <mesh position-y={2.75}><cylinderGeometry args={[0, 0.22, 0.32, 6]} /><meshStandardMaterial {...gold} /></mesh>
      <PulseRing x={0} z={0} y={0.3} r={1.3} at={(s) => (live(s) ? s.t - at : -1)} />
      <Suspense fallback={null}>
        <Emblem src={nownodesPng} y={4.1} size={1.05} glow="#b48cff" act={(s) => (live(s) && s.t >= at ? Math.exp(-(s.t - at) * 1.2) : 0)} />
      </Suspense>
    </group>
  )
}

/* ------------------------------------------------------------------ Vault building (Hot → Warm → Cold) */

const TIER = [
  { r: 1.55, rb: 1.78, h: 1.15, name: 'hot' },
  { r: 1.02, rb: 1.24, h: 0.85, name: 'warm' },
  { r: 0.6, rb: 0.8, h: 0.72, name: 'cold' },
]
function VaultBuilding({ a, pick }: { a: Agency; pick: Pick }) {
  const S = useS()
  const tiers = TIER.slice(0, a.tiers)
  const refs = useRef<(THREE.Group | null)[]>([])
  const bands = useRef<(THREE.MeshStandardMaterial | null)[]>([])
  const [x, z] = a.vault!
  const lockAt = a.id === ORIGIN_AGENCY.id ? T.toVaultEnd : receivedAt(a.id) + 0.35
  const ys = tiers.reduce<number[]>((acc, t, i) => [...acc, i ? acc[i - 1] + tiers[i - 1].h + 0.06 : 0], [])
  const bandGeo = useMemo(() => TIER.map((t) => hexRing(t.r + 0.03, 0.045)), [])
  useFrame(({ clock }) => {
    const now = clock.elapsedTime
    tiers.forEach((_, i) => {
      // tiers rotate 30° into a locked stance after verified intelligence arrives
      const k = live(S) ? ss(S.t, lockAt + i * 0.22, lockAt + i * 0.22 + 0.6) : 0
      if (refs.current[i]) refs.current[i]!.rotation.y = k * (Math.PI / 6) * (i % 2 ? -1 : 1)
      const flash = live(S) ? bell((S.t - lockAt - i * 0.22 - 0.3) / 0.3) : 0
      if (bands.current[i]) bands.current[i]!.emissiveIntensity = 0.12 + 0.05 * Math.sin(now * 1.3 + i) + k * 0.55 + flash * 2.4
    })
  })
  const topY = ys[ys.length - 1] + tiers[tiers.length - 1].h
  return (
    <group position={[x, padTop('vault'), z]} {...pickOf(pick, `vault:${a.id}`)}>
      {tiers.map((t, i) => (
        <group key={t.name} position-y={ys[i]} ref={(g) => { refs.current[i] = g }}>
          <mesh position-y={t.h / 2} castShadow receiveShadow>
            <cylinderGeometry args={[t.r, t.rb, t.h, 6]} />
            <meshStandardMaterial {...graphite} color={i === 0 ? '#34353a' : i === 1 ? '#303136' : '#2b2c30'} />
          </mesh>
          {/* recessed shell slits — restrained emissive seams */}
          {[0, 1, 2, 3, 4, 5].map((k) => {
            const ang = (k * Math.PI) / 3 + Math.PI / 6, rr = (t.r + t.rb) / 2 * 0.9
            return <mesh key={k} position={[Math.cos(ang) * rr, t.h * 0.5, Math.sin(ang) * rr]} rotation-y={-ang + Math.PI / 2}>
              <boxGeometry args={[t.r * 0.42, t.h * 0.42, 0.02]} />
              <meshStandardMaterial color="#1a1a1d" emissive="#c98a2a" emissiveIntensity={0.18 + i * 0.06} />
            </mesh>
          })}
          {/* vertical fins — graphite and gold architecture */}
          {[0, 1, 2, 3, 4, 5].map((k) => {
            const ang = (k * Math.PI) / 3, rr = (t.r + t.rb) / 2 * 0.98
            return <mesh key={`f${k}`} position={[Math.cos(ang) * rr, t.h * 0.5, Math.sin(ang) * rr]} rotation-y={-ang}>
              <boxGeometry args={[0.14, t.h * 0.96, 0.07]} />
              <meshStandardMaterial {...(k % 2 ? graphite : gold)} />
            </mesh>
          })}
          <mesh position-y={0.04}><cylinderGeometry args={[t.rb + 0.06, t.rb + 0.1, 0.08, 6]} /><meshStandardMaterial {...graphite} color="#1f1f23" /></mesh>
          <mesh geometry={bandGeo[i]} position-y={t.h}><meshStandardMaterial ref={(m) => { bands.current[i] = m }} {...gold} emissive="#ffb43a" emissiveIntensity={0.12} /></mesh>
        </group>
      ))}
      <mesh position-y={topY + 0.2} castShadow><cylinderGeometry args={[0, tiers[tiers.length - 1].r * 0.7, 0.4, 6]} /><meshStandardMaterial {...gold} /></mesh>
      <mesh position-y={topY + 0.75}><cylinderGeometry args={[0.02, 0.03, 0.9, 5]} /><meshStandardMaterial {...gold} /></mesh>
      <mesh position-y={topY + 1.22}><sphereGeometry args={[0.05, 8, 6]} /><meshBasicMaterial color="#ffc45a" toneMapped={false} /></mesh>
      {a.brand && (
        <Suspense fallback={null}>
          <Emblem src={a.brand === 'bybit' ? bybitPng : bitgetPng} y={topY + 2.2} size={1.05} glow={a.brand === 'bybit' ? '#f7a600' : '#2ee6f0'} act={(s) => (live(s) && s.t >= lockAt ? Math.exp(-(s.t - lockAt) * 1.2) : 0)} />
        </Suspense>
      )}
      {a.id === ORIGIN_AGENCY.id && <VaultAlert y={topY} />}
    </group>
  )
}

/* ------------------------------------------------------------------ Decoy / honeypot beacon */

function DecoyBeacon({ d, index, pick }: { d: Decoy; index: number; pick: Pick }) {
  const S = useS()
  const core = useRef<THREE.Mesh>(null), coreMat = useRef<THREE.MeshStandardMaterial>(null), shell = useRef<THREE.MeshPhysicalMaterial>(null)
  const light = useRef<THREE.PointLight>(null), motes = useRef<THREE.Group>(null), base = useRef<THREE.MeshStandardMaterial>(null)
  const ringGeo = useMemo(() => hexRing(0.66, 0.045), [])
  const haloGeo = useMemo(() => { const g = new THREE.TorusGeometry(0.62, 0.018, 6, 48); g.rotateX(Math.PI / 2); return g }, [])
  const halo = useRef<THREE.Mesh>(null), haloMat = useRef<THREE.MeshStandardMaterial>(null)
  const col = useMemo(() => new THREE.Color(), [])
  const isOrigin = d.id === ORIGIN_DECOY.id
  useFrame(({ clock }, dt) => {
    const now = clock.elapsedTime + index * 0.9
    const red = isOrigin ? (live(S) ? ss(S.t, T.trigger, T.trigger + 0.5) : tracing(S) ? 1 : 0) : 0
    const rate = 1.6 + red * 3.4
    const breathe = 0.5 + 0.5 * Math.sin(now * rate)
    col.copy(C.honey).lerp(C.alarm, red)
    coreMat.current!.color.copy(col).multiplyScalar(0.55)
    coreMat.current!.emissive.copy(col)
    coreMat.current!.emissiveIntensity = 1.3 + breathe * 0.9 + red * 1.4
    shell.current!.color.copy(col).lerp(new THREE.Color('#fff2cf'), 0.5 - red * 0.3)
    shell.current!.emissive.copy(col)
    shell.current!.emissiveIntensity = 0.08 + breathe * 0.08 + red * 0.25
    base.current!.emissive.copy(col)
    base.current!.emissiveIntensity = 0.2 + red * 0.9
    light.current!.color.copy(col)
    light.current!.intensity = 2.2 + breathe * 1.2 + red * 7
    light.current!.distance = 3.6 + red * 2.4
    core.current!.position.y = 0.82 + Math.sin(now * 1.2) * 0.05
    core.current!.rotation.y += dt * (0.6 + red * 2.5)
    motes.current!.rotation.y += dt * (0.5 + red * 1.6)
    halo.current!.rotation.y += dt * (0.7 + red * 2.4)
    halo.current!.rotation.x = 0.22 * Math.sin(now * 0.6)
    halo.current!.position.y = 0.9 + Math.sin(now * 0.8) * 0.04
    haloMat.current!.emissive.copy(col)
    haloMat.current!.emissiveIntensity = 0.5 + breathe * 0.4 + red * 1.2
    motes.current!.children.forEach((c, i) => { c.position.y = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(now * 0.9 + i * 1.7)) })
  })
  return (
    <group position={[d.x, padTop('decoy'), d.z]} {...pickOf(pick, `decoy:${d.id}`)}>
      <mesh geometry={ringGeo} position-y={0.05}><meshStandardMaterial ref={base} {...gold} emissive="#ffb52e" /></mesh>
      <mesh position-y={0.12} castShadow receiveShadow><cylinderGeometry args={[0.42, 0.52, 0.24, 6]} /><meshStandardMaterial {...graphite} color={C.graphite2} /></mesh>
      <mesh position-y={0.27}><cylinderGeometry args={[0.46, 0.46, 0.04, 6]} /><meshStandardMaterial {...gold} /></mesh>
      <mesh position-y={0.8}><cylinderGeometry args={[0.38, 0.42, 1.02, 6]} /><meshPhysicalMaterial ref={shell} transparent opacity={0.26} roughness={0.1} metalness={0.05} depthWrite={false} /></mesh>
      <mesh position-y={1.33}><cylinderGeometry args={[0.2, 0.4, 0.06, 6]} /><meshStandardMaterial {...gold} /></mesh>
      <mesh ref={core}><cylinderGeometry args={[0.17, 0.17, 0.44, 6]} /><meshStandardMaterial ref={coreMat} toneMapped={false} /></mesh>
      {[0, 2, 4].map((k) => {
        const ang = (k * Math.PI) / 3 + Math.PI / 6
        return <mesh key={k} position={[Math.cos(ang) * 0.5, 0.2, Math.sin(ang) * 0.5]} rotation={[0, -ang, -0.35]}><boxGeometry args={[0.08, 0.42, 0.18]} /><meshStandardMaterial {...gold} /></mesh>
      })}
      <mesh ref={halo} geometry={haloGeo}><meshStandardMaterial ref={haloMat} {...gold} toneMapped={false} /></mesh>
      <group ref={motes}>
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} position={[Math.cos(i * 1.256) * 0.62, 0.7, Math.sin(i * 1.256) * 0.62]}>
            <cylinderGeometry args={[0.055, 0.055, 0.03, 6]} />
            <meshBasicMaterial color="#ffd27a" toneMapped={false} />
          </mesh>
        ))}
      </group>
      <pointLight ref={light} position-y={0.9} decay={2} />
      {isOrigin && <PulseRing x={0} z={0} y={0.12} r={0.7} color="#ff5a3c" at={(s) => (live(s) ? (s.t >= T.pulse ? (s.t - T.pulse) % 1.6 : -1) : tracing(s) && s.tr >= TR.found ? (s.tr - TR.found) % 1.6 : -1)} />}
    </group>
  )
}

/** red inverted triangle directly above the attacked decoy, pointing down at it */
function ThreatMarker({ pick }: { pick: Pick }) {
  const S = useS()
  const g = useRef<THREE.Group>(null), tri = useRef<THREE.Mesh>(null), triMat = useRef<THREE.MeshStandardMaterial>(null)
  const label = useMemo(() => new THREE.Vector3(ORIGIN_DECOY.x, TOP.decoy + 2.5, ORIGIN_DECOY.z), [])
  useFrame(({ clock }) => {
    const now = clock.elapsedTime
    const k = live(S) ? ss(S.t, T.marker, T.marker + 0.45) : tracing(S) ? 1 : 0
    g.current!.visible = k > 0.01
    g.current!.position.y = TOP.decoy + (1 - k) * 1.4
    tri.current!.position.y = 1.75 + Math.sin(now * 2) * 0.07
    tri.current!.scale.setScalar((0.3 + k * 0.7) * (1 + 0.06 * Math.sin(now * 4)))
    triMat.current!.emissiveIntensity = 1.4 + 0.6 * (0.5 + 0.5 * Math.sin(now * 4))
  })
  return (
    <>
      <group ref={g} position={[ORIGIN_DECOY.x, 0, ORIGIN_DECOY.z]} {...pickOf(pick, `decoy:${ORIGIN_DECOY.id}`)}>
        <mesh ref={tri} rotation-x={Math.PI}><coneGeometry args={[0.5, 0.85, 3]} /><meshStandardMaterial ref={triMat} color="#c42a1d" emissive="#ff2e1a" emissiveIntensity={1.6} toneMapped={false} /></mesh>
        <mesh position-y={0.62}><cylinderGeometry args={[0.012, 0.012, 1.0, 4]} /><meshBasicMaterial color="#ff5a3c" transparent opacity={0.8} toneMapped={false} /></mesh>
      </group>
      <Overlay at={label} layer={20} render={(el, s) => {
        const on = (live(s) && s.t >= T.marker + 0.3) || tracing(s)
        if (on) { setCls(el, 'font-mono text-[10.5px] font-semibold tracking-[0.3em] pl-[0.3em] text-[#ff8a74] [text-shadow:0_0_10px_rgba(255,60,30,.6)]'); setTxt(el, 'ATTACK') }
        return on
      }} />
    </>
  )
}

/* ------------------------------------------------------------------ vault email alert */

/** holographic envelope + notice card that rises out of the vault when the decoy signal lands */
function VaultAlert({ y }: { y: number }) {
  const S = useS()
  const g = useRef<THREE.Group>(null), mat = useRef<THREE.MeshStandardMaterial>(null)
  const a = ORIGIN_AGENCY
  const at = useMemo(() => new THREE.Vector3(a.vault![0], padTop('vault') + y + 3.7, a.vault![1]), [a, y])
  const flap = useMemo(() => { const s = new THREE.Shape(); s.moveTo(-0.42, 0); s.lineTo(0.42, 0); s.lineTo(0, -0.3); s.closePath(); return new THREE.ShapeGeometry(s) }, [])
  const vis = (s: SceneState) => (live(s) ? env(s.t, T.email, T.email + 6, 0.8) : 0)
  useFrame(({ camera, clock }) => {
    const k = vis(S)
    g.current!.visible = k > 0.01
    g.current!.quaternion.copy(camera.quaternion)
    const age = live(S) ? S.t - T.email : 0
    g.current!.position.y = y + 2.0 + ss(age, 0, 0.6) * 1.0 + Math.sin(clock.elapsedTime * 2) * 0.05
    g.current!.scale.setScalar(k * (1 + 0.25 * bell((age - 0.25) / 0.2)))
    mat.current!.emissiveIntensity = 1 + 0.5 * Math.sin(clock.elapsedTime * 5)
  })
  return (
    <>
      <group ref={g} raycast={noRay}>
        <mesh><planeGeometry args={[0.9, 0.6]} /><meshStandardMaterial ref={mat} color="#3a0e08" emissive="#ff5a3c" emissiveIntensity={1.2} toneMapped={false} side={THREE.DoubleSide} /></mesh>
        <mesh position={[0, 0.3, 0.01]} geometry={flap}><meshBasicMaterial color="#ffd27a" toneMapped={false} side={THREE.DoubleSide} /></mesh>
        <mesh position-z={-0.02}><planeGeometry args={[2.2, 2.2]} /><meshBasicMaterial map={GLOW_TEX} color="#ff6a3c" transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
      </group>
      <Overlay at={at} layer={24} render={(el, s) => {
        const k = vis(s)
        if (k > 0.01) {
          if (!el.firstChild) {
            el.className = 'tag-in whitespace-nowrap px-3 py-2 rounded-md bg-coal/90 backdrop-blur border border-alarm/50 shadow-[0_0_24px_rgba(229,72,77,.35)] font-sans'
            el.innerHTML = `<div class="flex items-center gap-1.5 font-mono text-[9.5px] font-semibold tracking-[0.22em] text-threat"><svg width="11" height="9" viewBox="0 0 11 9"><rect x=".5" y=".5" width="10" height="8" rx="1" fill="none" stroke="currentColor"/><path d="M.8 1l4.7 3.6L10.2 1" fill="none" stroke="currentColor"/></svg>VAULT ALERT</div><div class="mt-0.5 text-[12px] font-medium text-cream">Decoy trigger received</div><div class="font-mono text-[9.5px] text-dim">DW-07 → Hot tier restricted</div>`
          }
          el.style.opacity = String(k)
        }
        return k > 0.01
      }} />
    </>
  )
}

/* ------------------------------------------------------------------ signals */

const arc = (a: THREE.Vector3, b: THREE.Vector3, lift: number) => {
  const m = a.clone().lerp(b, 0.5); m.y += lift
  return new THREE.QuadraticBezierCurve3(a, m, b)
}
const DOTS = 30
/** short-lived light packet with a dotted trail; nothing persists after it lands */
function Packet({ curve, t0, dur, color = '#ffc54a', size = 0.12 }: { curve: THREE.QuadraticBezierCurve3; t0: number; dur: number; color?: string; size?: number }) {
  const S = useS()
  const head = useRef<THREE.Mesh>(null), dots = useRef<THREE.InstancedMesh>(null)
  const m = useMemo(() => new THREE.Matrix4(), [])
  const p = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const age = live(S) ? S.t - t0 : -1
    const on = age >= 0 && age < dur + 0.5
    head.current!.visible = on && age < dur
    dots.current!.visible = on
    if (!on) return
    const u = age < dur ? ss(age, 0, dur) : 1
    const fade = 1 - cl((age - dur) / 0.5)
    curve.getPoint(u, p)
    head.current!.position.copy(p)
    for (let j = 0; j < DOTS; j++) {
      const s = j / (DOTS - 1)
      const back = u - s
      const k = back >= 0 && back < 0.55 ? (1 - back / 0.55) * fade : 0
      curve.getPoint(s, p)
      m.makeScale(k, k, k).setPosition(p)
      dots.current!.setMatrixAt(j, m)
    }
    dots.current!.instanceMatrix.needsUpdate = true
  })
  return (
    <>
      <mesh ref={head}><sphereGeometry args={[size, 12, 10]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>
      <instancedMesh ref={dots} args={[undefined, undefined, DOTS]}><sphereGeometry args={[size * 0.38, 6, 5]} /><meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.85} /></instancedMesh>
    </>
  )
}

/** flowing dashed path that fades in with the packet and dissolves after it lands */
function RouteLine({ curve, t0, dur, color, width }: { curve: THREE.QuadraticBezierCurve3; t0: number; dur: number; color: string; width: number }) {
  const S = useS()
  const ref = useRef<{ material: THREE.Material & { opacity: number; dashOffset: number } } | null>(null)
  const pts = useMemo(() => curve.getPoints(60), [curve])
  useFrame((_, dt) => {
    const l = ref.current
    if (!l) return
    const k = live(S) ? env(S.t, t0 - 0.1, t0 + dur + 0.8, 1.2) : 0
    l.material.opacity = k * 0.9
    l.material.dashOffset -= dt * 2.2
    ;(l as unknown as THREE.Object3D).visible = k > 0.01
  })
  return <Line ref={ref as never} points={pts} color={color} lineWidth={width} dashed dashSize={0.5} gapSize={0.22} transparent opacity={0} toneMapped={false} raycast={noRay} />
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const coreTop = (a: Agency) => V(a.core![0], TOP.core, a.core![1])
const GLOBAL_TOP = V(GLOBAL[0], TOP.global - 2.2, GLOBAL[1])
const ROUTES = (() => {
  const dec = V(ORIGIN_DECOY.x, TOP.decoy, ORIGIN_DECOY.z)
  const outside = V(ORIGIN_DECOY.x + ORIGIN_AGENCY.u[0] * 11, 0.4, ORIGIN_DECOY.z + ORIGIN_AGENCY.u[1] * 11)
  return {
    approach: arc(outside, dec, 1.2),
    toLocal: arc(dec, coreTop(ORIGIN_AGENCY), 1.6),
    toVault: arc(dec, V(ORIGIN_AGENCY.vault![0], TOP.vault[ORIGIN_AGENCY.tiers!] - 0.6, ORIGIN_AGENCY.vault![1]), 1.4),
    toGlobal: arc(coreTop(ORIGIN_AGENCY), GLOBAL_TOP, 4),
    out: RECEIVERS.map((a) => arc(GLOBAL_TOP, coreTop(a), 5)),
    bridges: BRIDGES.map((b) => arc(b.a, b.b, 0.9)),
  }
})()

function Signals() {
  return (
    <>
      <Packet curve={ROUTES.approach} t0={T.approach} dur={T.trigger} color="#ff4b33" size={0.1} />
      {/* 1+2 · decoy → bee → local core: thick honey trail riding with the courier */}
      <RouteLine curve={ROUTES.toLocal} t0={T.toLocal} dur={T.toLocalEnd - T.toLocal} color="#ffc54a" width={4} />
      <Packet curve={ROUTES.toLocal} t0={T.toLocal} dur={T.toLocalEnd - T.toLocal} size={0.17} />
      {/* 3 · decoy → vault: fast ember line */}
      <RouteLine curve={ROUTES.toVault} t0={T.toVault} dur={T.toVaultEnd - T.toVault} color="#ff8a4a" width={3} />
      <Packet curve={ROUTES.toVault} t0={T.toVault} dur={T.toVaultEnd - T.toVault} color="#ff8a4a" size={0.14} />
      {/* 4 · local → global → protected cores: pale gold broadcast */}
      <RouteLine curve={ROUTES.toGlobal} t0={T.toGlobal} dur={T.toGlobalEnd - T.toGlobal} color="#ffe39a" width={3.5} />
      <Packet curve={ROUTES.toGlobal} t0={T.toGlobal} dur={T.toGlobalEnd - T.toGlobal} color="#ffe39a" size={0.18} />
      {ROUTES.out.map((c, i) => <RouteLine key={`l${i}`} curve={c} t0={T.dispatch + i * T.dispatchGap} dur={T.dispatchDur} color="#ffe39a" width={2.5} />)}
      {ROUTES.out.map((c, i) => <Packet key={i} curve={c} t0={T.dispatch + i * T.dispatchGap} dur={T.dispatchDur} color="#ffe39a" size={0.15} />)}
      {ROUTES.bridges.map((c, i) => <Packet key={`b${i}`} curve={c} t0={BRIDGES[i].t0} dur={0.6} size={0.08} color="#ffd27a" />)}
    </>
  )
}

/** trace: candidate routes from the Quorum Core collapse until one verified origin remains */
function TraceRoutes() {
  const S = useS()
  const lines = useRef<({ material: THREE.Material & { opacity: number; dashOffset?: number } } | null)[]>([])
  const pts = useMemo(() => TRACE_CANDIDATES.map((id) => {
    const target = id === ORIGIN_AGENCY.id ? ORIGIN_DECOY : DECOYS.find((d) => d.agency === id)!
    return arc(GLOBAL_TOP, V(target.x, TOP.decoy, target.z), 4.5).getPoints(40)
  }), [])
  useFrame((_, dt) => {
    pts.forEach((_, i) => {
      const l = lines.current[i]
      if (!l) return
      const isO = i === TRACE_CANDIDATES.length - 1
      const on = tracing(S) ? ss(S.tr, 0.3, 1.0) * (isO ? 1 - 0.4 * ss(S.tr, TR.end - 0.6, TR.end) : 1 - ss(S.tr, TR.cut[i], TR.cut[i] + 0.4)) : 0
      l.material.opacity = on * (isO ? 0.95 : 0.6)
      ;(l as unknown as THREE.Object3D).visible = on > 0.01
      if (l.material.dashOffset !== undefined) l.material.dashOffset -= dt * 0.6
    })
  })
  return <>{pts.map((p, i) => (
    <Line key={i} ref={(r) => { lines.current[i] = r as unknown as (typeof lines.current)[number] }} points={p} color={i === pts.length - 1 ? '#ff5a3c' : '#ff9a5a'}
      lineWidth={i === pts.length - 1 ? 2 : 1.3} dashed dashSize={0.35} gapSize={0.25} transparent opacity={0} />
  ))}</>
}

/** selected-object ground marker */
function SelectRing({ id }: { id: string | null }) {
  const ref = useRef<THREE.Mesh>(null)
  const geo = useMemo(() => hexRing(1, 0.04), [])
  const r = id?.startsWith('global') ? 3.7 : id?.startsWith('vault') ? 2.1 : id?.startsWith('core') ? 1.7 : 1.0
  const p = id && !id.startsWith('area') ? anchorOf(id) : null
  useFrame(({ clock }) => { if (ref.current) ref.current.scale.setScalar(r * (1 + 0.03 * Math.sin(clock.elapsedTime * 3))) })
  if (!p) return null
  return <mesh ref={ref} geometry={geo} position={[p[0], 0.22, p[2]]}><meshBasicMaterial color="#ffd56a" toneMapped={false} transparent opacity={0.9} /></mesh>
}

/* ------------------------------------------------------------------ Quorum bee — guardian & signal courier */

/** patrol agent per protected territory; the origin bee becomes the decoy → core courier */
function PatrolBee({ a, k }: { a: Agency; k: number }) {
  const isO = a.id === ORIGIN_AGENCY.id
  const cx = (a.core![0] + a.vault![0]) / 2 + a.u[0] * 1.2, cz = (a.core![1] + a.vault![1]) / 2 + a.u[1] * 1.2
  const at = receivedAt(a.id)
  const q = useMemo(() => new THREE.Vector3(), [])
  const dec = useMemo(() => V(ORIGIN_DECOY.x, TOP.decoy + 0.7, ORIGIN_DECOY.z), [])
  const patrol = (now: number, out: THREE.Vector3) => {
    const w = now * 0.32 + k * 1.7
    return out.set(cx + Math.cos(w) * 4.2 + Math.sin(w * 2.3) * 0.8, 2.3 + Math.sin(now * 1.4 + k) * 0.18, cz + Math.sin(w) * 3.1)
  }
  return <BeeBody drive={(now, t, p) => {
    patrol(now, p)
    if (isO) {
      if (t >= T.beeGo && t < T.toLocal) { const u = ss(t, T.beeGo, T.beeGo + 0.9); q.copy(dec); q.y += Math.sin(now * 6) * 0.05; p.lerp(q, u); return true }
      if (t >= T.toLocal && t < T.toLocalEnd) { ROUTES.toLocal.getPoint(ss(t, T.toLocal, T.toLocalEnd), p); p.y += 0.35; return true }
      if (t >= T.toLocalEnd && t < T.toLocalEnd + 3) { q.set(a.core![0] + Math.cos(now * 2) * 0.7, TOP.core + 0.9, a.core![1] + Math.sin(now * 2) * 0.7); p.lerp(q, 1 - ss(t, T.toLocalEnd + 2, T.toLocalEnd + 3)); return true }
    } else if (t >= at - 0.4 && t < at + 2.4) {
      q.set(a.core![0] + Math.cos(now * 2.4) * 0.8, TOP.core + 0.8, a.core![1] + Math.sin(now * 2.4) * 0.8)
      p.lerp(q, ss(t, at - 0.4, at + 0.2) * (1 - ss(t, at + 1.6, at + 2.4)))
      return true
    }
    return false
  }} scale={0.62} speed={isO ? 14 : 6} />
}

/** network courier — rides the first broadcast from the Global Core */
function Bee() {
  const ride = ROUTES.out[0]
  const dest = RECEIVERS[0]
  const q = useMemo(() => new THREE.Vector3(), [])
  const look = useMemo(() => new THREE.Vector3(), [])
  const home = (now: number, out: THREE.Vector3) => out.set(GLOBAL[0] + Math.cos(now * 0.3) * 5, 10.4 + Math.sin(now * 1.3) * 0.12, GLOBAL[1] + Math.sin(now * 0.3) * 5)
  return <BeeBody drive={(now, t, p) => {
    const a0 = T.dispatch, a1 = arriveAt(0), back = a1 + 0.8, home1 = back + 2.2
    home(now, p)
    if (t >= T.liftoff && t < a0) {
      q.set(GLOBAL[0], TOP.global + 0.8 + ss(t, T.liftoff, a0) * 0.6, GLOBAL[1])
      p.lerp(q, ss(t, T.liftoff, T.liftoff + 0.5))
    } else if (t >= a0 && t < a1) {
      ride.getPoint(ss(t, a0, a1), p); p.y += 0.45
    } else if (t >= a1 && t < back) {
      p.set(dest.core![0], TOP.core + 0.9 + Math.sin(now * 3) * 0.05, dest.core![1])
    } else if (t >= back && t < home1) {
      q.set(dest.core![0], TOP.core + 0.9, dest.core![1])
      home(now, look); p.copy(arc(q, look, 3).getPoint(ss(t, back, home1)))
    }
    return t >= T.liftoff && t < home1
  }} scale={0.95} speed={10} />
}

function BeeBody({ drive, scale, speed }: { drive: (now: number, t: number, p: THREE.Vector3) => boolean; scale: number; speed: number }) {
  const S = useS()
  const g = useRef<THREE.Group>(null), head = useRef<THREE.Group>(null)
  const wl = useRef<THREE.Mesh>(null), wr = useRef<THREE.Mesh>(null), chest = useRef<THREE.MeshStandardMaterial>(null)
  const prev = useMemo(() => new THREE.Vector3(), [])
  const p = useMemo(() => new THREE.Vector3(), [])
  const look = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ clock }, dt) => {
    const now = clock.elapsedTime
    const t = live(S) ? S.t : -1
    const flying = drive(now, t, p)
    const mesh = g.current!
    mesh.position.lerp(p, Math.min(1, dt * speed))
    look.copy(mesh.position).sub(prev)
    if (look.lengthSq() > 1e-6) { look.y = 0; look.normalize().add(mesh.position); mesh.lookAt(look) }
    prev.copy(mesh.position)
    const flap = Math.sin(now * (flying ? 60 : 38)) * 0.45
    wl.current!.rotation.z = 0.35 + flap
    wr.current!.rotation.z = -0.35 - flap
    head.current!.rotation.y = Math.sin(now * 0.7) * 0.18
    chest.current!.emissiveIntensity = 1.1 + 0.4 * Math.sin(now * 2) + (flying ? 1.5 : 0)
  })
  return (
    <group ref={g} scale={scale}>
      <group ref={head}>
        {/* round body — black + yellow identity */}
        <mesh castShadow><sphereGeometry args={[0.42, 28, 20]} /><meshStandardMaterial color="#ffc400" roughness={0.42} metalness={0.05} /></mesh>
        {[-0.12, -0.27].map((zz, i) => (
          <mesh key={i} position-z={zz}><torusGeometry args={[Math.sqrt(0.42 ** 2 - zz * zz) + 0.005, 0.045, 8, 32]} /><meshStandardMaterial color="#17150f" roughness={0.6} /></mesh>
        ))}
        <mesh position-z={-0.44} rotation-x={-Math.PI / 2}><coneGeometry args={[0.07, 0.14, 8]} /><meshStandardMaterial color="#17150f" /></mesh>
        {/* face */}
        {[-1, 1].map((s) => (
          <group key={s}>
            <mesh position={[s * 0.14, 0.09, 0.37]}><sphereGeometry args={[0.065, 12, 10]} /><meshStandardMaterial color="#141210" roughness={0.2} /></mesh>
            <mesh position={[s * 0.14 + 0.02, 0.12, 0.425]}><sphereGeometry args={[0.018, 6, 6]} /><meshBasicMaterial color="#ffffff" /></mesh>
            {/* antennae */}
            <group position={[s * 0.12, 0.36, 0.18]} rotation={[0.5, 0, -s * 0.35]}>
              <mesh position-y={0.13}><cylinderGeometry args={[0.012, 0.012, 0.26, 5]} /><meshStandardMaterial color="#17150f" /></mesh>
              <mesh position-y={0.27}><sphereGeometry args={[0.035, 8, 8]} /><meshStandardMaterial color="#17150f" /></mesh>
            </group>
          </group>
        ))}
        {/* chest hex symbol */}
        <mesh position={[0, -0.12, 0.395]} rotation-x={Math.PI / 2 - 0.25}><cylinderGeometry args={[0.07, 0.07, 0.012, 6]} /><meshStandardMaterial ref={chest} color="#3a2a08" emissive="#ffcf4a" toneMapped={false} /></mesh>
      </group>
      {/* small wings */}
      <mesh ref={wl} position={[0.2, 0.36, -0.06]} scale={[1, 0.14, 0.62]}><sphereGeometry args={[0.2, 12, 8]} /><meshPhysicalMaterial color="#f4f7ff" transparent opacity={0.55} roughness={0.1} depthWrite={false} /></mesh>
      <mesh ref={wr} position={[-0.2, 0.36, -0.06]} scale={[1, 0.14, 0.62]}><sphereGeometry args={[0.2, 12, 8]} /><meshPhysicalMaterial color="#f4f7ff" transparent opacity={0.55} roughness={0.1} depthWrite={false} /></mesh>
      <pointLight color="#ffcf6a" intensity={1.2} distance={2.2} decay={2} />
    </group>
  )
}

/* ------------------------------------------------------------------ camera */

export type ViewCmd = { kind: 'reset' | 'top' | 'left' | 'right'; n: number }
type Goal = { key: string; target: THREE.Vector3; dist: number; dir?: THREE.Vector3 }
const DEFAULT_DIR = new THREE.Vector3(0.38, 0.5, 0.76).normalize()
const TOP_DIR = new THREE.Vector3(0, 1, 0.001).normalize()
/** map-scale limits — the city never shrinks into a small board */
const MAP_MIN = 14, MAP_MAX = 58, MAP_DIST = 50, PAN_R = 34
const INSPECT_DIST: Record<string, number> = { global: 25, vault: 10.5, core: 9.5, decoy: 9.5, area: 24 }
const INSPECT_Y: Record<string, number> = { global: 5.2, vault: 1.4, core: 1.5, decoy: 2.4, area: 0.6 }
/** share of the frame the inspection panel takes; the object centres in what remains */
export const PANEL_SHARE = 0.48
type Ctl = THREE.EventDispatcher<{ start: object }> & { target: THREE.Vector3; update: () => void }

function Rig({ selected, mode, traceFocus, cmd }: { selected: string | null; mode: WorldMode; traceFocus: boolean; cmd: ViewCmd }) {
  const { camera, controls, size } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: Ctl | null; size: { width: number } }
  const left = useRef(0)
  const goal = useRef<Goal>({ key: 'init', target: new THREE.Vector3(HUB.x, 0, HUB.z), dist: MAP_DIST })
  const dir = useRef(DEFAULT_DIR.clone())
  const saved = useRef<{ target: THREE.Vector3; offset: THREE.Vector3 } | null>(null)
  const cur = useMemo(() => new THREE.Vector3(), [])
  const go = (g: Goal) => {
    goal.current = g
    dir.current.copy(g.dir ?? (controls ? cur.copy(camera.position).sub(controls.target).normalize() : DEFAULT_DIR))
    left.current = 2.8
  }

  // inspection: remember the map framing, glide in, glide back out on close
  useEffect(() => {
    const p = selected ? anchorOf(selected) : null
    if (p && selected) {
      if (!saved.current && controls) saved.current = { target: controls.target.clone(), offset: camera.position.clone().sub(controls.target) }
      const kind = selected.split(':')[0]
      const d = camera.position.clone().sub(controls?.target ?? new THREE.Vector3()).setY(0).normalize()
      go({ key: selected, target: new THREE.Vector3(p[0], INSPECT_Y[kind] ?? 1, p[2]), dist: INSPECT_DIST[kind] ?? 12, dir: d.multiplyScalar(0.84).setY(0.55).normalize() })
    } else if (saved.current) {
      const s = saved.current; saved.current = null
      go({ key: 'back', target: s.target, dist: s.offset.length(), dir: s.offset.clone().normalize() })
    }
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selected) return
    if (mode === 'trace') go(traceFocus ? { key: 'tf', target: new THREE.Vector3(ORIGIN_DECOY.x * 0.8, 0.5, ORIGIN_DECOY.z * 0.8), dist: 30 } : { key: 't', target: new THREE.Vector3(HUB.x, 0, HUB.z), dist: MAP_MAX - 2 })
  }, [mode, traceFocus]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!cmd.n) return
    const now = controls ? camera.position.clone().sub(controls.target).normalize() : DEFAULT_DIR.clone()
    const d = cmd.kind === 'reset' ? DEFAULT_DIR.clone() : cmd.kind === 'top' ? TOP_DIR.clone()
      : (now.y > 0.98 ? DEFAULT_DIR.clone() : now).applyAxisAngle(new THREE.Vector3(0, 1, 0), cmd.kind === 'left' ? Math.PI / 4 : -Math.PI / 4)
    const keep = controls ? camera.position.distanceTo(controls.target) : MAP_DIST
    go({ key: `c${cmd.n}`, target: cmd.kind === 'reset' ? new THREE.Vector3(HUB.x, 0, HUB.z) : (controls?.target.clone() ?? new THREE.Vector3()), dist: cmd.kind === 'reset' ? MAP_DIST : keep, dir: d })
  }, [cmd.n]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!controls) return
    const stop = () => { left.current = 0 }
    controls.addEventListener('start', stop)
    return () => controls.removeEventListener('start', stop)
  }, [controls])
  useFrame((_, dt) => {
    if (!controls) return
    // shift the projection so the focused object sits in the left half, beside the panel
    const want = selected && size.width > 900 ? camera.getFilmWidth() * PANEL_SHARE * 0.5 : 0
    if (Math.abs(camera.filmOffset - want) > 0.001) { camera.filmOffset += (want - camera.filmOffset) * Math.min(1, dt * 3.2); camera.updateProjectionMatrix() }
    // keep the operator over the city — pan is bounded, the world never runs out
    const t = controls.target, r = Math.hypot(t.x - HUB.x, t.z - HUB.z)
    if (r > PAN_R) { const k = PAN_R / r; const ox = t.x, oz = t.z; t.x = HUB.x + (t.x - HUB.x) * k; t.z = HUB.z + (t.z - HUB.z) * k; camera.position.x += t.x - ox; camera.position.z += t.z - oz }
    // inspection allows close study; limits restore once the camera is back at map scale
    const close = !!selected || left.current > 0
    const c = controls as unknown as { minDistance: number; maxDistance: number }
    c.minDistance = close ? 4.5 : MAP_MIN; c.maxDistance = close ? Math.max(34, MAP_MAX) : MAP_MAX
    if (left.current <= 0) return
    left.current -= dt
    const g = goal.current
    const k = Math.min(1, dt * 2.4)
    t.lerp(g.target, k)
    const d = camera.position.distanceTo(t)
    cur.copy(camera.position).sub(t).normalize().lerp(dir.current, k).normalize()
    camera.position.copy(t).addScaledVector(cur, d + (g.dist - d) * k)
    controls.update()
  })
  return null
}

/** night lighting; inspection dims the city and pulls a warm key onto the focused object */
function Lights({ selected }: { selected: string | null }) {
  const hemi = useRef<THREE.HemisphereLight>(null), key = useRef<THREE.DirectionalLight>(null), spot = useRef<THREE.SpotLight>(null)
  const { scene } = useThree()
  const f = useRef(0)
  const aim = useMemo(() => new THREE.Vector3(), [])
  useEffect(() => { if (spot.current) scene.add(spot.current.target) }, [scene])
  useFrame((_, dt) => {
    const p = selected && !selected.startsWith('area') ? anchorOf(selected) : null
    f.current += ((p ? 1 : 0) - f.current) * Math.min(1, dt * 2.5)
    const k = f.current
    hemi.current!.intensity = 1.35 * (1 - 0.4 * k)
    key.current!.intensity = 2.8 * (1 - 0.35 * k)
    const fog = scene.fog as THREE.FogExp2
    fog.density = 0.0105 + k * 0.012
    if (p) { aim.set(p[0], p[1] * 0.45, p[2]); spot.current!.target.position.copy(aim); spot.current!.position.set(p[0] - 4, p[1] + 9, p[2] + 5) }
    spot.current!.intensity = k * 90
  })
  return (
    <>
      <ambientLight intensity={0.28} color="#c6cde0" />
      <hemisphereLight ref={hemi} args={['#8796b8', '#3b2d1f', 1.05]} />
      <directionalLight ref={key} position={[-26, 44, 22]} intensity={2.3} color="#ffe7cc" castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-48} shadow-camera-right={48} shadow-camera-top={48} shadow-camera-bottom={-48}
        shadow-camera-near={1} shadow-camera-far={160} shadow-bias={-0.0004} shadow-normalBias={0.03} />
      <directionalLight position={[30, 18, -26]} intensity={0.7} color="#7f9ccc" />
      <spotLight ref={spot} angle={0.42} penumbra={0.8} decay={1.4} distance={40} color="#ffdcae" intensity={0} />
    </>
  )
}

/* ------------------------------------------------------------------ scene */

export type WorldProps = {
  state: React.RefObject<SceneState>
  mode: WorldMode
  selected: string | null
  traceFocus: boolean
  onSelect: (id: string | null) => void
  view?: ViewCmd
  incident?: boolean
  reducedMotion?: boolean
  children?: React.ReactNode
}

export default function World({ state, mode, selected, traceFocus, onSelect, view = { kind: 'reset', n: 0 }, incident = false, reducedMotion = false, children }: WorldProps) {
  const [hover, setHover] = useState<string | null>(null)
  state.current!.mode = mode
  state.current!.selected = selected
  state.current!.hover = hover
  useEffect(() => { document.body.style.cursor = hover ? 'pointer' : '' }, [hover])
  useEffect(() => () => { document.body.style.cursor = '' }, [])
  const pick = useMemo<Pick>(() => ({ hover: (id) => setHover((h) => (h === id ? h : id)), select: (id) => onSelect(id) }), [onSelect])
  const start = DEFAULT_DIR.clone().multiplyScalar(MAP_DIST).add(new THREE.Vector3(HUB.x, 0, HUB.z))

  return (
    <div className="relative h-full w-full">
      <Canvas shadows frameloop={reducedMotion ? 'demand' : 'always'} dpr={[1, 2]} camera={{ position: start.toArray(), fov: 36, near: 0.3, far: 900 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.22 }}
        onPointerMissed={() => onSelect(null)}>
        <SCtx.Provider value={state}>
          <color attach="background" args={[FOG]} />
          <fogExp2 attach="fog" args={[FOG, 0.0105]} />
          <Sky />
          <Lights selected={selected} />

          <Honey />
          <Terrain pick={pick} />
          <StaticField F={MID} />
          <StaticField F={FAR} />
          <CityFabric />
          <GlobalCore pick={pick} />
          {PROTECTED.map((a) => <LocalCore key={a.id} a={a} pick={pick} />)}
          {PROTECTED.map((a) => <VaultBuilding key={a.id} a={a} pick={pick} />)}
          {DECOYS.map((d, i) => <DecoyBeacon key={d.id} d={d} index={i} pick={pick} />)}
          <ThreatMarker pick={pick} />
          <Signals />
          <TraceRoutes />
          <Bee />
          {PROTECTED.map((a, k) => <PatrolBee key={a.id} a={a} k={k} />)}
          <SelectRing id={selected} />
          {!incident && AGENCIES.map((a) => <AgencyLabel key={a.id} a={a} />)}
          {NEAR_DISTRICTS.map((d) => <DistrictLabel key={d.letter} d={d} />)}
          {!incident && RECEIVERS.map((a, i) => <ReceivedLabel key={a.id} a={a} i={i} />)}
          {!incident && <ReceivedLabel a={ORIGIN_AGENCY} i={0} text="SIGNAL RECEIVED · THREAT VERIFIED" />}
          {!incident && hover && hover !== selected && <HoverLabel key={hover} id={hover} />}
          {children}

          <OrbitControls makeDefault enableDamping dampingFactor={0.1} screenSpacePanning={false}
            minDistance={MAP_MIN} maxDistance={MAP_MAX} minPolarAngle={0} maxPolarAngle={Math.PI * 0.41}
            mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
            touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} target={[HUB.x, 0, HUB.z]} />
          <Rig selected={incident ? null : selected} mode={mode} traceFocus={traceFocus} cmd={view} />
        </SCtx.Provider>
      </Canvas>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_85%_80%_at_50%_45%,transparent_55%,rgba(6,9,18,0.6)_100%)]" />
    </div>
  )
}

/* ------------------------------------------------------------------ inspection stage — the selected model, isolated and rotatable */

const NO_PICK: Pick = { hover: () => {}, select: () => {} }
const STAGE_DIST: Record<string, number> = { global: 34, vault: 10, core: 9, decoy: 6, area: 26 }

export function InspectStage({ id, state }: { id: string; state: React.RefObject<SceneState> }) {
  const p = parsePick(id)
  if (!p) return null
  const a = p.kind === 'global' || p.kind === 'decoy' ? null : AGENCIES.find((x) => x.id === p.agency)!
  const d = p.kind === 'decoy' ? DECOYS.find((x) => x.id === p.id)! : null
  const [cx, cz] = p.kind === 'global' ? GLOBAL : d ? [d.x, d.z] : p.kind === 'core' ? a!.core! : p.kind === 'vault' ? a!.vault! : [a!.x, a!.z]
  const cy = p.kind === 'global' ? 8.5 : p.kind === 'decoy' ? 1.2 : p.kind === 'area' ? 0.5 : 2
  const dist = STAGE_DIST[p.kind]
  if (p.kind !== 'global' && p.kind !== 'decoy' && !a!.protected) {
    return <div className="grid h-full place-items-center font-mono text-[11px] uppercase tracking-[0.2em] text-mute">Outside Quorum coverage · no infrastructure</div>
  }
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [dist * 0.62, cy + dist * 0.42, dist * 0.68], fov: 34, near: 0.1, far: 300 }}
      gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.3 }}>
      <SCtx.Provider value={state}>
        <ambientLight intensity={0.45} color="#c6cde0" />
        <hemisphereLight args={['#9aa8c8', '#3b2d1f', 1.2]} />
        <directionalLight position={[-8, 14, 9]} intensity={3} color="#ffe7cc" castShadow />
        <directionalLight position={[10, 6, -8]} intensity={1.1} color="#7f9ccc" />
        <group position={[-cx, 0, -cz]}>
          {p.kind === 'global' && <GlobalCore pick={NO_PICK} />}
          {d && <DecoyBeacon d={d} index={0} pick={NO_PICK} />}
          {a && (p.kind === 'core' || p.kind === 'area') && <LocalCore a={a} pick={NO_PICK} />}
          {a && (p.kind === 'vault' || p.kind === 'area') && <VaultBuilding a={a} pick={NO_PICK} />}
          {a && p.kind === 'area' && DECOYS.filter((x) => x.agency === a.id).map((x, i) => <DecoyBeacon key={x.id} d={x} index={i} pick={NO_PICK} />)}
        </group>
        {/* plinth for context */}
        <mesh rotation-x={-Math.PI / 2} position-y={0.05} receiveShadow><circleGeometry args={[dist * 0.55, 6]} /><meshStandardMaterial color="#8b7c6e" roughness={0.9} /></mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.06}><ringGeometry args={[dist * 0.55, dist * 0.56, 6]} /><meshBasicMaterial color="#d6a61f" toneMapped={false} /></mesh>
        <OrbitControls makeDefault enableDamping autoRotate autoRotateSpeed={0.6} target={[0, cy, 0]} minDistance={dist * 0.45} maxDistance={dist * 1.6} maxPolarAngle={Math.PI * 0.48} />
      </SCtx.Provider>
    </Canvas>
  )
}

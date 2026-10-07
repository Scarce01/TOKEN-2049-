import { useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { NODES, type HiveNode, type NodeId } from './data'

/** System-map objects layered over the hive: request path, workflows, gates, operational markers */
export type MapId =
  | 'backend' | 'req' | 'forged' | 'wf-trap' | 'wf-cosign' | 'wf-patrol' | 'verdict' | 'key' | 'approval' | 'quota' | 'bridge'
  | 'check-hot' | 'check-warm' | 'check-cold' | 'drift-hot' | 'drift-warm' | 'drift-cold'
  | `gate-${1 | 2 | 3 | 4 | 5 | 6 | 7}`

const H = { honey: '#FFC700', wax: '#FACF30', amber: '#FCAD17', cream: '#FFF1C1', red: '#E5484D', grey: '#8f8a7a', line: '#C9C6BD' }
const by = Object.fromEntries(NODES.map((n) => [n.id, n])) as Record<NodeId, HiveNode>
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const arc = (a: THREE.Vector3, b: THREE.Vector3, lift = 0.18, base = 0.6) => { const m = a.clone().lerp(b, 0.5); m.y += a.distanceTo(b) * lift + base; return new THREE.QuadraticBezierCurve3(a, m, b) }
const c01 = (x: number) => Math.max(0, Math.min(1, x))
const Y = 0.62

/* fixed layout — chosen to sit between the existing structure pads */
export const P = {
  backend: V(-14.4, Y, -6.2),
  accts: [V(-12.8, Y, -10.6), V(-9.0, Y, -13.6), V(-15.6, Y, -1.8)],
  key: V(-5.4, Y, -13.8),
  forged: V(-17.6, Y, 2.0),
  trap: V(-3.8, 2.6, 2.2), cosign: V(-3.1, 2.6, -3.1), patrol: V(3.4, 2.6, 2.8),
  approval: V(15.4, Y, -4.2),
  check: { hot: V(4.6, Y, 6.9), warm: V(12.7, Y, -1.9), cold: V(13.9, Y, 7.0) },
  drift: { hot: V(8.4, Y, 6.2), warm: V(9.0, Y, -2.6), cold: V(10.0, Y, 7.6) },
}
const atN = (id: NodeId, y = 1.4) => V(by[id].x, Y + y, by[id].z)

/** compact chips projected over the canvas */
export type Mark = { id: MapId; at: THREE.Vector3; text: string; tone: 'grey' | 'honey' | 'amber' | 'red'; modes: string[] }
export const MARKS: Mark[] = [
  { id: 'backend', at: P.backend.clone().setY(2.1), text: 'Backend\nuntrusted', tone: 'grey', modes: ['arch'] },
  { id: 'wf-trap', at: P.trap.clone().setY(3.5), text: 'Trap · 7/7', tone: 'honey', modes: ['live', 'arch'] },
  { id: 'wf-cosign', at: P.cosign.clone().setY(3.5), text: 'Cosign · Gate 0/7', tone: 'honey', modes: ['live', 'arch'] },
  { id: 'wf-patrol', at: P.patrol.clone().setY(3.5), text: 'Patrol · delayed', tone: 'amber', modes: ['live', 'arch'] },
  { id: 'key', at: P.key.clone().setY(2.6), text: 'Key delay\n00:42:18', tone: 'honey', modes: ['arch'] },
  { id: 'approval', at: P.approval.clone().setY(2.4), text: '1 / 2 signatures\npending', tone: 'honey', modes: ['arch'] },
  { id: 'quota', at: atN('hot', 3.1), text: 'Quota 1,120 / 2,400 ETH', tone: 'honey', modes: ['live', 'arch'] },
  { id: 'check-cold', at: P.check.cold.clone().setY(1.5), text: 'Δ −8 ETH', tone: 'amber', modes: ['live', 'arch'] },
  { id: 'drift-warm', at: P.drift.warm.clone().setY(1.5), text: 'Config drift', tone: 'amber', modes: ['live', 'arch'] },
  { id: 'bridge', at: V((by.registry.x + by.exB.x) / 2, 4.6, (by.registry.z + by.exB.z) / 2 - 0.6), text: 'Entry #4,118 → Bitget', tone: 'honey', modes: ['net'] },
]

type Ctx = { phase: number; rstep: number | null; hotDrained: boolean; mode: string; hover: string | null; selected: string | null; setHover: (id: string | null) => void; onPick: (id: MapId) => void; text: React.RefObject<Partial<Record<MapId, HTMLSpanElement | null>>> }

function hit(id: MapId, c: Ctx) {
  return {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); c.setHover(id); document.body.style.cursor = 'pointer' },
    onPointerOut: () => { c.setHover(null); document.body.style.cursor = '' },
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); c.onPick(id) },
  }
}
/** fat invisible tube so thin routes are easy to hover / click */
function Hit({ curve, id, c }: { curve: THREE.Curve<THREE.Vector3>; id: MapId; c: Ctx }) {
  const g = useMemo(() => new THREE.TubeGeometry(curve, 24, 0.32, 5), [curve])
  return <mesh geometry={g} {...hit(id, c)}><meshBasicMaterial transparent opacity={0} depthWrite={false} /></mesh>
}
function Beads({ curve, color, n = 3, speed = 0.25, on = true, size = 0.08 }: { curve: THREE.Curve<THREE.Vector3>; color: string; n?: number; speed?: number; on?: boolean; size?: number }) {
  const r = useRef<(THREE.Mesh | null)[]>([])
  useFrame((st) => r.current.forEach((m, i) => { if (!m) return; m.visible = on; m.position.copy(curve.getPoint((st.clock.elapsedTime * speed + i / n) % 1)) }))
  return <>{Array.from({ length: n }, (_, i) => <mesh key={i} ref={(el) => { r.current[i] = el }}><sphereGeometry args={[size, 8, 6]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>)}</>
}
const Pill = ({ r, h, color = '#1a1b20', emissive = '#000', k = 0 }: { r: number; h: number; color?: string; emissive?: string; k?: number }) => (
  <mesh position={[0, h / 2, 0]} castShadow><cylinderGeometry args={[r, r, h, 6]} /><meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={k} roughness={0.5} metalness={0.5} flatShading /></mesh>
)
function Ring({ r, w = 0.05, y = 0.02, color, k = 1, seg = 6 }: { r: number; w?: number; y?: number; color: string; k?: number; seg?: number }) {
  return <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[r - w, r, seg, 1, Math.PI / 2]} /><meshBasicMaterial color={new THREE.Color(color).multiplyScalar(k)} transparent toneMapped={false} depthWrite={false} side={THREE.DoubleSide} /></mesh>
}

/** Cosign evaluation loop: gates light one by one; every other request is held at gate 6 (quota) */
const GATE_T = 0.42
const CYCLE = 7 * GATE_T + 2.4
function gateState(t: number) {
  const k = Math.floor(t / CYCLE), u = t - k * CYCLE
  const reject = k % 2 === 1, stop = reject ? 6 : 8
  const lit = Math.min(7, Math.floor(u / GATE_T) + 1)
  const done = u > (reject ? 6 : 7) * GATE_T
  return { reject, stop, lit: reject ? Math.min(lit, 6) : lit, done, u }
}

export default function SystemMap(c: Omit<Ctx, never>) {
  const { phase, rstep, hotDrained, mode } = c
  const arch = mode === 'arch'
  const gates = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const verdictMat = useRef<{ opacity: number; color: THREE.Color } | null>(null)
  const fill = useRef<THREE.Mesh>(null)
  const scan = useRef<THREE.Group>(null)
  const forgedMat = useRef<{ dashOffset: number } | null>(null)
  const bridgeOn = mode === 'net' || (rstep === null && phase >= 7) || (rstep !== null && rstep >= 5)

  const curves = useMemo(() => {
    const board = atN('board', 0.9), cos = P.cosign, rec = atN('receiver', 1.6)
    return {
      backend: arc(P.backend.clone().setY(1.0), board, 0.1),
      reqs: P.accts.map((a) => arc(a.clone().setY(0.9), board, 0.1, 0.3)),
      keyReq: arc(P.key.clone().setY(0.9), board, 0.1, 0.3),
      boardCos: arc(board, cos, 0.2),
      verdict: arc(cos, rec, 0.15, 0.3),
      forged: arc(P.forged.clone().setY(0.9), V(by.decoy.x - 2.3, 1.0, by.decoy.z - 0.8), 0.06, 0.2),
      forgedHit: arc(P.forged.clone().setY(0.9), atN('decoy', 0.8), 0.06, 0.2),
      approval: arc(P.approval.clone().setY(1.0), atN('warm', 1.0), 0.15, 0.3),
      xA: arc(atN('exA', 1.6), atN('registry', 2.4), 0.25),
      xB: arc(atN('registry', 2.4), atN('exB', 1.6), 0.35),
    }
  }, [])
  const pts = useMemo(() => Object.fromEntries(Object.entries(curves).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => x.getPoints(40)) : v.getPoints(48)])) as Record<string, THREE.Vector3[] | THREE.Vector3[][]>, [curves])
  const forgedTouch = rstep === 0 || rstep === 1

  useFrame((st, dt) => {
    const t = st.clock.elapsedTime
    const g = gateState(t)
    gates.current.forEach((m, i) => {
      if (!m) return
      const n = i + 1
      const col = n < g.lit || (n === g.lit && !g.reject) || (g.done && !g.reject) ? H.honey : n === g.stop && g.lit >= n ? H.amber : '#3a3b40'
      m.color.set(col).multiplyScalar(n === g.stop && g.lit >= n ? 1.8 : n <= g.lit ? 1.1 : 0.6)
    })
    const vm = verdictMat.current
    if (vm) { vm.opacity = g.done ? c01((g.u - (g.reject ? 6 : 7) * GATE_T) / 0.4) * 0.95 : 0; vm.color.set(g.reject ? H.red : H.honey) }
    const el = c.text.current?.['wf-cosign']
    if (el) el.textContent = g.done ? (g.reject ? 'Cosign · rejected at Gate 6' : 'Cosign · 7/7 approve · 2.1s') : `Cosign · Gate ${g.lit} / 7`
    // KeyRegistry notBefore countdown
    const k = c.text.current?.key
    if (k) { const s = Math.max(0, 42 * 60 + 18 - Math.floor(t)); k.textContent = `Key delay\n${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }
    // quota bucket — drains to zero once the tightening wave arrives
    const q = hotDrained ? 0 : 1120 / 2400
    if (fill.current) { const s = fill.current.scale; s.y += (Math.max(0.001, q) - s.y) * Math.min(1, dt * 2.2); fill.current.visible = s.y > 0.004 }
    const qt = c.text.current?.quota
    if (qt) { const v = Math.round((fill.current?.scale.y ?? 0) * 2400); qt.textContent = `Quota ${v < 3 ? 0 : v.toLocaleString()} / 2,400 ETH` }
    if (scan.current) scan.current.rotation.y = -((t * 0.32) % (Math.PI * 2) - Math.PI)
    if (forgedMat.current) forgedMat.current.dashOffset -= dt * 0.8
  })

  const hov = (id: MapId) => c.hover === id || c.selected === id
  const hotP = by.hot
  return (
    <group>
      {/* Patrol scan beam — a faint radial blade sweeping from the core */}
      <group ref={scan} position={[0, 0.66, 0]}>
        <mesh position={[11, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[22, 0.06]} /><meshBasicMaterial color={H.cream} transparent opacity={0.12} toneMapped={false} depthWrite={false} /></mesh>
      </group>

      {/* Exchange backend — grey, untrusted, only reaches RequestBoard */}
      <group position={P.backend} {...hit('backend', c)}>
        {[[0, 0], [0.9, 0.5], [-0.9, 0.5], [0, -1.0], [0.9, -0.5], [-0.9, -0.5]].map(([x, z], i) => (
          <group key={i} position={[x, 0, z]}><Pill r={0.48} h={0.35 + (i % 3) * 0.18} color={rstep !== null && rstep <= 1 ? '#121216' : '#1d1e23'} /></group>
        ))}
        <Ring r={1.75} w={0.03} color={H.grey} k={hov('backend') ? 0.9 : 0.35} />
      </group>
      <Line points={pts.backend as THREE.Vector3[]} color={H.line} lineWidth={1} transparent opacity={arch || hov('backend') ? 0.45 : 0.16} dashed dashSize={0.25} gapSize={0.2} />

      {/* legitimate withdrawal requests — thin neutral lines into RequestBoard → Cosign */}
      {P.accts.map((a, i) => <group key={i} position={a}><Pill r={0.3} h={0.6 + i * 0.25} color="#1f2025" /></group>)}
      {(pts.reqs as THREE.Vector3[][]).map((p, i) => <Line key={i} points={p} color={H.line} lineWidth={0.9} transparent opacity={hov('req') ? 0.7 : 0.22} />)}
      {curves.reqs.map((cv, i) => <group key={i}><Hit curve={cv} id="req" c={c} /><Beads curve={cv} color={H.cream} n={1} speed={0.18 + i * 0.04} size={0.06} /></group>)}
      <Line points={pts.boardCos as THREE.Vector3[]} color={H.line} lineWidth={1.2} transparent opacity={hov('req') ? 0.8 : 0.3} />
      <Beads curve={curves.boardCos} color={H.cream} n={2} speed={0.22} size={0.07} />

      {/* forged / signature-invalid request — red dotted, never enters Cosign; stops at the trap layer unless a decoy is touched */}
      <Line ref={(l) => { forgedMat.current = (l?.material as unknown as { dashOffset: number }) ?? null }} points={(forgedTouch ? curves.forgedHit : curves.forged).getPoints(40)}
        color={H.red} lineWidth={1.6} transparent opacity={hov('forged') ? 1 : 0.7} dashed dashSize={0.12} gapSize={0.22} toneMapped={false} />
      <Hit curve={forgedTouch ? curves.forgedHit : curves.forged} id="forged" c={c} />
      {!forgedTouch && <mesh position={[by.decoy.x - 2.3, 1.0, by.decoy.z - 0.8]} rotation={[0, 0.4, 0]}><boxGeometry args={[0.04, 0.5, 0.5]} /><meshBasicMaterial color={H.red} toneMapped={false} /></mesh>}

      {/* key-delay account — honey outer ring, hollow center */}
      <group position={P.key} {...hit('key', c)}>
        <mesh position={[0, 0.55, 0]}><cylinderGeometry args={[0.5, 0.5, 1.1, 6, 1, true]} /><meshStandardMaterial color="#1d1e23" roughness={0.5} metalness={0.5} side={THREE.DoubleSide} flatShading /></mesh>
        <Ring r={0.5} w={0.07} y={1.12} color={H.honey} k={1.2} />
        <Ring r={0.75} w={0.025} y={0.04} color={H.honey} k={hov('key') ? 1 : 0.4} />
      </group>
      <Line points={pts.keyReq as THREE.Vector3[]} color={H.amber} lineWidth={0.9} transparent opacity={0.35} dashed dashSize={0.2} gapSize={0.25} />

      {/* three CRE workflows around the core */}
      {(['trap', 'cosign', 'patrol'] as const).map((w) => {
        const id = `wf-${w}` as MapId, warn = w === 'patrol'
        return (
          <group key={w} position={P[w]} {...hit(id, c)}>
            <mesh castShadow><cylinderGeometry args={[0.55, 0.62, 0.28, 6]} /><meshStandardMaterial color="#1c1d22" emissive={warn ? H.amber : H.honey} emissiveIntensity={hov(id) ? 0.8 : warn ? 0.45 : 0.25} roughness={0.4} metalness={0.6} flatShading /></mesh>
            <mesh position={[0, -1.0, 0]}><cylinderGeometry args={[0.012, 0.012, 2.0, 4]} /><meshBasicMaterial color={warn ? H.amber : H.honey} transparent opacity={0.35} toneMapped={false} /></mesh>
            {warn && <Ring r={0.85} w={0.04} y={0.16} color={H.amber} k={1.1} />}
          </group>
        )
      })}
      {/* seven-gate ring around Cosign */}
      <group position={P.cosign.clone().setY(P.cosign.y + 0.16)}>
        {Array.from({ length: 7 }, (_, i) => {
          const a0 = (i / 7) * Math.PI * 2 + 0.06, len = (Math.PI * 2) / 7 - 0.12
          const id = `gate-${i + 1}` as MapId
          return (
            <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} {...hit(id, c)} scale={hov(id) ? 1.08 : 1}>
              <ringGeometry args={[0.82, 1.08, 6, 1, a0, len]} />
              <meshBasicMaterial ref={(m) => { gates.current[i] = m }} color="#3a3b40" transparent toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
          )
        })}
      </group>
      {/* verdict → QuorumReceiver */}
      <Line ref={(l) => { verdictMat.current = (l?.material as unknown as { opacity: number; color: THREE.Color }) ?? null }} points={pts.verdict as THREE.Vector3[]} color={H.honey} lineWidth={2} transparent opacity={0} toneMapped={false} />
      <Hit curve={curves.verdict} id="verdict" c={c} />

      {/* quota bucket inside the hot vault */}
      <group position={[hotP.x, Y + 0.05, hotP.z]} {...hit('quota', c)}>
        <mesh position={[0, 0.75, 0]}><cylinderGeometry args={[0.62, 0.62, 1.5, 6, 1, true]} /><meshStandardMaterial color="#2a2b31" transparent opacity={0.28} roughness={0.1} metalness={0.2} side={THREE.DoubleSide} depthWrite={false} /></mesh>
        <mesh ref={fill} scale={[1, 1120 / 2400, 1]}><cylinderGeometry args={[0.56, 0.56, 1.5, 6]} /><meshStandardMaterial color="#5a4300" emissive={H.honey} emissiveIntensity={0.55} transparent opacity={0.85} /></mesh>
        <Ring r={0.62} w={0.03} y={1.5} color={H.honey} k={0.6} />
      </group>

      {/* manual approval — a separate human path into the warm vault */}
      <group position={P.approval} {...hit('approval', c)}>
        <Pill r={0.42} h={0.7} color="#1f2025" />
        <mesh position={[0, 1.05, 0]}><sphereGeometry args={[0.16, 12, 8]} /><meshStandardMaterial color="#2a2b31" emissive={H.honey} emissiveIntensity={0.5} /></mesh>
        <mesh position={[0, 0.82, 0]}><cylinderGeometry args={[0.1, 0.24, 0.22, 12]} /><meshStandardMaterial color="#2a2b31" emissive={H.honey} emissiveIntensity={0.35} /></mesh>
      </group>
      <Line points={pts.approval as THREE.Vector3[]} color={H.honey} lineWidth={1.2} transparent opacity={hov('approval') ? 0.9 : 0.4} dashed dashSize={0.5} gapSize={0.12} />
      <Hit curve={curves.approval} id="approval" c={c} />

      {/* asset conservation checkpoints + config integrity markers */}
      {(['hot', 'warm', 'cold'] as const).map((v) => {
        const ck = `check-${v}` as MapId, dr = `drift-${v}` as MapId
        const warnC = v === 'cold', warnD = v === 'warm'
        return (
          <group key={v}>
            <group position={P.check[v]} {...hit(ck, c)}>
              <mesh position={[0, 0.2, 0]} rotation={[0, Math.PI / 4, 0]}><octahedronGeometry args={[0.24]} /><meshStandardMaterial color={warnC ? '#4a3300' : '#2a2b31'} emissive={warnC ? H.amber : '#000'} emissiveIntensity={warnC ? 0.9 : 0} flatShading /></mesh>
              <Ring r={0.42} w={0.03} y={0.02} color={warnC ? H.amber : H.grey} k={hov(ck) ? 1.2 : warnC ? 0.8 : 0.3} />
            </group>
            <group position={P.drift[v]} {...hit(dr, c)}>
              <mesh position={[0, 0.16, 0]}><boxGeometry args={[0.34, 0.3, 0.34]} /><meshStandardMaterial color={warnD ? '#4a3300' : '#2a2b31'} emissive={warnD ? H.amber : '#000'} emissiveIntensity={warnD ? 0.8 : 0} /></mesh>
              <Ring r={0.38} w={0.03} y={0.02} color={warnD ? H.amber : H.grey} k={hov(dr) ? 1.2 : warnD ? 0.8 : 0.3} seg={4} />
            </group>
          </group>
        )
      })}

      {/* verified threat crossing the gap: Bybit → ThreatRegistry → Bitget */}
      {bridgeOn && (
        <group>
          <Line points={pts.xA as THREE.Vector3[]} color={H.honey} lineWidth={1.4} transparent opacity={mode === 'net' || hov('bridge') ? 0.8 : 0.35} dashed dashSize={0.18} gapSize={0.22} toneMapped={false} />
          <Line points={pts.xB as THREE.Vector3[]} color={H.honey} lineWidth={1.8} transparent opacity={mode === 'net' || hov('bridge') ? 0.95 : 0.4} dashed dashSize={0.18} gapSize={0.22} toneMapped={false} />
          <Beads curve={curves.xA} color={H.honey} n={2} speed={0.3} size={0.1} />
          <Beads curve={curves.xB} color={H.honey} n={3} speed={0.3} size={0.12} />
          <Hit curve={curves.xB} id="bridge" c={c} /><Hit curve={curves.xA} id="bridge" c={c} />
          <group position={[by.exB.x, Y + 0.02, by.exB.z]}><Ring r={3.0} w={0.05} color={H.honey} k={mode === 'net' ? 1 : 0.5} /><Ring r={3.4} w={0.025} color={H.honey} k={0.35} /></group>
        </group>
      )}
    </group>
  )
}

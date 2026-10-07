import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Edges, Environment, Lightformer, Line, OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import SystemMap, { MARKS, P as MP, type MapId } from './SystemMap'
import { EDGES, NODES, type EdgeKind, type HiveNode, type NodeId } from './data'

/* Palette — honey only */
const C = { ink: '#0B0D10', coal: '#0F1115', honey: '#FFC700', wax: '#FACF30', amber: '#FCAD17', cream: '#FFF1C1' }
const SQ3 = Math.sqrt(3)
const BORDER = 14.5
/** the cell field extends past the old border so the terrain fills the view */
const FIELD = 21
const byId = Object.fromEntries(NODES.map((n) => [n.id, n])) as Record<NodeId, HiveNode>

function hash(a: number, b: number) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function padRadius(id: NodeId) {
  return id === 'core' ? 4.6 : id === 'threat' ? 1.6 : byId[id].size === 'sm' ? 2.0 : 2.7
}
/** Platform heights: the core terrace sits highest, district pads float just above the base plinth */
const PLINTH = 0.32
const PAD_TOP = 0.62
const baseY = (n: HiveNode) => (n.id === 'core' ? 0.9 : n.id === 'threat' ? 0.1 : PAD_TOP)

/** Districts — large thin plates that group related structures and leave negative space between zones */
const DISTRICTS: { x: number; z: number; r: number }[] = [
  { x: -7.4, z: 6.4, r: 4.0 },   // threat edge / decoy
  { x: -6.6, z: -6.6, r: 5.6 },  // entry: exchange A + request board
  { x: 1.8, z: -0.4, r: 6.2 },   // core / CRE / receiver
  { x: 9.6, z: 3.0, r: 6.6 },    // vault cluster
  { x: 6.6, z: -9.2, r: 5.0 },   // registry / exchange B
]
const EMBOSS: NodeId[] = ['core', 'decoy', 'hot', 'warm', 'cold', 'registry']

/* ---------- materials ---------- */
const MAT = { metal: '#1c1d22', graphite: '#141519', plate: '#111216', steel: '#26272d' }
function Metal({ shade = MAT.metal, glow = 0, rough = 0.42 }: { shade?: string; glow?: number; rough?: number }) {
  return <meshStandardMaterial color={shade} roughness={rough} metalness={0.78} emissive={C.amber} emissiveIntensity={glow} flatShading />
}
function Graphite({ shade = MAT.graphite }: { shade?: string }) {
  return <meshStandardMaterial color={shade} roughness={0.85} metalness={0.25} flatShading />
}
function Smoked({ opacity = 0.42 }: { opacity?: number }) {
  return <meshPhysicalMaterial color="#1b1d23" roughness={0.12} metalness={0.4} transparent opacity={opacity} depthWrite={false} side={THREE.DoubleSide} />
}
function Resin({ on, k = 1 }: { on?: boolean; k?: number }) {
  return <meshPhysicalMaterial color={C.amber} roughness={0.25} metalness={0} transparent opacity={(on ? 0.26 : 0.12) * k} emissive={C.amber} emissiveIntensity={on ? 0.5 : 0.08} depthWrite={false} side={THREE.DoubleSide} />
}
function Glow({ color = C.honey, k = 1 }: { color?: string; k?: number }) {
  return <meshBasicMaterial color={new THREE.Color(color).multiplyScalar(k)} toneMapped={false} />
}
function Hex({ r, h, y = 0, r2, children }: { r: number; h: number; y?: number; r2?: number; children: React.ReactNode }) {
  return (
    <mesh position={[0, y + h / 2, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[r2 ?? r, r, h, 6]} />
      {children}
    </mesh>
  )
}
/** Chamfered hex volume — body plus a bevelled top edge; the core building block of the diorama */
function Block({ r, h, y = 0, bevel = 0.08, children }: { r: number; h: number; y?: number; bevel?: number; children: React.ReactNode }) {
  return (
    <group>
      <Hex r={r} h={h - bevel} y={y}>{children}</Hex>
      <Hex r={r} r2={r - bevel * 1.4} h={bevel} y={y + h - bevel}>{children}</Hex>
    </group>
  )
}
/** Recessed light seam between stacked volumes */
function Seam({ r, y, k }: { r: number; y: number; k: number }) {
  return <mesh position={[0, y, 0]}><cylinderGeometry args={[r, r, 0.035, 6, 1, true]} /><Glow color={C.amber} k={k} /></mesh>
}
function FlatRing({ r, w = 0.05, y = 0.02, k = 0.3, color = C.honey }: { r: number; w?: number; y?: number; k?: number; color?: string }) {
  return <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[r, r + w, 6, 1, Math.PI / 2]} /><Glow color={color} k={k} /></mesh>
}

/* ---------- ground ---------- */
function Terrain({ phase, focus }: { phase: number; focus: (id: NodeId) => boolean }) {
  const caps = useRef<THREE.InstancedMesh>(null)
  const m = useMemo(() => new THREE.Object3D(), [])
  // sparse honeycomb embossing — only on the pads of structures that matter
  const cells = useMemo(() => {
    const out: { x: number; z: number; y: number; id: NodeId }[] = []
    for (const id of EMBOSS) {
      const n = byId[id], R = padRadius(id) - 0.35, inner = id === 'core' ? 3.0 : 1.9
      for (let q = -7; q <= 7; q++) for (let r = -7; r <= 7; r++) {
        const x = SQ3 * 0.42 * (q + r / 2), z = 0.63 * r, d = Math.hypot(x, z)
        if (d < R && d > inner && hash(q + n.x, r + n.z) > 0.25) out.push({ x: n.x + x, z: n.z + z, y: baseY(n) + 0.012, id })
      }
    }
    return out
  }, [])
  useLayoutEffect(() => {
    const c = caps.current!
    const col = new THREE.Color()
    cells.forEach((t, i) => {
      m.position.set(t.x, t.y, t.z); m.rotation.set(-Math.PI / 2, 0, 0); m.updateMatrix()
      c.setMatrixAt(i, m.matrix)
      const lit = byId[t.id].phase <= phase && focus(t.id)
      c.setColorAt(i, col.set(C.honey).multiplyScalar(lit ? 0.16 : 0.03))
    })
    c.instanceMatrix.needsUpdate = true
    if (c.instanceColor) c.instanceColor.needsUpdate = true
  }, [cells, m, phase, focus])

  return (
    <group>
      {/* base plinth with chamfered edge */}
      <Block r={FIELD + 0.8} h={PLINTH} bevel={0.1}><meshStandardMaterial color={MAT.plate} roughness={0.9} metalness={0.2} flatShading /></Block>
      <FlatRing r={FIELD + 0.5} w={0.03} y={PLINTH + 0.005} k={0.14} />
      {/* structure pads */}
      {NODES.filter((n) => n.id !== 'threat').map((n) => {
        const R = padRadius(n.id)
        return (
          <group key={n.id} position={[n.x, PLINTH + 0.16, n.z]}>
            <Hex r={R - 0.2} h={0.05}><meshStandardMaterial color="#07080a" roughness={1} /></Hex>
            <Block r={R} h={PAD_TOP - PLINTH - 0.21} y={0.05} bevel={0.05}><Metal shade="#18191e" rough={0.6} /></Block>
            {n.id === 'core' && <Block r={3.6} h={0.28} y={PAD_TOP - PLINTH - 0.16} bevel={0.06}><Metal shade="#1b1c21" rough={0.5} /></Block>}
          </group>
        )
      })}
      <instancedMesh ref={caps} args={[undefined, undefined, cells.length]}>
        <ringGeometry args={[0.36, 0.4, 6, 1, Math.PI / 2]} />
        <meshBasicMaterial toneMapped={false} blending={THREE.AdditiveBlending} transparent depthWrite={false} />
      </instancedMesh>
    </group>
  )
}

/* ---------- structures ---------- */
/** Quorum Core — stacked hex architecture, dark metal, amber internal light, one beacon */
function Core({ on }: { on: boolean }) {
  const k = on ? 1 : 0.35
  return (
    <group>
      <FlatRing r={3.15} w={0.04} y={0.01} k={0.22 * k} />
      <FlatRing r={4.05} w={0.025} y={-0.27} k={0.14 * k} />
      <Block r={2.5} h={0.75}><Metal shade="#1a1b20" /></Block>
      <Seam r={2.18} y={0.8} k={0.9 * k} />
      <Block r={2.1} h={0.8} y={0.8}><Metal shade="#1e1f24" /></Block>
      <Seam r={1.62} y={1.65} k={1.1 * k} />
      <Block r={1.7} h={0.85} y={1.65}><Metal shade="#222328" /></Block>
      {/* smoked-glass crown with the amber heart inside */}
      <Hex r={1.2} r2={1.05} h={0.7} y={2.5}><Smoked opacity={0.5} /></Hex>
      <Hex r={0.55} h={0.5} y={2.6}><Glow color={C.amber} k={on ? 1.5 : 0.35} /></Hex>
      <Block r={1.15} h={0.18} y={3.2} bevel={0.05}><Metal shade="#26272c" /></Block>
      {/* single vertical beacon */}
      <mesh position={[0, 4.9, 0]}><cylinderGeometry args={[0.035, 0.035, 3.2, 6]} /><Glow color={C.wax} k={on ? 1.6 : 0.3} /></mesh>
      <mesh position={[0, 6.55, 0]}><cylinderGeometry args={[0.14, 0.14, 0.08, 6]} /><Glow color={C.cream} k={on ? 2.2 : 0.4} /></mesh>
      <pointLight position={[0, 2.8, 0]} color={C.amber} intensity={on ? 14 : 3} distance={9} decay={1.8} />
    </group>
  )
}

/** Exchange — a low, wide stack of bevelled blocks */
function Exchange({ on, incident }: { on: boolean; incident?: boolean }) {
  const blocks: [number, number, number, number, number][] = [[0, 0, 1.25, 1.1, 0], [0.9, -0.7, 0.8, 1.7, 0.25], [-0.9, 0.6, 0.7, 0.7, 0.1]]
  return (
    <group>
      {blocks.map(([x, z, r, h, y], i) => (
        <group key={i} position={[x, y, z]}>
          <Block r={r} h={h}><Metal shade={i === 1 ? '#202127' : '#1b1c21'} /></Block>
          <Seam r={r * 0.985} y={h * 0.62} k={on ? 0.7 : 0.18} />
        </group>
      ))}
      {incident && (
        /* untrusted backend — request source only, an unlit wireframe annex */
        <group position={[-1.6, 0, -1.2]}>
          <mesh position={[0, 0.45, 0]}><cylinderGeometry args={[0.45, 0.45, 0.9, 6]} /><meshBasicMaterial transparent opacity={0.03} /><Edges color="#6a665e" /></mesh>
        </group>
      )}
    </group>
  )
}

/** Decoy Chamber — compact layered amber resin shell, hidden core */
function Decoy({ on }: { on: boolean }) {
  const heart = useRef<THREE.Mesh>(null)
  useFrame((s) => { if (heart.current) heart.current.rotation.y = s.clock.elapsedTime * 0.3 })
  return (
    <group>
      <Block r={1.55} h={0.3}><Metal shade="#1c1c21" /></Block>
      <Hex r={1.15} h={1.35} y={0.3}><Resin on={on} /></Hex>
      <mesh position={[0, 0.975, 0]}><cylinderGeometry args={[1.15, 1.15, 1.35, 6, 1, true]} /><meshBasicMaterial transparent opacity={0} /><Edges color={on ? C.wax : '#4a3c18'} /></mesh>
      <Hex r={0.8} h={1.0} y={0.42}><Resin on={on} k={1.3} /></Hex>
      <mesh ref={heart} position={[0, 0.95, 0]}><cylinderGeometry args={[0.24, 0.24, 0.5, 6]} /><Glow color={C.wax} k={on ? 2.2 : 0.45} /></mesh>
      <Block r={1.2} h={0.12} y={1.65} bevel={0.04}><Metal shade="#202126" /></Block>
      <pointLight position={[0, 1, 0]} color={C.amber} intensity={on ? 8 : 1.5} distance={5} />
    </group>
  )
}

/** QuorumReceiver — a gate of two monoliths and a lintel, with an internal light slit */
function Receiver({ on }: { on: boolean }) {
  return (
    <group>
      {[-0.62, 0.62].map((x) => <group key={x} position={[x, 0, 0]}><Block r={0.42} h={1.55}><Metal shade="#1e1f24" /></Block></group>)}
      <mesh position={[0, 1.66, 0]} castShadow><boxGeometry args={[2.0, 0.24, 0.72]} /><Metal shade="#24252a" /></mesh>
      <mesh position={[0, 0.85, 0]}><boxGeometry args={[0.05, 1.1, 0.3]} /><Glow color={C.wax} k={on ? 1.6 : 0.3} /></mesh>
      <FlatRing r={1.25} w={0.035} y={0.01} k={on ? 0.5 : 0.12} />
    </group>
  )
}

/** ThreatRegistry — a ledger of stacked plates; each seam is a published entry layer */
function Registry({ on }: { on: boolean }) {
  return (
    <group>
      {[0, 1, 2, 3, 4].map((i) => (
        <group key={i}>
          <Block r={0.85 - i * 0.03} h={0.32} y={0.1 + i * 0.42} bevel={0.04}><Metal shade={i % 2 ? '#1d1e23' : '#202126'} /></Block>
          <Seam r={0.7 - i * 0.03} y={0.47 + i * 0.42} k={on ? (i === 4 ? 1.4 : 0.6) : 0.12} />
        </group>
      ))}
    </group>
  )
}

/** RequestBoard — stacked ledger slabs; records requests, holds no funds */
function Board() {
  return (
    <group>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, 0.16 + i * 0.3, 0]} castShadow>
          <boxGeometry args={[2.0 - i * 0.18, 0.2, 1.1]} />
          <Metal shade={i === 2 ? '#222328' : '#1b1c21'} />
        </mesh>
      ))}
      <mesh position={[0, 0.9, 0.56]}><boxGeometry args={[1.2, 0.025, 0.02]} /><Glow color="#9a9488" k={0.5} /></mesh>
    </group>
  )
}

/** Vaults — one architectural family; enclosure deepens from hot → warm → cold */
function Vault({ id, on, dir, t }: { id: 'hot' | 'warm' | 'cold'; on: boolean; dir: [number, number]; t: React.RefObject<number> }) {
  const shell = useRef<THREE.Group>(null)
  const lock = useRef<THREE.Mesh>(null)
  const beads = useRef<(THREE.Mesh | null)[]>([])
  const d = useMemo(() => { const l = Math.hypot(dir[0], dir[1]); return [dir[0] / l, dir[1] / l] }, [dir])
  // outbound flow: hot narrows to a trickle, warm to a single cosigned lane — never zero
  const lanes = id === 'cold' ? 0 : 6
  const open = id === 'hot' ? (on ? 1 : 6) : id === 'warm' ? (on ? 2 : 5) : 0
  const level = !on ? 1 : id === 'hot' ? 0.04 : id === 'warm' ? 0.4 : 0.85
  const wall = id === 'hot' ? { h: 0.5, arc: 0.6 } : id === 'warm' ? { h: 1.05, arc: 0.83 } : { h: 1.55, arc: 1 }
  const yaw = Math.atan2(d[0], d[1]) + Math.PI * (1 - wall.arc) // opening faces outward
  useFrame((_, dt) => {
    if (shell.current) { const k = on && id === 'cold' ? 1.18 : 1; shell.current.scale.y += (k - shell.current.scale.y) * Math.min(1, dt * 3) }
    if (lock.current) { const k = on ? 1.3 : 1; lock.current.scale.setScalar(lock.current.scale.x + (k - lock.current.scale.x) * Math.min(1, dt * 2.5)) }
    beads.current.forEach((b, i) => {
      if (!b) return
      const u = ((t.current ?? 0) * (on ? 0.25 : 0.55) + i / lanes) % 1
      const r = 2.3 + u * 3.0, side = ((i % 3) - 1) * (on ? 0.1 : 0.4)
      b.position.set(d[0] * r - d[1] * side, 0.12, d[1] * r + d[0] * side)
      b.visible = i < open
      b.scale.setScalar(1 - u * 0.6)
    })
  })
  return (
    <group>
      {/* shell — partial for hot/warm, closed and thick for cold */}
      <group ref={shell}>
        <mesh position={[0, wall.h / 2, 0]} rotation={[0, yaw, 0]} castShadow>
          <cylinderGeometry args={[1.85, 1.85, wall.h, 6, 1, true, 0, Math.PI * 2 * wall.arc]} />
          <meshStandardMaterial color="#1c1d22" roughness={0.5} metalness={0.75} flatShading side={THREE.DoubleSide} />
        </mesh>
        {id === 'cold' && <Block r={1.85} h={0.2} y={wall.h} bevel={0.06}><Metal shade="#222328" /></Block>}
        {id === 'cold' && <Hex r={1.55} h={wall.h} y={0}><Graphite shade="#121317" /></Hex>}
      </group>
      {/* vault chamber */}
      {id !== 'cold' && <>
        <Block r={0.9} h={id === 'hot' ? 0.75 : 1.15}><Metal shade="#202126" /></Block>
        <Hex r={0.6} h={0.06} y={id === 'hot' ? 0.75 : 1.15}><Glow color={C.amber} k={on ? 0.55 : 1.0} /></Hex>
      </>}
      {/* flow channels — hot only */}
      {id === 'hot' && [-0.4, 0, 0.4].map((s, i) => (
        <mesh key={i} position={[d[0] * 3.2 - d[1] * s, 0.012, d[1] * 3.2 + d[0] * s]} rotation={[-Math.PI / 2, 0, -Math.atan2(d[1], d[0])]}>
          <planeGeometry args={[2.4, 0.05]} /><Glow color={C.honey} k={on ? (i === 1 ? 0.35 : 0.06) : 0.35} />
        </mesh>
      ))}
      {/* quota arc: length = remaining flow allowance */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.1, 2.2, 48, 1, Math.PI / 2, Math.PI * 2 * level]} />
        <Glow color={on ? C.amber : C.honey} k={on ? 0.9 : 0.25} />
      </mesh>
      {Array.from({ length: lanes }, (_, i) => <mesh key={i} ref={(el) => { beads.current[i] = el }}><boxGeometry args={[0.13, 0.08, 0.13]} /><Glow color={C.honey} k={on ? 1.2 : 1.8} /></mesh>)}
      {id === 'cold' && <mesh ref={lock} position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[2.4, 2.47, 6, 1, Math.PI / 2]} /><Glow color={C.wax} k={on ? 1 : 0.2} /></mesh>}
      {/* warm: protective ring + translucent amber enclosure when restricted */}
      {id === 'warm' && on && <>
        <FlatRing r={2.32} w={0.06} y={0.015} k={0.9} color={C.amber} />
        <mesh position={[0, 0.8, 0]}><cylinderGeometry args={[2.0, 2.0, 1.6, 6, 1, true]} /><Resin on k={0.5} /></mesh>
      </>}
    </group>
  )
}

/** Threat origin — a red inverted triangle hovering over the exact hex the malicious tx came from */
function Threat({ t, found }: { t: React.RefObject<number>; found: boolean }) {
  const g = useRef<THREE.Group>(null)
  useFrame(() => { if (g.current) { g.current.position.y = 2.0 + Math.sin((t.current ?? 0) * 1.2) * 0.1; g.current.rotation.y = (t.current ?? 0) * 0.4 } })
  return (
    <group>
      <Block r={1.0} h={0.42} y={0} bevel={0.05}><Metal shade="#1a1214" rough={0.5} /></Block>
      <FlatRing r={0.82} w={0.05} y={0.44} k={found ? 1.4 : 0.22} color={RED} />
      {found && <FlatRing r={1.25} w={0.03} y={0.44} k={0.7} color={RED} />}
      <mesh position={[0, 0.9, 0]}><cylinderGeometry args={[0.012, 0.012, 1.0, 4]} /><meshBasicMaterial color={RED} transparent opacity={0.5} toneMapped={false} /></mesh>
      <group ref={g}>
        <mesh rotation={[Math.PI, 0, 0]} castShadow>
          <coneGeometry args={[0.62, 1.05, 3]} />
          <meshStandardMaterial color={found ? '#5a1418' : '#1b1c21'} emissive={RED} emissiveIntensity={found ? 1.1 : 0.08} roughness={0.35} metalness={0.3} flatShading />
          <Edges color={found ? "#ff8a8e" : "#4a3335"} />
        </mesh>
      </group>
    </group>
  )
}

/** Attack point — the malicious tx lands on the decoy hex: red ▼ hovering just above the honeypot */
function AttackMark({ t, onClick }: { t: React.RefObject<number>; onClick: () => void }) {
  const g = useRef<THREE.Group>(null)
  useFrame(() => { if (g.current) { g.current.position.y = 3.1 + Math.sin((t.current ?? 0) * 1.6) * 0.12; g.current.rotation.y = (t.current ?? 0) * 0.5 } })
  return (
    <group position={[byId.decoy.x, baseY(byId.decoy), byId.decoy.z]} onClick={(e) => { e.stopPropagation(); onClick() }}
      onPointerOver={() => { document.body.style.cursor = 'pointer' }} onPointerOut={() => { document.body.style.cursor = '' }}>
      <group ref={g}>
        <mesh rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.5, 0.85, 3]} /><meshStandardMaterial color="#5a1418" emissive={RED} emissiveIntensity={0.9} roughness={0.35} flatShading /><Edges color="#ff8a8e" /></mesh>
      </group>
      <mesh position={[0, 2.3, 0]}><cylinderGeometry args={[0.01, 0.01, 1.3, 4]} /><meshBasicMaterial color={RED} transparent opacity={0.45} toneMapped={false} /></mesh>
    </group>
  )
}

/* ---------- routes ---------- */
const ROUTE: Record<EdgeKind, { color: string; dash?: [number, number]; w: number; speed: number }> = {
  attack: { color: C.amber, dash: [0.35, 0.3], w: 2, speed: 0.35 },
  probe: { color: C.amber, dash: [0.12, 0.35], w: 1.2, speed: 0.25 },
  request: { color: '#8f8a7a', dash: [0.2, 0.4], w: 1.2, speed: 0.15 },
  verify: { color: C.wax, dash: [0.6, 0.15], w: 2, speed: 0.5 },
  exec: { color: C.honey, w: 2.4, speed: 0.55 },
  intel: { color: C.cream, w: 1.8, speed: 0.4 },
}
const topY = (id: NodeId) => (id === 'core' ? 3.4 : id === 'threat' ? 2.6 : id === 'board' ? 1.4 : id === 'registry' ? 2.4 : 1.4)

function Route({ from, to, kind, live, focused, dimmed }: { from: HiveNode; to: HiveNode; kind: EdgeKind; live: boolean; focused: boolean; dimmed: boolean }) {
  const s = ROUTE[kind] ?? ROUTE.request
  const curve = useMemo(() => {
    const a = new THREE.Vector3(from.x, baseY(from) + topY(from.id) * 0.5, from.z)
    const b = new THREE.Vector3(to.x, baseY(to) + topY(to.id) * 0.5, to.z)
    const m = a.clone().lerp(b, 0.5); m.y += a.distanceTo(b) * 0.22 + 0.8
    return new THREE.QuadraticBezierCurve3(a, m, b)
  }, [from, to])
  const pts = useMemo(() => curve.getPoints(64), [curve])
  const beads = useRef<(THREE.Mesh | null)[]>([])
  useFrame((st) => {
    beads.current.forEach((b, i) => {
      if (!b) return
      const u = (st.clock.elapsedTime * s.speed * 0.5 + i / 3) % 1
      b.position.copy(curve.getPoint(u))
      b.visible = live && focused
    })
  })
  const op = dimmed ? 0.025 : focused ? 0.95 : live ? 0.13 : 0.05
  return (
    <group>
      <Line points={pts} color={s.color} lineWidth={focused ? s.w * 1.3 : s.w * 0.7} transparent opacity={op} dashed={!!s.dash} dashSize={s.dash?.[0]} gapSize={s.dash?.[1]} toneMapped={false} />
      {!dimmed && [0, 1, 2].map((i) => (
        <mesh key={i} ref={(el) => { beads.current[i] = el }}>
          <sphereGeometry args={[kind === 'exec' ? 0.13 : 0.1, 8, 6]} />
          <Glow color={s.color} k={kind === 'request' ? 0.8 : 2} />
        </mesh>
      ))}
    </group>
  )
}

/* ---------- labels ---------- */
const labelY = (n: HiveNode) => baseY(n) + (n.id === 'core' ? 6.9 : n.id === 'threat' ? 2.6 : n.id === 'decoy' ? 2.4 : n.id.startsWith('ex') ? 2.6 : n.id === 'board' ? 1.6 : n.id === 'registry' ? 2.9 : n.id === 'receiver' ? 2.4 : 2.4)
type LabelRefs = React.RefObject<Partial<Record<NodeId, HTMLDivElement | null>>>

/** Projects label anchors to screen space each frame — labels live in plain DOM above the canvas */
function Projector({ labels }: { labels: LabelRefs }) {
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    for (const n of NODES) {
      const el = labels.current?.[n.id]
      if (!el) continue
      v.set(n.x, labelY(n), n.z).project(camera)
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -100%)`
    }
  })
  return null
}

function NodeLabel({ n, on, open, dim, hidden, name, tag, onClick, onHover, elRef }: { n: HiveNode; on: boolean; tag?: string; open: boolean; dim: boolean; hidden: boolean; name: string; onClick: () => void; onHover: (h: boolean) => void; elRef: (el: HTMLDivElement | null) => void }) {
  const threat = n.id === 'decoy' && on
  const red = n.id === 'threat'
  return (
    <div ref={elRef} className="absolute left-0 top-0 will-change-transform" style={{ opacity: hidden ? 0 : dim ? 0.3 : 1, pointerEvents: hidden ? 'none' : undefined, transition: 'opacity .3s', zIndex: open ? 2 : 1 }}
      onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <button onClick={onClick} className={`group relative block text-left whitespace-nowrap rounded-md border backdrop-blur-sm transition-all ${open ? 'bg-ink/95 border-honey/70 shadow-[0_0_24px_rgba(255,199,0,.25)]' : threat ? 'bg-ink/85 border-wax' : on ? 'bg-ink/75 border-honey/40 hover:border-honey/80' : 'bg-ink/60 border-honey/15 hover:border-honey/50'} ${red ? '!border-[#E5484D]/70' : ''}`}>
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          {red ? <svg width="10" height="9" viewBox="0 0 10 9"><polygon points="0.5,0.5 9.5,0.5 5,8.5" fill={RED} /></svg> : <svg width="9" height="9" viewBox="0 0 10 10" className={threat ? 'blink' : ''}><polygon points="2.5,0.7 7.5,0.7 9.6,5 7.5,9.3 2.5,9.3 0.4,5" fill={on ? (threat ? C.wax : C.honey) : 'none'} stroke={n.id === 'threat' ? C.amber : C.honey} strokeWidth="1.2" strokeDasharray={n.id === 'threat' ? '2 1.4' : undefined} /></svg>}
          <span className={`${n.size === 'lg' ? 'text-[14px]' : n.size === 'sm' ? 'text-[11.5px]' : 'text-[12.5px]'} font-semibold ${on ? 'text-cream' : 'text-dim'}`}>{name}</span>
          <span className={`${n.size === 'sm' && !open ? 'hidden' : ''} font-mono text-[10px] uppercase tracking-wider ${threat ? 'text-wax' : on ? 'text-honey' : 'text-mute'}`}>{on ? n.status : n.kind}</span>
        </div>
        {tag && !open && <div key={tag} className="tag-in border-t border-white/[0.06] px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wider ${red ? 'text-[#FF7A7E]' : 'text-flare'} whitespace-pre-line">{tag}</div>}
        {open && (
          <dl className="absolute left-0 top-full mt-1.5 rounded-md bg-ink/95 border border-honey/40 shadow-[0_12px_32px_rgba(0,0,0,.6)] px-2.5 py-2 space-y-1.5 w-[240px] whitespace-normal">
            <div><dt className="text-[10px] font-mono uppercase tracking-wider text-mute">{n.kind}</dt></div>
            <div><dt className="text-[11px] text-mute">Latest event</dt><dd className="font-mono text-[11.5px] text-cream">{n.event}</dd></div>
            <div><dt className="text-[11px] text-mute">Restriction level</dt><dd className="text-[12px] text-honey">{n.restriction}</dd></div>
          </dl>
        )}
      </button>
    </div>
  )
}

/* ---------- incident replay ---------- */
type VId = 'hot' | 'warm' | 'cold'
export const REPLAY_DUR = [2.4, 2.4, 4.4, 2.2, 4.4, 2.6, 3.8]
const WAVE_SPEED = 6
/** seconds into step 5 at which the lockdown wave reaches each vault */
export const VAULT_AT = Object.fromEntries((['hot', 'warm', 'cold'] as VId[]).map((id) => [id, Math.hypot(byId[id].x - byId.decoy.x, byId[id].z - byId.decoy.z) / WAVE_SPEED])) as Record<VId, number>
const at = (id: NodeId, k = 0.5) => new THREE.Vector3(byId[id].x, baseY(byId[id]) + topY(id) * k, byId[id].z)
const arcOf = (a: THREE.Vector3, b: THREE.Vector3, lift = 0.22) => { const m = a.clone().lerp(b, 0.5); m.y += a.distanceTo(b) * lift + 0.8; return new THREE.QuadraticBezierCurve3(a, m, b) }
const c01 = (x: number) => Math.max(0, Math.min(1, x))
const ease = (x: number) => 1 - Math.pow(1 - c01(x), 3)
const CRE = Array.from({ length: 7 }, (_, i) => { const a = (i / 7) * Math.PI * 2 + 0.35; return new THREE.Vector3(Math.cos(a) * 3.3, 0.9, Math.sin(a) * 3.3) })
const CORE_IN = new THREE.Vector3(0, 3.2, 0)
const EXB_A = Math.atan2(byId.exB.z, byId.exB.x)
const MEMBERS_FX = Array.from({ length: 7 }, (_, i) => { const a = EXB_A - 1.1 + (i / 6) * 2.2; return new THREE.Vector3(Math.cos(a) * 18.4, 0, Math.sin(a) * 18.4) })
const NOW = new THREE.Color()

function ReplayFX({ step, paused, phase, onArm }: { step: number | null; paused: boolean; phase: number; onArm: (id: VId) => void }) {
  const lt = useRef(0)
  const last = useRef<number | null | undefined>(undefined)
  const armed = useRef(new Set<VId>())
  const probe = useRef<(THREE.Mesh | null)[]>([])
  const burst = useRef<(THREE.Mesh | null)[]>([])
  const flash = useRef<THREE.PointLight>(null)
  const nodes = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const beams = useRef<(THREE.Mesh | null)[]>([])
  const packet = useRef<THREE.Mesh>(null)
  const gate = useRef<THREE.Mesh>(null)
  const wave = useRef<(THREE.Mesh | null)[]>([])
  const sweep = useRef<(THREE.Mesh | null)[]>([])
  const entry = useRef<THREE.Mesh>(null)
  const entryMat = useRef<THREE.MeshBasicMaterial>(null)
  const ripple = useRef<THREE.Mesh>(null)
  const net = useRef<(THREE.Mesh | null)[]>([])
  const mem = useRef<(THREE.MeshStandardMaterial | null)[]>([])
  const memRing = useRef<(THREE.Mesh | null)[]>([])

  const C_PROBE = useMemo(() => arcOf(at('threat'), at('decoy'), 0.12), [])
  const C_REPORT = useMemo(() => arcOf(at('core', 1), at('receiver', 1), 0.3), [])
  const C_SWEEP = useMemo(() => arcOf(at('hot'), at('cold'), 0.32), [])
  const C_NET = useMemo(() => arcOf(at('registry', 1), at('exB'), 0.25), [])
  const decoyP = useMemo(() => at('decoy', 0), [])
  const recvP = useMemo(() => at('receiver', 0), [])
  const regP = useMemo(() => at('registry', 0), [])

  useFrame(({ camera }, dt) => {
    if (last.current !== step) { last.current = step; lt.current = 0; armed.current = new Set() }
    if (!paused) lt.current += dt
    const t = lt.current, s = step ?? -1, rest = step === null

    // 1 · probe — dim dashed amber beads crawling toward the decoy
    probe.current.forEach((m, i) => { if (!m) return; m.visible = s === 0; m.position.copy(C_PROBE.getPoint(((t * 0.42) + i * 0.09) % 1)) })

    // 2 · decoy trigger — one strong pulse, two rings
    burst.current.forEach((m, i) => {
      if (!m) return
      const p = c01((t - i * 0.25) / 1.3)
      m.visible = s === 1 && t > i * 0.25
      m.scale.setScalar(1 + ease(p) * 3.2)
      ;(m.material as THREE.MeshBasicMaterial).opacity = (1 - p) * (i ? 0.45 : 0.95)
    })
    if (flash.current) flash.current.intensity = s === 1 ? 30 * Math.max(0, 1 - t / 1.4) : 0

    // 3 · seven independent CRE nodes verify the same evidence
    const v = s === 2 ? Math.min(7, Math.floor(t / 0.45)) : s > 2 || (rest && phase >= 3) ? 7 : 0
    nodes.current.forEach((m, i) => {
      if (!m) return
      const hot = s === 2 && t >= (i + 1) * 0.45 && t < (i + 1) * 0.45 + 0.35
      m.color.copy(NOW.set(i < v ? C.wax : C.honey).multiplyScalar(hot ? 3.5 : i < v ? 1.5 : 0.22))
    })
    beams.current.forEach((m, i) => {
      if (!m) return
      const u = (t - (i + 1) * 0.45) / 0.4
      m.visible = s === 2 && u >= 0 && u <= 1
      if (m.visible) m.position.copy(CRE[i]).setY(1.6).lerp(CORE_IN, ease(u))
    })
    // signed report → QuorumReceiver
    if (packet.current) {
      const u = s === 2 ? c01((t - 3.4) / 1.0) * 0.85 : s === 3 ? 0.85 + c01(t / 0.5) * 0.15 : -1
      packet.current.visible = u > 0 && u < 1
      if (packet.current.visible) { packet.current.position.copy(C_REPORT.getPoint(u)); packet.current.rotation.y += dt * 3 }
    }
    if (gate.current) {
      const p = c01((t - 0.5) / 1.1)
      gate.current.visible = s === 3 && t > 0.5
      gate.current.scale.setScalar(1 + ease(p) * 2.4)
      ;(gate.current.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.9
    }

    // 5 · hive lockdown wave — a calm hex front, vaults tighten as it passes
    wave.current.forEach((m, i) => {
      if (!m) return
      const r = Math.max(0.01, (t - i * 0.35) * WAVE_SPEED)
      m.visible = s === 4 && r > 0.01 && r < 24
      m.scale.setScalar(r)
      ;(m.material as THREE.MeshBasicMaterial).opacity = (1 - c01(r / 16)) * (i ? 0.22 : 0.55)
    })
    if (s === 4) (['hot', 'cold', 'warm'] as VId[]).forEach((id) => { if (t >= VAULT_AT[id] && !armed.current.has(id)) { armed.current.add(id); onArm(id) } })
    sweep.current.forEach((m, i) => {
      if (!m) return
      m.visible = (s === 4 && t > VAULT_AT.hot) || s === 5
      m.position.copy(C_SWEEP.getPoint(((t - VAULT_AT.hot) * 0.42 + i / 6 + 1) % 1))
    })

    // 6 · new registry entry slides down and locks into the ledger
    if (entry.current && entryMat.current) {
      const p = s === 5 ? ease(t / 0.9) : 1
      entry.current.visible = s >= 5
      entry.current.position.set(regP.x, regP.y + 2.4 + (1 - p) * 3.2, regP.z)
      entryMat.current.color.copy(NOW.set(C.cream).multiplyScalar(s === 5 && t > 0.9 && t < 1.5 ? 3 : 1.1))
    }

    // 7 · propagation — ThreatRegistry → Bitget → members, each lights only on ack
    if (ripple.current) {
      const p = c01(t / 2.2)
      ripple.current.visible = s === 6
      ripple.current.scale.setScalar(1 + p * 11)
      ;(ripple.current.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.5
    }
    net.current.forEach((m, i) => { if (!m) return; m.visible = s === 6; m.position.copy(C_NET.getPoint(c01(t / 0.8 - i * 0.12) * 0.999)) })
    mem.current.forEach((m, i) => {
      if (!m) return
      const lit = s === 6 ? t > 1 + i * 0.38 && i < 6 : s === 7 || (rest && phase >= 7) ? i < 6 : false
      m.emissiveIntensity += ((lit ? 0.35 : 0.02) - m.emissiveIntensity) * Math.min(1, dt * 4)
    })
    memRing.current.forEach((m, i) => { if (m) m.visible = s === 6 ? t > 1 + i * 0.38 && i < 6 : (s === 7 || (rest && phase >= 7)) && i < 6 })

    // scope widens for propagation
    if (!rest && !paused) {
      const cam = camera as THREE.PerspectiveCamera
      const z = s >= 6 ? 0.9 : 1
      if (Math.abs(cam.zoom - z) > 0.002) { cam.zoom += (z - cam.zoom) * Math.min(1, dt * 1.4); cam.updateProjectionMatrix() }
    }
  })

  const ringMat = (k = 1) => <meshBasicMaterial color={NOW.set(C.wax).clone().multiplyScalar(k)} transparent toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
  return (
    <group>
      {[0, 1, 2, 3].map((i) => <mesh key={i} ref={(el) => { probe.current[i] = el }} visible={false}><octahedronGeometry args={[0.12]} /><Glow color={C.amber} k={1.4 - i * 0.25} /></mesh>)}

      <group position={[decoyP.x, decoyP.y + 0.45, decoyP.z]}>
        {[0, 1].map((i) => <mesh key={i} ref={(el) => { burst.current[i] = el }} rotation={[-Math.PI / 2, 0, 0]} visible={false}><ringGeometry args={[2.1, 2.3, 6, 1, Math.PI / 2]} />{ringMat(2.4)}</mesh>)}
        <pointLight ref={flash} position={[0, 2.5, 0]} color={C.wax} intensity={0} distance={14} />
      </group>

      {/* CRE DON — seven independent verifier nodes on the core terrace */}
      {CRE.map((p, i) => (
        <group key={i} position={p}>
          <Block r={0.3} h={0.62} bevel={0.05}><Metal shade="#1f2025" /></Block>
          <mesh position={[0, 0.65, 0]}><cylinderGeometry args={[0.17, 0.17, 0.05, 6]} /><meshBasicMaterial ref={(el) => { nodes.current[i] = el }} toneMapped={false} /></mesh>
        </group>
      ))}
      {CRE.map((_, i) => <mesh key={i} ref={(el) => { beams.current[i] = el }} visible={false}><sphereGeometry args={[0.1, 8, 6]} /><Glow color={C.wax} k={4} /></mesh>)}
      <mesh ref={packet} visible={false}><boxGeometry args={[0.42, 0.3, 0.42]} /><Glow color={C.cream} k={3} /></mesh>
      <mesh ref={gate} position={[recvP.x, recvP.y + 0.4, recvP.z]} rotation={[-Math.PI / 2, 0, 0]} visible={false}><ringGeometry args={[1.4, 1.55, 6, 1, Math.PI / 2]} />{ringMat(2.4)}</mesh>

      {[0, 1].map((i) => <mesh key={i} ref={(el) => { wave.current[i] = el }} position={[byId.decoy.x, 0.66, byId.decoy.z]} rotation={[-Math.PI / 2, 0, 0]} visible={false}><ringGeometry args={[0.965, 1, 6, 1, Math.PI / 2]} />{ringMat(i ? 1 : 1.6)}</mesh>)}
      {Array.from({ length: 6 }, (_, i) => <mesh key={i} ref={(el) => { sweep.current[i] = el }} visible={false}><boxGeometry args={[0.2, 0.2, 0.2]} /><Glow color={C.honey} k={3} /></mesh>)}

      <mesh ref={entry} visible={false}><cylinderGeometry args={[0.72, 0.72, 0.14, 6]} /><meshBasicMaterial ref={entryMat} toneMapped={false} /></mesh>
      <mesh ref={ripple} position={[regP.x, regP.y + 0.35, regP.z]} rotation={[-Math.PI / 2, 0, 0]} visible={false}><ringGeometry args={[1.3, 1.4, 6, 1, Math.PI / 2]} /><meshBasicMaterial color={C.cream} transparent toneMapped={false} depthWrite={false} /></mesh>
      {[0, 1, 2].map((i) => <mesh key={i} ref={(el) => { net.current[i] = el }} visible={false}><sphereGeometry args={[0.13, 8, 6]} /><Glow color={C.cream} k={3} /></mesh>)}

      {/* other network members — beyond the kingdom wall */}
      {MEMBERS_FX.map((p, i) => (
        <group key={i} position={p}>
          <Block r={1.0} h={0.2} bevel={0.05}><Metal shade="#16171b" /></Block>
          <Block r={0.55} h={0.6 + (i % 3) * 0.25} y={0.2}><meshStandardMaterial ref={(el) => { mem.current[i] = el }} color="#1d1e23" roughness={0.45} metalness={0.75} flatShading emissive={C.honey} emissiveIntensity={0.02} /></Block>
          <mesh ref={(el) => { memRing.current[i] = el }} position={[0, 0.3, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}><ringGeometry args={[1.12, 1.17, 6, 1, Math.PI / 2]} /><Glow color={C.honey} k={0.9} /></mesh>
        </group>
      ))}
    </group>
  )
}

/** Hover/selection: the structure lifts slightly off its pad */
function Lift({ up, k = 0.22, children }: { up: boolean; k?: number; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null)
  useFrame((_, dt) => { if (g.current) g.current.position.y += ((up || k > 0.22 ? k : 0) - g.current.position.y) * Math.min(1, dt * 8) })
  return <group ref={g}>{children}</group>
}

function MarkProjector({ refs }: { refs: React.RefObject<Partial<Record<MapId, HTMLDivElement | null>>> }) {
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    for (const m of MARKS) {
      const el = refs.current?.[m.id]
      if (!el) continue
      v.copy(m.at).project(camera)
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -100%)`
    }
  })
  return null
}

/** Shift the projection so the diorama sits in the centre of the free area (left of the incident panel, below the heading) while orbiting around its own centre */
function Frame() {
  const { camera, size } = useThree()
  useLayoutEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    cam.setViewOffset(size.width, size.height, 190, -70, size.width, size.height)
    cam.updateProjectionMatrix()
    return () => { cam.clearViewOffset() }
  }, [camera, size])
  return null
}

/* ---------- topology: honeycomb cell field ---------- */
/** Red is reserved for the threat origin and nothing else */
const RED = '#E5484D'
const CELL = 0.43
const SIG: Partial<Record<NodeId, number>> = { core: 1, hot: 0.85, warm: 0.8, cold: 0.9, decoy: 0.7, registry: 0.75, receiver: 0.6, exA: 0.6, exB: 0.6, board: 0.3 }
/** Trace Origin: outward detection ripple from the attack hex (0 → OUT), then an inward narrowing toward the source */
export const TRACE_OUT = 2.8
export const TRACE_DUR = 9.4
export const TRACE_REJECT = [5.0, 5.6, 6.2, 6.8]
export const TRACE_VERIFY = 7.4
/** decoy → origin candidates; index 0 is the real source */
const ORIGINS: [number, number][] = [[byId.threat.x, byId.threat.z], [-14.2, -1.6], [-3.4, 13.2], [-12.4, -9.4], [2.6, 13.8]]
const gauss = (d: number, w: number) => Math.exp(-(d * d) / (w * w))
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, u = c01(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz))
  return Math.hypot(px - ax - u * dx, pz - az - u * dz)
}
/** terrain is cleared beneath system-map objects so they read on the surface */
const CLEAR: [number, number, number][] = [
  [MP.backend.x, MP.backend.z, 1.9], [MP.key.x, MP.key.z, 0.9], [MP.approval.x, MP.approval.z, 0.8], [MP.forged.x, MP.forged.z, 0.6],
  ...MP.accts.map((a) => [a.x, a.z, 0.5] as [number, number, number]),
  ...(['hot', 'warm', 'cold'] as const).flatMap((v) => [[MP.check[v].x, MP.check[v].z, 0.55], [MP.drift[v].x, MP.drift[v].z, 0.5]] as [number, number, number][]),
]
type Cell = { x: number; z: number; h: number; near: NodeId; dDecoy: number; dReg: number; dThreat: number; dRoute: number }

/** Height = significance · brightness = activity · glow = alert/verification. Ripples travel cell by cell (radii quantised to the cell pitch). */
function HexField({ phase, focus, rstep, paused, trace, mode }: { phase: number; focus: (id: NodeId) => boolean; rstep: number | null; paused: boolean; trace: boolean; mode: ViewMode }) {
  const body = useRef<THREE.InstancedMesh>(null)
  const cap = useRef<THREE.InstancedMesh>(null)
  const m = useMemo(() => new THREE.Object3D(), [])
  const geo = useMemo(() => new THREE.CylinderGeometry(CELL * 0.9, CELL * 0.94, 1, 6).translate(0, 0.5, 0), [])
  const cells = useMemo(() => {
    const out: Cell[] = []
    const others = NODES.filter((n) => n.id !== 'threat')
    for (let q = -34; q <= 34; q++) for (let r = -34; r <= 34; r++) {
      const x = SQ3 * CELL * (q + r / 2), z = 1.5 * CELL * r
      const rad = Math.hypot(x, z)
      if (rad > FIELD) continue
      if (Math.hypot(x - byId.threat.x, z - byId.threat.z) < 1.15) continue
      let near: NodeId = 'core', best = 1e9, sig = 0, blocked = false
      for (const n of others) {
        const d = Math.hypot(x - n.x, z - n.z), R = padRadius(n.id)
        if (d < R + 0.15) blocked = true
        if (d - R < best) { best = d - R; near = n.id }
        sig = Math.max(sig, (SIG[n.id] ?? 0.3) * Math.exp(-Math.max(0, d - R) / 2.0))
      }
      if (blocked || CLEAR.some(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) < cr)) continue
      const k = hash(q * 1.7, r * 2.3)
      // topographic base: low rolling relief, rising toward significant structures, settling at the rim
      const relief = 0.5 + 0.3 * Math.sin(x * 0.33 + 1.2) * Math.cos(z * 0.29 - 0.4) + 0.2 * Math.sin((x + z) * 0.61)
      const rim = 1 - 0.55 * c01((rad - BORDER) / (FIELD - BORDER))
      let h = (0.05 + relief * 0.32 + sig * 0.6 * (0.55 + 0.45 * k)) * rim + k * 0.04
      if (sig > 0.3 && hash(q, r) > 0.975) h += 0.6 + k * 0.7 // a few tall relay structures
      out.push({ x, z, h, near, dDecoy: Math.hypot(x - byId.decoy.x, z - byId.decoy.z), dReg: Math.hypot(x - byId.registry.x, z - byId.registry.z), dThreat: Math.hypot(x - byId.threat.x, z - byId.threat.z), dRoute: segDist(x, z, byId.decoy.x, byId.decoy.z, byId.threat.x, byId.threat.z) })
    }
    return out
  }, [])
  const lt = useRef(0)
  const key = useRef('')
  const lift = useMemo(() => new Float32Array(cells.length), [cells])
  const glow = useMemo(() => new Float32Array(cells.length), [cells])
  const col = useMemo(() => new THREE.Color(), [])
  const BODY = useMemo(() => new THREE.Color('#16171c'), [])
  const WARM = useMemo(() => new THREE.Color('#3b2d0a'), [])
  const HON = useMemo(() => new THREE.Color(C.honey), [])
  const AMB = useMemo(() => new THREE.Color(C.amber), [])
  const EDGE = useMemo(() => new THREE.Color('#F2EFE6'), [])

  useFrame((st, dt) => {
    const k = `${rstep}|${trace}|${mode}`
    if (k !== key.current) { key.current = k; lt.current = 0 }
    if (!paused) lt.current += dt
    const t = lt.current, b = body.current!, c = cap.current!
    const pitch = SQ3 * CELL
    const q = (R: number) => Math.floor(R / pitch) * pitch
    // outward detection wave: a crest that lights cells as it passes and fades behind itself
    const ring = (d: number, R: number, reach: number) => R <= 0 || R > reach ? 0 : gauss(d - q(R), 0.55) * (1 - R / reach) + (d < q(R) ? 0.16 * gauss(q(R) - d, 1.8) * (1 - R / reach) : 0)
    // three concentric rings, one behind the other
    const wave = (d: number, R: number, reach: number) => Math.max(ring(d, R, reach), 0.7 * ring(d, R - 2.6, reach), 0.45 * ring(d, R - 5.2, reach))
    cells.forEach((cl, i) => {
      const lit = byId[cl.near].phase <= phase && focus(cl.near)
      let g = lit ? 0.05 : 0.012, up = 0, amber = 0, crest = 0
      if (rstep === 1) { const w = gauss(cl.dDecoy - 3.2, 1.2) * (1 - c01(t / 2.2)); g += w * 0.3 }
      // tightening ripple — only once QuorumReceiver has accepted the verified report
      if (rstep === 4) { const R = t * 6, w = wave(cl.dDecoy, R, 30); g += w * 0.9; up += w * 0.45; crest = ring(cl.dDecoy, R, 30) }
      // Patrol sweep — a faint inspection beam rotating over the hive
      const pa = Math.atan2(cl.z, cl.x), sw = (st.clock.elapsedTime * 0.32) % (Math.PI * 2) - Math.PI
      const da = Math.abs(((pa - sw + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
      if (!trace) { const p = gauss(da, 0.07) * 0.06; g += p; crest = Math.max(crest, p * 4) }
      if (rstep === 0) { const w = wave(cl.dThreat, t * 4, 9); g += w * 0.35 }
      if (rstep === 6) { const w = wave(cl.dReg, t * 8, 30); g += w * 0.7; up += w * 0.3 }
      if (rstep === null && mode === 'net') { const w = wave(cl.dReg, (t % 4.5) * 7, 30); g += w * 0.35; up += w * 0.15 }
      if (trace) {
        // inward collapse toward the origin, then everything unrelated recedes and the verified corridor brightens
        if (t < TRACE_OUT + 0.6) {
          // detection: rings expand from the attack hex
          const R = t * 9, w = wave(cl.dDecoy, R, 30)
          g += w * 0.9; up += w * 0.4; crest = ring(cl.dDecoy, R, 30)
        }
        // narrowing: rings contract toward the source, tighter and brighter as they converge
        const ti = t - TRACE_OUT
        const inR = (j: number) => 30 * (1 - ease((ti - j * 0.45) / 3.0))
        const inw = (j: number) => (ti - j * 0.45 <= 0 || ti - j * 0.45 > 3.1 ? 0 : gauss(cl.dThreat - q(inR(j)), 0.35 + inR(j) * 0.02) * (0.5 + 0.7 * (1 - inR(j) / 30)))
        const w = Math.max(inw(0), 0.75 * inw(1), 0.55 * inw(2))
        const corridor = gauss(cl.dRoute, 0.8) * ease((t - TRACE_VERIFY) / 0.8)
        const core = gauss(cl.dThreat, 1.4) * ease((ti - 2.8) / 0.8)
        const quiet = 1 - 0.8 * ease((ti - 0.4) / 2)
        g = g * quiet + w * 0.85 + corridor * 0.6 + core * 0.5
        up += w * 0.38 + corridor * 0.16 + core * 0.3
        crest = Math.max(crest, w * 0.8)
      }
      lift[i] += (up - lift[i]) * Math.min(1, dt * 10)
      glow[i] += (g - glow[i]) * Math.min(1, dt * 9)
      const h = cl.h + lift[i]
      m.position.set(cl.x, PLINTH, cl.z); m.rotation.set(0, 0, 0); m.scale.set(1, h, 1); m.updateMatrix(); b.setMatrixAt(i, m.matrix)
      b.setColorAt(i, col.copy(BODY).lerp(WARM, Math.min(1, glow[i] * 1.2)))
      m.position.set(cl.x, PLINTH + h + 0.004, cl.z); m.rotation.set(-Math.PI / 2, 0, 0); m.scale.set(1, 1, 1); m.updateMatrix(); c.setMatrixAt(i, m.matrix)
      c.setColorAt(i, col.copy(HON).lerp(AMB, amber).lerp(EDGE, Math.min(1, crest * 0.75)).multiplyScalar(glow[i]))
    })
    b.instanceMatrix.needsUpdate = true; c.instanceMatrix.needsUpdate = true
    if (b.instanceColor) b.instanceColor.needsUpdate = true
    if (c.instanceColor) c.instanceColor.needsUpdate = true
  })
  return (
    <group>
      <instancedMesh ref={body} args={[geo, undefined, cells.length]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.62} metalness={0.45} flatShading />
      </instancedMesh>
      <instancedMesh ref={cap} args={[undefined, undefined, cells.length]}>
        <ringGeometry args={[CELL * 0.72, CELL * 0.86, 6, 1, Math.PI / 2]} />
        <meshBasicMaterial toneMapped={false} blending={THREE.AdditiveBlending} transparent depthWrite={false} />
      </instancedMesh>
    </group>
  )
}

/** Trace Origin — candidate routes from the decoy back to possible sources: suspicious (dim dotted) → candidate (dashed) → rejected (fade) / verified (solid honey) */
function TraceFX({ active, paused, onRoute }: { active: boolean; paused: boolean; onRoute?: () => void }) {
  const lt = useRef(0)
  const [stage, setStage] = useState(0)
  const mats = useRef<({ opacity: number } | null)[]>([])
  const marks = useRef<(THREE.Group | null)[]>([])
  const curves = useMemo(() => ORIGINS.map(([x, z]) => arcOf(at('decoy'), new THREE.Vector3(x, x === byId.threat.x ? 1.6 : 0.7, z), 0.1).getPoints(48)), [])
  useLayoutEffect(() => { lt.current = 0; setStage(0) }, [active])
  useFrame((_, dt) => {
    if (!active) return
    if (!paused) lt.current += dt
    const t = lt.current
    const s = t >= TRACE_VERIFY ? 2 : t >= TRACE_OUT + 1.4 ? 1 : 0
    if (s !== stage) setStage(s)
    ORIGINS.forEach((_, i) => {
      const mat = mats.current[i]
      const fade = i === 0 ? 1 : 1 - c01((t - TRACE_REJECT[i - 1]) / 0.5)
      const base = s === 0 ? 0.28 : s === 1 ? 0.6 : i === 0 ? 1 : 0.6
      if (mat) mat.opacity = base * fade * c01((t - TRACE_OUT) / 0.6)
      const g = marks.current[i]
      if (g) { g.visible = fade > 0.02; g.scale.setScalar(0.6 + fade * 0.4) }
    })
  })
  if (!active) return null
  return (
    <group>
      {curves.map((pts, i) => {
        const verified = i === 0 && stage === 2
        return (
          <group key={i}>
            <Line key={`${i}-${stage}`} ref={(l) => { mats.current[i] = (l?.material as unknown as { opacity: number }) ?? null }} points={pts} transparent opacity={0}
              color={verified ? C.honey : stage === 1 ? '#ECE9E0' : '#7d7a72'} lineWidth={verified ? 3.4 : stage === 1 ? 1.6 : 1.1}
              onClick={i === 0 && onRoute ? (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onRoute() } : undefined}
              onPointerOver={i === 0 ? () => { document.body.style.cursor = 'pointer' } : undefined} onPointerOut={i === 0 ? () => { document.body.style.cursor = '' } : undefined}
              dashed={!verified} dashSize={stage === 0 ? 0.08 : 0.4} gapSize={stage === 0 ? 0.3 : 0.22} toneMapped={false} />
            {i > 0 && (
              <group ref={(g) => { marks.current[i] = g }} position={[ORIGINS[i][0], PLINTH, ORIGINS[i][1]]}>
                <FlatRing r={0.5} w={0.03} y={0.6} k={0.4} color="#ECE9E0" />
              </group>
            )}
          </group>
        )
      })}
    </group>
  )
}

/** Subtle camera only: tighten toward the source during trace, widen slightly for propagation, otherwise hold */
function CameraDirector({ trace, mode }: { trace: boolean; mode: ViewMode }) {
  const { camera } = useThree()
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null
  const settle = useRef(0)
  const key = `${trace}|${mode}`
  const last = useRef(key)
  const goal = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, dt) => {
    if (last.current !== key) { last.current = key; settle.current = 1.8 }
    const cam = camera as THREE.PerspectiveCamera
    const k = Math.min(1, dt * 0.9)
    if (trace) {
      goal.set(byId.threat.x * 0.42, 0, byId.threat.z * 0.42)
      cam.zoom += (1.2 - cam.zoom) * k; cam.updateProjectionMatrix()
      controls?.target.lerp(goal, k)
      return
    }
    if (settle.current <= 0) return
    settle.current -= dt
    const z = mode === 'net' ? 0.88 : 1
    cam.zoom += (z - cam.zoom) * Math.min(1, dt * 2); cam.updateProjectionMatrix()
    controls?.target.lerp(goal.set(0, 0, 0), Math.min(1, dt * 2))
  })
  return null
}

/* ---------- world ---------- */
export type ViewMode = 'live' | 'trace' | 'arch' | 'net'
type SceneProps = { phase: number; focus: NodeId[] | null; mode?: ViewMode; selected: NodeId | null; onSelect: (id: NodeId | null) => void; replay?: { step: number; paused: boolean } | null; tags?: Partial<Record<NodeId, string>>; drag?: 'orbit' | 'pan'; trace?: { paused: boolean; found: boolean } | null; onRoute?: () => void; onPick?: (id: MapId) => void; picked?: string | null }

function World({ phase, focus: fx, selected, onSelect, hover, setHover, replay, trace, mode = 'live', onRoute, onPick, picked, mhover, setMhover, mtext }: SceneProps & { hover: NodeId | null; setHover: (id: NodeId | null) => void; mhover: string | null; setMhover: (id: string | null) => void; mtext: React.RefObject<Partial<Record<MapId, HTMLSpanElement | null>>> }) {
  const t = useRef(0)
  const [armed, setArmed] = useState<VId[]>([])
  const rstep = replay?.step ?? null
  useLayoutEffect(() => { setArmed([]) }, [rstep])
  const vaultOn = (id: VId) => (rstep === 4 ? armed.includes(id) : phase >= 5)
  useFrame((_, dt) => { t.current += dt })
  const focus = useMemo(() => (id: NodeId) => !fx || fx.includes(id), [fx])
  const on = (n: HiveNode) => n.phase <= phase

  const handlers = (id: NodeId) => ({
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHover(id); document.body.style.cursor = 'pointer' },
    onPointerOut: () => { setHover(null); document.body.style.cursor = '' },
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(id) },
  })

  return (
    <>
      <Terrain phase={phase} focus={focus} />
      <HexField phase={phase} focus={focus} rstep={rstep} paused={!!replay?.paused || !!trace?.paused} trace={!!trace} mode={mode} />
      <TraceFX active={!!trace} paused={!!trace?.paused} onRoute={onRoute} />
      {!trace && <SystemMap phase={phase} rstep={rstep} mode={mode} hover={mhover} setHover={setMhover} selected={picked ?? null} onPick={(id) => onPick?.(id)} text={mtext}
        hotDrained={rstep === 4 ? armed.includes('hot') : rstep !== null ? rstep > 4 : phase >= 5} />}
      {phase >= 2 && <AttackMark t={t} onClick={() => onSelect('threat')} />}
      <CameraDirector trace={!!trace} mode={mode} />

      {NODES.map((n) => {
        const engaged = on(n)
        const isSel = selected === n.id || hover === n.id
        return (
          <group key={n.id} position={[n.x, baseY(n), n.z]} {...handlers(n.id)}>
            <Lift up={hover === n.id || selected === n.id} k={n.id === 'decoy' && (rstep === 1 || rstep === 2 || !!trace) ? 0.7 : 0.22}>
            {n.id === 'core' && <Core on={engaged && focus('core')} />}
            {n.id === 'exA' && <Exchange on={engaged && focus('exA')} incident />}
            {n.id === 'receiver' && <Receiver on={engaged && focus('receiver')} />}
            {n.id === 'registry' && <Registry on={engaged && focus('registry')} />}
            {n.id === 'exB' && <Exchange on={engaged && focus('exB')} />}
            {n.id === 'decoy' && <Decoy on={engaged && focus('decoy')} />}
            {(n.id === 'hot' || n.id === 'warm' || n.id === 'cold') && <Vault id={n.id} on={vaultOn(n.id) && focus(n.id)} dir={[n.x, n.z]} t={t} />}
            {n.id === 'threat' && <Threat t={t} found={!!trace?.found || (rstep !== null && rstep >= 2)} />}
            {n.id === 'board' && <Board />}
            </Lift>
            {isSel && <FlatRing r={padRadius(n.id) - 0.08} w={0.05} y={0.012} k={0.9} color={C.cream} />}
          </group>
        )
      })}

      {EDGES.map((e, i) => {
        const focused = !!fx && focus(e.from) && focus(e.to)
        return <Route key={i} from={byId[e.from]} to={byId[e.to]} kind={e.kind} live={e.phase <= phase && !trace} focused={focused && !trace} dimmed={!!trace || (!!fx && !focused)} />
      })}
      <ReplayFX step={rstep} paused={!!replay?.paused} phase={phase} onArm={(id) => setArmed((a) => [...a, id])} />
    </>
  )
}

/** Label density per view mode: only the story's primary structures are always labelled */
function visible(id: NodeId, mode: ViewMode) {
  if (mode === 'arch') return id !== 'threat'
  if (mode === 'net') return id === 'registry' || id === 'exA' || id === 'exB'
  if (mode === 'trace') return id === 'decoy' || id === 'threat'
  return id === 'exA' || id === 'decoy' || id === 'core' || id === 'hot' || id === 'registry' || id === 'exB'
}

export default function HiveScene(props: SceneProps) {
  const mode = props.mode ?? 'live'
  const [hover, setHover] = useState<NodeId | null>(null)
  const labels: LabelRefs = useRef({})
  const [mhover, setMhover] = useState<string | null>(null)
  const mtext = useRef<Partial<Record<MapId, HTMLSpanElement | null>>>({})
  const mrefs = useRef<Partial<Record<MapId, HTMLDivElement | null>>>({})
  const focus = (id: NodeId) => !props.focus || props.focus.includes(id)
  return (
    <div className="relative w-full h-full">
    <Canvas shadows dpr={[1, 2]} gl={{ antialias: true }} onPointerMissed={() => props.onSelect(null)}>
      <color attach="background" args={[C.ink]} />
      <fog attach="fog" args={[C.ink, 70, 125]} />
      <PerspectiveCamera makeDefault position={[30, 40, 30]} fov={34} near={1} far={400} />
      <OrbitControls makeDefault target={[0, 0, 0]} enableDamping minDistance={22} maxDistance={120} minPolarAngle={0} maxPolarAngle={Math.PI} enablePan screenSpacePanning panSpeed={1} rotateSpeed={0.7}
        mouseButtons={{ LEFT: props.drag === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: props.drag === 'pan' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN }}
        touches={{ ONE: props.drag === 'pan' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
      <Frame />
      <ambientLight intensity={0.22} color={C.cream} />
      <hemisphereLight args={['#fff6e0', C.ink, 0.28]} />
      <directionalLight position={[18, 30, 12]} intensity={1.05} color="#FFF3DA" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30} />
      {/* rim light from behind — picks out bevels on the dark metal */}
      <directionalLight position={[-26, 14, -30]} intensity={0.55} color={C.amber} />
      <Environment resolution={64} frames={1}>
        <Lightformer form="rect" intensity={0.6} color="#fff3da" position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[30, 30, 1]} />
        <Lightformer form="rect" intensity={0.35} color={C.amber} position={[-18, 4, -18]} scale={[20, 4, 1]} />
      </Environment>
      <World {...props} hover={hover} setHover={setHover} mhover={mhover} setMhover={setMhover} mtext={mtext} />
      <MarkProjector refs={mrefs} />
      <Projector labels={labels} />
      <EffectComposer>
        <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.82} luminanceSmoothing={0.15} />
        <Vignette offset={0.25} darkness={0.75} />
      </EffectComposer>
    </Canvas>
      <div className={`pointer-events-none absolute inset-0 overflow-hidden ${hover || props.selected || mhover ? 'z-[45]' : 'z-10'} [&>div]:pointer-events-auto`}>
        {NODES.map((n) => (
          <NodeLabel key={n.id} n={n} on={n.phase <= props.phase} open={props.selected === n.id || hover === n.id} dim={!focus(n.id) || (mode === 'live' && !props.replay && !props.tags?.[n.id] && props.selected !== n.id && hover !== n.id)}
            tag={props.tags?.[n.id]}
            hidden={!(props.selected === n.id || hover === n.id || visible(n.id, mode) || props.tags?.[n.id])} name={n.id === 'hot' && mode !== 'arch' && !props.replay ? 'Vault Cluster' : n.id === 'decoy' && mode === 'live' && !props.replay ? 'Decoy Zone' : n.id === 'exB' && mode === 'live' && !props.replay ? 'Bitget · Members' : n.id === 'core' && mode === 'arch' ? 'CRE · Cosign / Trap / Patrol' : n.name}
            onClick={() => props.onSelect(n.id)} onHover={(h) => setHover(h ? n.id : null)} elRef={(el) => { labels.current![n.id] = el }} />
        ))}
        {!props.trace && MARKS.map((m) => {
          const show = m.modes.includes(mode) || mhover === m.id || props.picked === m.id || (mhover?.startsWith('gate') && m.id === 'wf-cosign')
          const tone = { grey: 'text-dim border-white/10', honey: 'text-honey border-honey/30', amber: 'text-amber border-amber/50', red: 'text-[#FF7A7E] border-[#E5484D]/60' }[m.tone]
          return (
            <div key={m.id} ref={(el) => { mrefs.current[m.id] = el }} className="absolute left-0 top-0 will-change-transform" style={{ opacity: show ? 1 : 0, pointerEvents: show ? undefined : 'none', transition: 'opacity .3s' }}>
              <button onClick={() => props.onPick?.(m.id)} onMouseEnter={() => setMhover(m.id)} onMouseLeave={() => setMhover(null)}
                className={`rounded border bg-ink/80 backdrop-blur-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider whitespace-pre text-left leading-tight ${tone} ${props.picked === m.id ? '!border-cream/70' : ''}`}>
                <span ref={(el) => { mtext.current[m.id] = el }}>{m.text}</span>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

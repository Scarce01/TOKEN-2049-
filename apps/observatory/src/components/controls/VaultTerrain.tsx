import { Edges, OrbitControls } from "@react-three/drei"
import { Canvas, useFrame } from "@react-three/fiber"
import { useRef, type ReactNode, type RefObject } from "react"
import { Vector3 } from "three"
import { RED } from "../ui"

// 3D vault view for the Controls desk: one hex island per exchange carrying the Quorum vault building
// (hexmap.html makeVaultBuilding: stacked hot / warm / cold hex tiers, slits, fins, gold bands, cap and mast).
// Each tier shows its own vault: slit glow = quota left, red slits = quota zeroed, ice shell = frozen.
// frameloop "demand": the scene only redraws when chain data or the camera changes (only real events move).
// Labels are plain DOM over the canvas, moved by projecting their 3D anchors each rendered frame
// (drei <Html> opens one React root per label, which StrictMode unmounts mid-render and drops labels).

export type Tier = "hot" | "warm" | "cold"
export type Column = { key: string; tier: Tier; fill: number; frozen: boolean; label: string; value: string }
export type Island = { org: string; name: string; alert: number; columns: Column[] }
/** align: which edge of the label sits on the anchor */
type Anchor = { id: string; at: [number, number, number]; node: ReactNode; align?: "left" | "right" | "center" }
const SHIFT = { left: "0", right: "-100%", center: "-50%" }

const at = (q: number, r: number): [number, number] => [Math.sqrt(3) * (q + r / 2), 1.5 * r]
const TILES: [number, number][] = []
for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) if (Math.abs(q + r) <= 3) TILES.push([q, r])
const seed = (q: number, r: number) => ((q * 92821) ^ (r * 68917)) & 7
const tileH = (q: number, r: number) => 0.18 + seed(q, r) * 0.025
const SPACING = 13
const SCALE = 1.7
const GOLD = "#b98d3c"
const ICE = "#9fd8ff"
const alertColor = (a: number) => (a >= 4 ? RED : a > 0 ? "#fcad17" : "#9a9488")

// makeVaultBuilding tiers, bottom to top, in model units
const TIERS: { tier: Tier; r: number; rb: number; h: number; c: string }[] = [
  { tier: "hot", r: 1.55, rb: 1.78, h: 1.15, c: "#34353a" },
  { tier: "warm", r: 1.02, rb: 1.24, h: 0.85, c: "#303136" },
  { tier: "cold", r: 0.6, rb: 0.8, h: 0.72, c: "#2b2c30" },
]
const TIER_Y = TIERS.reduce<number[]>((ys, t, i) => [...ys, i ? ys[i - 1] + TIERS[i - 1].h + 0.06 : 0], [])
const TOP = TIER_Y[2] + TIERS[2].h
const BASE = tileH(0, 0)

function TierMesh({ i, c, selected, onSelect }: { i: number; c?: Column; selected: boolean; onSelect: (key: string) => void }) {
  const t = TIERS[i]
  const fill = c?.fill ?? 0
  const zeroed = c && t.tier !== "cold" && fill <= 0
  const slit = zeroed ? RED : "#ffb43a"
  const glow = zeroed ? 0.9 : 0.12 + fill * 0.9
  const rr = ((t.r + t.rb) / 2) * 0.9
  return (
    <group
      position={[0, TIER_Y[i], 0]}
      rotation={[0, (Math.PI / 6) * (i % 2 ? -1 : 1), 0]}
      onClick={(e) => { e.stopPropagation(); if (c) onSelect(c.key) }}
      onPointerOver={() => { document.body.style.cursor = "pointer" }}
      onPointerOut={() => { document.body.style.cursor = "" }}
    >
      <mesh position={[0, t.h / 2, 0]}>
        <cylinderGeometry args={[t.r, t.rb, t.h, 6]} />
        <meshStandardMaterial color={t.c} metalness={0.35} roughness={0.55} />
      </mesh>
      {Array.from({ length: 6 }, (_, k) => {
        const a = (k * Math.PI) / 3 + Math.PI / 6
        return (
          <mesh key={`s${k}`} position={[Math.cos(a) * rr, t.h * 0.5, Math.sin(a) * rr]} rotation={[0, -a + Math.PI / 2, 0]}>
            <boxGeometry args={[t.r * 0.42, t.h * 0.42, 0.02]} />
            <meshStandardMaterial color="#1a1a1d" emissive={slit} emissiveIntensity={glow} />
          </mesh>
        )
      })}
      {Array.from({ length: 6 }, (_, k) => {
        const a = (k * Math.PI) / 3
        const fr = ((t.r + t.rb) / 2) * 0.98
        return (
          <mesh key={`f${k}`} position={[Math.cos(a) * fr, t.h * 0.5, Math.sin(a) * fr]} rotation={[0, -a, 0]}>
            <boxGeometry args={[0.14, t.h * 0.96, 0.07]} />
            <meshStandardMaterial color={k % 2 ? "#2a2a2e" : GOLD} metalness={k % 2 ? 0.35 : 0.85} roughness={k % 2 ? 0.55 : 0.32} />
          </mesh>
        )
      })}
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[t.rb + 0.06, t.rb + 0.1, 0.08, 6]} />
        <meshStandardMaterial color="#1f1f23" />
      </mesh>
      <mesh position={[0, t.h, 0]} rotation={[Math.PI / 2, 0, Math.PI / 6]}>
        <torusGeometry args={[t.r + 0.03, selected ? 0.07 : 0.045, 4, 6]} />
        <meshStandardMaterial color={GOLD} metalness={0.85} roughness={0.32} emissive="#ffb43a" emissiveIntensity={selected ? 1.4 : 0.3} />
      </mesh>
      {c?.frozen && (
        <mesh position={[0, t.h / 2, 0]}>
          <cylinderGeometry args={[t.r + 0.22, t.rb + 0.22, t.h + 0.1, 6]} />
          <meshStandardMaterial color={ICE} transparent opacity={0.16} depthWrite={false} />
          <Edges color={ICE} />
        </mesh>
      )}
    </group>
  )
}

function VaultBuilding({ island, selected, onSelect }: { island: Island; selected: string | null; onSelect: (key: string) => void }) {
  return (
    <group position={[0, BASE, 0]} scale={SCALE}>
      {TIERS.map((t, i) => {
        const c = island.columns.find((x) => x.tier === t.tier)
        return <TierMesh key={t.tier} i={i} c={c} selected={!!c && selected === c.key} onSelect={onSelect} />
      })}
      <mesh position={[0, TOP + 0.2, 0]}>
        <cylinderGeometry args={[0, 0.42, 0.4, 6]} />
        <meshStandardMaterial color={GOLD} metalness={0.85} roughness={0.32} />
      </mesh>
      <mesh position={[0, TOP + 0.75, 0]}>
        <cylinderGeometry args={[0.02, 0.03, 0.9, 5]} />
        <meshStandardMaterial color={GOLD} metalness={0.85} roughness={0.32} />
      </mesh>
      <mesh position={[0, TOP + 1.22, 0]}>
        <sphereGeometry args={[0.05, 8, 6]} />
        <meshBasicMaterial color={island.alert >= 4 ? RED : "#ffc45a"} toneMapped={false} />
      </mesh>
    </group>
  )
}

function IslandMesh({ island, x, selected, onSelect }: { island: Island; x: number; selected: string | null; onSelect: (key: string) => void }) {
  return (
    <group position={[x, 0, 0]}>
      {TILES.map(([q, r]) => {
        const h = tileH(q, r)
        const [tx, tz] = at(q, r)
        return (
          <mesh key={`${q}:${r}`} position={[tx, h / 2, tz]}>
            <cylinderGeometry args={[0.95, 0.95, h, 6]} />
            <meshStandardMaterial color={seed(q, r) % 2 ? "#24262b" : "#1d1f24"} roughness={0.9} />
          </mesh>
        )
      })}
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 6]} position={[0, 0.02, 0]}>
        <ringGeometry args={[6.3, 6.55, 6]} />
        <meshBasicMaterial color={island.alert > 0 ? alertColor(island.alert) : "#3a372c"} transparent opacity={island.alert > 0 ? 0.85 : 0.5} />
      </mesh>
      <VaultBuilding island={island} selected={selected} onSelect={onSelect} />
    </group>
  )
}

/** ThreatRegistry between the islands: one red disc per active confirmed entry (capped at 8). */
function Registry({ active }: { active: number }) {
  return (
    <group>
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.45, 0.6, 1.2, 6]} />
        <meshStandardMaterial color="#191b20" roughness={0.8} />
        <Edges color="#4a463c" />
      </mesh>
      {Array.from({ length: Math.min(active, 8) }, (_, i) => (
        <mesh key={i} position={[0, 1.35 + i * 0.22, 0]}>
          <cylinderGeometry args={[0.38, 0.38, 0.12, 6]} />
          <meshStandardMaterial color={RED} emissive={RED} emissiveIntensity={0.5} />
        </mesh>
      ))}
    </group>
  )
}

/** Moves each label to its anchor's screen position; runs only on frames the canvas actually renders. */
function Project({ anchors, els }: { anchors: Anchor[]; els: RefObject<Record<string, HTMLDivElement | null>> }) {
  const v = useRef(new Vector3())
  useFrame(({ camera, size }) => {
    for (const a of anchors) {
      const el = els.current[a.id]
      if (!el) continue
      v.current.set(...a.at).project(camera)
      el.style.transform = `translate(${((v.current.x + 1) / 2) * size.width}px, ${((1 - v.current.y) / 2) * size.height}px) translate(${SHIFT[a.align ?? "left"]}, -50%)`
      el.style.visibility = v.current.z > 1 ? "hidden" : "visible"
    }
  })
  return null
}

export default function VaultTerrain({ islands, active, selected, onSelect }: { islands: Island[]; active: number; selected: string | null; onSelect: (key: string) => void }) {
  const els = useRef<Record<string, HTMLDivElement | null>>({})
  const n = islands.length
  const ix = (i: number) => (i - (n - 1) / 2) * SPACING
  const chip = "whitespace-nowrap rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] leading-tight"
  const anchors: Anchor[] = islands.flatMap((isl, i) => [
    // tier labels hang off the building's inner side (toward the registry), at each tier's mid height
    ...isl.columns.map((c): Anchor => {
      const side = ix(i) > 0 ? -1 : 1
      const k = TIERS.findIndex((t) => t.tier === c.tier)
      const t = TIERS[k]
      const zeroed = c.tier !== "cold" && c.fill <= 0
      return {
        id: c.key,
        at: [ix(i) + side * (t.rb + 0.35) * SCALE, BASE + (TIER_Y[k] + t.h / 2) * SCALE, 0],
        align: side > 0 ? "left" : "right",
        node: (
          <button
            onClick={() => onSelect(c.key)}
            className={`pointer-events-auto ${chip} text-left ${selected === c.key ? "border-honey bg-ink/90 text-cream" : "border-white/10 bg-ink/75 text-dim hover:text-cream"}`}
          >
            <span className="font-semibold tracking-wider">{c.label}</span>
            {c.frozen && <span style={{ color: ICE }}> · FROZEN</span>}
            <span className={`ml-1.5 ${zeroed ? "text-[#E5484D]" : "text-cream"}`}>{c.value}</span>
          </button>
        ),
      }
    }),
    {
      id: `${isl.org}:name`,
      at: [ix(i), 0.3, 7.1],
      align: "center",
      node: (
        <div className="whitespace-nowrap font-mono text-[11px] tracking-wider text-dim">
          {isl.name.toUpperCase()} · <span style={{ color: alertColor(isl.alert) }}>{["NORMAL", "L1", "L2", "L3", "CONFIRMED"][isl.alert] ?? "NORMAL"}</span>
        </div>
      ),
    },
  ])
  if (n > 1)
    anchors.push({
      id: "registry",
      at: [0, 0.1, 3.2],
      align: "center",
      node: (
        <div className={`${chip} border-white/10 bg-ink/75 text-dim`}>
          REGISTRY · <span className={active ? "text-[#E5484D]" : "text-cream"}>{active} active</span>
        </div>
      ),
    })
  return (
    <div className="absolute inset-0">
      <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [0, 8.5, 15.5], fov: 38 }}>
        <color attach="background" args={["#0f1115"]} />
        <fog attach="fog" args={["#0f1115", 28, 56]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[6, 14, 8]} intensity={1.2} />
        <directionalLight position={[-8, 6, -6]} intensity={0.35} color="#ffc700" />
        {islands.map((isl, i) => (
          <IslandMesh key={isl.org} island={isl} x={ix(i)} selected={selected} onSelect={onSelect} />
        ))}
        {n > 1 && <Registry active={active} />}
        <Project anchors={anchors} els={els} />
        <OrbitControls makeDefault target={[0, 2.4, 0]} enablePan={false} enableDamping={false} minDistance={10} maxDistance={44} maxPolarAngle={1.4} />
      </Canvas>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {anchors.map((a) => (
          <div key={a.id} ref={(el) => { els.current[a.id] = el }} className="absolute left-0 top-0" style={{ visibility: "hidden" }}>
            {a.node}
          </div>
        ))}
      </div>
    </div>
  )
}

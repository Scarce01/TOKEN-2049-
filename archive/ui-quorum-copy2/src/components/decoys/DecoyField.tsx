import { useEffect, useMemo, useRef } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Line, OrbitControls } from "@react-three/drei"
import Html from "../SceneHtml"
import * as THREE from "three"
import { HONEY_FRAG, HONEY_VERT } from "../World"
import { AGENCIES, CORE, DECOYS, type Agency, type FieldDecoy } from "./data"

/* 3D colors are read from the design-system CSS variables so the scene follows theme edits */
function readTokens() {
  const css = getComputedStyle(document.documentElement)
  const get = (name: string, fallback: string) => new THREE.Color(css.getPropertyValue(name).trim() || fallback)
  return {
    honey: get("--color-honey", "#ffc700"),
    amber: get("--color-amber", "#fcad17"),
    gold: get("--color-gold", "#d6a61f"),
    cream: get("--color-cream", "#fff1c1"),
    alarm: get("--color-alarm", "#e5484d"),
    mute: get("--color-mute", "#6a665e"),
    ink: get("--color-ink", "#0b0d10"),
  }
}
type Tokens = ReturnType<typeof readTokens>

export const LOOP = 11
const ORIGIN = DECOYS.find((d) => d.state === "Triggered")!
const ORIGIN_AGENCY = AGENCIES.find((a) => a.id === ORIGIN.agency)!
const RECEIVERS = AGENCIES.filter((a) => a.protected && a.id !== ORIGIN_AGENCY.id)
const T = { flash: 0, ripple: 0.4, toLocal: 1.2, toCore: 2.2, fanout: 3.6, ack: 5.2 }

const RIVERS: ((x: number, z: number) => number)[] = [
  (x, z) => Math.abs(x - Math.sin(z * 0.3) * 2.5 - 3.5),
  (x, z) => Math.abs(z - (-1.8 + Math.sin(x * 0.25) * 1.8)),
  (x, z) => Math.abs(x + z * 0.4 - 14),
  (x, z) => Math.abs(x - z * 0.5 + 13.5),
  (x, z) => Math.abs(z - 9 - Math.cos(x * 0.3) * 1.2),
]
const STONE = ["#8d8074", "#887a6d", "#918376", "#84786c", "#8b7c6e", "#8f8278"]
const hash = (x: number, z: number) => {
  const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453
  return v - Math.floor(v)
}
const RADIUS = 34

function hexPrism(radius: number) {
  const geometry = new THREE.CylinderGeometry(radius, radius, 1, 6)
  geometry.translate(0, 0.5, 0)
  return geometry
}

function Ground() {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const geometry = useMemo(() => hexPrism(0.5), [])
  const cells = useMemo(() => {
    const out: { x: number; z: number; h: number; c: THREE.Color }[] = []
    const anchors = [...AGENCIES.map((a) => [a.x, a.z, 3.6]), [CORE[0], CORE[1], 3.2]]
    for (let row = -44; row <= 44; row++)
      for (let col = -40; col <= 40; col++) {
        const x = Math.sqrt(3) * 0.5 * (col + (row & 1) / 2), z = row * 0.75
        if (Math.hypot(x, z) > RADIUS) continue
        const land = anchors.some(([ax, az, r]) => Math.hypot(x - ax, z - az) < r)
        const river = Math.min(...RIVERS.map((fn) => fn(x, z)))
        const bridge = Math.abs((((x * 0.7 + z + 4) % 13) + 13) % 13 - 6.5) < 0.8
        if (river < 0.75 && !land && !bridge) continue
        const c = new THREE.Color(STONE[Math.floor(hash(col, row) * STONE.length)])
        if (river < 1.4) c.lerp(new THREE.Color("#77706a"), 0.5)
        c.multiplyScalar(0.9 + hash(row, col) * 0.14)
        out.push({ x, z, h: 0.32 + hash(col * 3, row) * 0.05 + 0.03 * Math.sin(x * 0.5) * Math.cos(z * 0.6), c })
      }
    return out
  }, [])
  useEffect(() => {
    const dummy = new THREE.Object3D()
    cells.forEach((cell, i) => {
      dummy.position.set(cell.x, 0, cell.z)
      dummy.scale.set(0.96, cell.h, 0.96)
      dummy.updateMatrix()
      mesh.current!.setMatrixAt(i, dummy.matrix)
      mesh.current!.setColorAt(i, cell.c)
    })
    mesh.current!.instanceMatrix.needsUpdate = true
    if (mesh.current!.instanceColor) mesh.current!.instanceColor.needsUpdate = true
    return () => geometry.dispose()
  }, [cells, geometry])
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, cells.length]} receiveShadow castShadow>
      <meshStandardMaterial roughness={0.82} metalness={0.04} />
    </instancedMesh>
  )
}

function Honey({ clock }: { clock: { current: number } }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: HONEY_VERT,
        fragmentShader: HONEY_FRAG,
        fog: true,
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          { uTime: { value: 0 }, uAge: { value: -1 }, uAgeG: { value: -1 }, uO: { value: new THREE.Vector2(ORIGIN.x, ORIGIN.z) }, uG: { value: new THREE.Vector2(...CORE) } },
        ]),
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  useFrame(({ clock: c }) => {
    const t = clock.current
    material.uniforms.uTime.value = c.elapsedTime
    material.uniforms.uAge.value = t >= T.ripple && t < T.ripple + 7 ? t - T.ripple : -1
    material.uniforms.uAgeG.value = t >= T.fanout && t < T.fanout + 5 ? t - T.fanout : -1
  })
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.08} material={material}>
      <circleGeometry args={[RADIUS + 40, 64]} />
    </mesh>
  )
}

function QuorumCore({ tokens }: { tokens: Tokens }) {
  const crown = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock }) => {
    if (crown.current) crown.current.emissiveIntensity = 0.7 + Math.sin(clock.elapsedTime * 1.2) * 0.2
  })
  const tiers = [[2.4, 2.7, 0.5], [1.9, 2.2, 1.4], [1.4, 1.7, 1.6], [0.9, 1.15, 1.4]]
  let y = 0.35
  return (
    <group position={[CORE[0], 0, CORE[1]]}>
      {tiers.map(([top, bottom, h], i) => {
        const at = y
        y += h + 0.12
        return (
          <group key={i} position-y={at}>
            <mesh position-y={h / 2} castShadow receiveShadow>
              <cylinderGeometry args={[top, bottom, h, 6]} />
              <meshStandardMaterial color={i % 2 ? "#2b2b2f" : "#232327"} metalness={0.4} roughness={0.5} />
            </mesh>
            <mesh position-y={h + 0.06}>
              <cylinderGeometry args={[top + 0.08, top + 0.08, 0.08, 6]} />
              <meshStandardMaterial color={tokens.gold} emissive={tokens.amber} emissiveIntensity={0.5} metalness={0.8} roughness={0.3} />
            </mesh>
          </group>
        )
      })}
      <mesh position-y={y + 0.6}>
        <octahedronGeometry args={[0.55, 0]} />
        <meshStandardMaterial ref={crown} color={tokens.honey} emissive={tokens.honey} emissiveIntensity={0.8} toneMapped={false} />
      </mesh>
      <pointLight position-y={y + 1} color={tokens.amber} intensity={40} distance={18} decay={1.6} />
      <Html position={[0, y + 1.8, 0]} center zIndexRange={[10, 0]}>
        <div className="pointer-events-none whitespace-nowrap font-mono text-[10px] tracking-[0.3em] text-honey">QUORUM CORE</div>
      </Html>
    </group>
  )
}

function AgencyNode({ agency, tokens, clock, dim }: { agency: Agency; tokens: Tokens; clock: { current: number }; dim: boolean }) {
  const ring = useRef<THREE.MeshStandardMaterial>(null)
  const pulse = useRef<THREE.Mesh>(null)
  const receiver = RECEIVERS.findIndex((r) => r.id === agency.id)
  useFrame(() => {
    const t = clock.current
    const at = agency.id === ORIGIN_AGENCY.id ? T.toLocal + 1 : T.ack + receiver * 0.25
    const age = agency.protected ? t - at : -1
    const lit = age >= 0 && age < 1.6 ? 1 - age / 1.6 : 0
    if (ring.current) ring.current.emissiveIntensity = 0.25 + lit * 2.2
    if (pulse.current) {
      pulse.current.visible = lit > 0
      pulse.current.scale.setScalar(1 + (1 - lit) * 3)
      ;(pulse.current.material as THREE.MeshBasicMaterial).opacity = lit * 0.7
    }
  })
  return (
    <group position={[agency.x, 0.35, agency.z]}>
      {agency.protected && (
        <>
          <mesh position-y={0.6} castShadow>
            <cylinderGeometry args={[0.35, 0.5, 1.2, 6]} />
            <meshStandardMaterial color="#26262a" metalness={0.5} roughness={0.45} />
          </mesh>
          <mesh position-y={1.25} rotation-x={Math.PI / 2}>
            <torusGeometry args={[0.55, 0.06, 6, 6]} />
            <meshStandardMaterial ref={ring} color={tokens.gold} emissive={tokens.amber} emissiveIntensity={0.25} />
          </mesh>
          <mesh ref={pulse} rotation-x={-Math.PI / 2} position-y={0.05} visible={false}>
            <ringGeometry args={[0.8, 0.95, 6]} />
            <meshBasicMaterial color={tokens.honey} transparent toneMapped={false} />
          </mesh>
          {Array.from({ length: agency.vault }).map((_, i) => (
            <mesh key={i} position={[-2.4, 0.3 + i * 0.62, -1.4]} castShadow>
              <cylinderGeometry args={[1 - i * 0.25, 1.1 - i * 0.25, 0.55, 6]} />
              <meshStandardMaterial color={["#34353a", "#303136", "#2b2c30"][i]} metalness={0.4} roughness={0.5} emissive={tokens.amber} emissiveIntensity={0.04 + i * 0.03} />
            </mesh>
          ))}
        </>
      )}
      {!dim && (
        <Html position={[0, agency.protected ? 2.2 : 0.9, 0]} center zIndexRange={[10, 0]}>
          <div className="pointer-events-none text-center">
            <div className={`whitespace-nowrap font-mono text-[10.5px] tracking-[0.22em] ${agency.protected ? "text-cream" : "text-dim"}`}>{agency.name.toUpperCase()}</div>
            <div className={`font-mono text-[9px] tracking-[0.18em] ${agency.protected ? "text-gold" : "text-mute"}`}>{agency.protected ? "PROTECTED" : "NOT IN SERVICE"}</div>
          </div>
        </Html>
      )}
    </group>
  )
}

function Beacon({ decoy, tokens, clock, selected, faded, onSelect }: { decoy: FieldDecoy; tokens: Tokens; clock: { current: number }; selected: boolean; faded: boolean; onSelect: (id: string) => void }) {
  const core = useRef<THREE.MeshStandardMaterial>(null)
  const halo = useRef<THREE.Mesh>(null)
  const dashes = useRef<THREE.Group>(null)
  const marker = useRef<THREE.Group>(null)
  const light = useRef<THREE.PointLight>(null)
  const triggered = decoy.state === "Triggered"
  const retired = decoy.state === "Retired"
  const base = triggered ? tokens.alarm : decoy.state === "Rotating" ? tokens.amber : retired ? tokens.mute : tokens.honey
  useFrame(({ clock: c }) => {
    const e = c.elapsedTime
    const t = clock.current
    const flash = triggered && t < 1 ? Math.abs(Math.sin(t * 12)) : 0
    const glow = retired ? 0.05 : triggered ? 1.4 + Math.sin(e * 3) * 0.4 + flash * 2 : 0.9 + Math.sin(e * 1.4 + decoy.x) * 0.2
    if (core.current) core.current.emissiveIntensity = glow
    if (light.current) light.current.intensity = retired ? 0 : glow * (triggered ? 6 : 3)
    if (halo.current) halo.current.rotation.z = e * 0.3
    if (dashes.current) dashes.current.rotation.y = e * 0.6
    if (marker.current) {
      marker.current.visible = triggered && (t > 0.5 || selected)
      marker.current.position.y = 2.6 + Math.sin(e * 2) * 0.12
      marker.current.rotation.y = e * 0.8
    }
  })
  return (
    <group
      position={[decoy.x, 0.35, decoy.z]}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(decoy.id)
      }}
      onPointerOver={() => (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "")}
    >
      <mesh position-y={0.15} castShadow>
        <cylinderGeometry args={[0.55, 0.65, 0.3, 6]} />
        <meshStandardMaterial color="#1e1f24" metalness={0.6} roughness={0.4} transparent opacity={faded ? 0.35 : 1} />
      </mesh>
      <mesh position-y={0.32} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.6, 0.03, 4, 6]} />
        <meshStandardMaterial color={tokens.gold} emissive={base} emissiveIntensity={retired ? 0 : 0.6} />
      </mesh>
      <mesh position-y={0.55}>
        <cylinderGeometry args={[0.12, 0.22, 0.5, 6]} />
        <meshStandardMaterial color="#26262a" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position-y={1.15} castShadow>
        <octahedronGeometry args={[0.36, 0]} />
        <meshStandardMaterial ref={core} color={base} emissive={base} roughness={0.25} transparent opacity={faded ? 0.4 : 0.95} toneMapped={false} />
      </mesh>
      <pointLight ref={light} position-y={1.2} color={base} distance={4} decay={1.8} />
      {!retired && (
        <mesh ref={halo} position-y={1.15} rotation-x={Math.PI / 2}>
          <ringGeometry args={[0.55 + decoy.lure * 0.25, 0.6 + decoy.lure * 0.25, 6]} />
          <meshBasicMaterial color={base} transparent opacity={0.35 * decoy.lure} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      )}
      {decoy.state === "Rotating" && (
        <group ref={dashes} position-y={0.4}>
          {Array.from({ length: 10 }).map((_, i) => {
            const a = (i / 10) * Math.PI * 2
            return (
              <mesh key={i} position={[Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95]} rotation-y={-a}>
                <boxGeometry args={[0.04, 0.04, 0.3]} />
                <meshBasicMaterial color={tokens.amber} toneMapped={false} />
              </mesh>
            )
          })}
        </group>
      )}
      <group ref={marker} visible={false}>
        <mesh rotation-x={Math.PI}>
          <coneGeometry args={[0.32, 0.55, 3]} />
          <meshStandardMaterial color={tokens.alarm} emissive={tokens.alarm} emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
      </group>
      {selected && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
          <ringGeometry args={[0.95, 1.08, 6]} />
          <meshBasicMaterial color={tokens.honey} toneMapped={false} />
        </mesh>
      )}
      <Html position={[0, triggered ? 3.4 : 1.9, 0]} center zIndexRange={[10, 0]}>
        <div className={`pointer-events-none whitespace-nowrap font-mono text-[10px] tracking-[0.16em] ${triggered ? "text-alarm" : selected ? "text-honey" : faded ? "text-mute" : "text-dim"}`}>
          {decoy.id}
        </div>
      </Html>
    </group>
  )
}

const arc = (from: [number, number], to: [number, number], lift = 3) =>
  new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(from[0], 1.4, from[1]),
    new THREE.Vector3((from[0] + to[0]) / 2, lift, (from[1] + to[1]) / 2),
    new THREE.Vector3(to[0], 1.4, to[1]),
  )

function Signal({ curve, t0, dur, color, clock }: { curve: THREE.QuadraticBezierCurve3; t0: number; dur: number; color: THREE.Color; clock: { current: number } }) {
  const packet = useRef<THREE.Mesh>(null)
  const line = useRef<{ material: { opacity: number } } | null>(null)
  const points = useMemo(() => curve.getPoints(32), [curve])
  useFrame(() => {
    const k = (clock.current - t0) / dur
    if (packet.current) {
      packet.current.visible = k >= 0 && k <= 1
      if (k >= 0 && k <= 1) packet.current.position.copy(curve.getPoint(k))
    }
    if (line.current) line.current.material.opacity = k < 0 ? 0.12 : k < 3 ? 0.85 - Math.min(0.7, Math.max(0, k - 1) * 0.35) : 0.12
  })
  return (
    <>
      <Line ref={line as never} points={points} color={color} lineWidth={1.6} transparent opacity={0.12} dashed dashSize={0.3} gapSize={0.2} />
      <mesh ref={packet} visible={false}>
        <sphereGeometry args={[0.16, 12, 10]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </>
  )
}

function Rig({ focus, clock, reduced }: { focus: FieldDecoy | null; clock: { current: number }; reduced: boolean }) {
  const { camera, controls } = useThree()
  const goal = useRef<{ target: THREE.Vector3; pos: THREE.Vector3; until: number } | null>(null)
  useEffect(() => {
    const target = focus ? new THREE.Vector3(focus.x, 1, focus.z) : new THREE.Vector3(0, 0, 1)
    const pos = focus ? target.clone().add(new THREE.Vector3(7, 6.5, 9)) : new THREE.Vector3(0, 26, 30)
    goal.current = { target, pos, until: performance.now() + 1600 }
  }, [focus])
  useFrame((_, delta) => {
    clock.current = reduced ? 6 : (clock.current + delta) % LOOP
    const orbit = controls as unknown as { target: THREE.Vector3; update: () => void } | null
    if (!orbit) return
    const g = goal.current
    if (g && performance.now() < g.until) {
      const k = 1 - Math.exp(-delta * 4)
      orbit.target.lerp(g.target, k)
      camera.position.lerp(g.pos, k)
      orbit.update()
    }
    // keep the field filling the frame
    orbit.target.x = THREE.MathUtils.clamp(orbit.target.x, -14, 14)
    orbit.target.z = THREE.MathUtils.clamp(orbit.target.z, -12, 12)
    orbit.target.y = THREE.MathUtils.clamp(orbit.target.y, 0, 2)
  })
  return null
}

export default function DecoyField({
  decoys,
  selected,
  focus,
  onSelect,
}: {
  decoys: FieldDecoy[]
  selected: string | null
  focus: boolean
  onSelect: (id: string | null) => void
}) {
  const tokens = useMemo(readTokens, [])
  const clock = useRef(0)
  const reduced = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, [])
  const visible = new Set(decoys.map((d) => d.id))
  const focused = focus ? (DECOYS.find((d) => d.id === selected) ?? null) : null
  const routes = useMemo(() => {
    const local = arc([ORIGIN.x, ORIGIN.z], [ORIGIN_AGENCY.x, ORIGIN_AGENCY.z], 2.2)
    const toCore = arc([ORIGIN_AGENCY.x, ORIGIN_AGENCY.z], CORE, 5)
    const fan = RECEIVERS.map((r) => arc(CORE, [r.x, r.z], 5.5))
    return { local, toCore, fan }
  }, [])
  const bg = `#${tokens.ink.clone().lerp(new THREE.Color("#1d2440"), 0.85).getHexString()}`
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 26, 30], fov: 38, near: 0.5, far: 200 }} onPointerMissed={() => !focus && onSelect(null)}>
      <color attach="background" args={[bg]} />
      <fog attach="fog" args={[bg, 34, 70]} />
      <hemisphereLight args={["#ffe2b8", "#2a2440", 1.2]} />
      <ambientLight intensity={0.35} color="#c8cbe0" />
      <directionalLight position={[-14, 24, 10]} intensity={2.2} color="#ffe6c4" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30} shadow-bias={-0.0005} />
      <Ground />
      <Honey clock={clock} />
      <QuorumCore tokens={tokens} />
      {AGENCIES.map((a) => (
        <AgencyNode key={a.id} agency={a} tokens={tokens} clock={clock} dim={!!focused && focused.agency !== a.id} />
      ))}
      {DECOYS.map((d) => (
        <Beacon key={d.id} decoy={d} tokens={tokens} clock={clock} selected={selected === d.id} faded={!visible.has(d.id) || (!!focused && focused.agency !== d.agency)} onSelect={onSelect} />
      ))}
      <Signal curve={routes.local} t0={T.toLocal} dur={1} color={tokens.alarm} clock={clock} />
      <Signal curve={routes.toCore} t0={T.toCore} dur={1.3} color={tokens.honey} clock={clock} />
      {routes.fan.map((curve, i) => (
        <Signal key={i} curve={curve} t0={T.fanout + i * 0.25} dur={1.5} color={tokens.honey} clock={clock} />
      ))}
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} minDistance={focus ? 6 : 18} maxDistance={focus ? 22 : 44} maxPolarAngle={Math.PI * 0.42} minPolarAngle={0.15} screenSpacePanning={false} />
      <Rig focus={focused} clock={clock} reduced={reduced} />
    </Canvas>
  )
}

export { ORIGIN, RECEIVERS }

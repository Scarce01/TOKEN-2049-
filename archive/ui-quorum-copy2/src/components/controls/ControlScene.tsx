import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Billboard, Line, OrbitControls } from "@react-three/drei"
import * as THREE from "three"
import type { Stage } from "./data"
import { tone } from "./visualState"
import { HONEY_FRAG, HONEY_VERT } from "../World"

export type ObjectId = "honeypot" | "verification" | "accepted" | "registry" | "hot" | "warm" | "cold"
const positions: Record<ObjectId, [number, number, number]> = {
  honeypot: [-7, 0, 3],
  verification: [-4, 0, -1],
  accepted: [0, 0, -1],
  registry: [-1, 0, -5],
  hot: [3, 0, 3],
  warm: [5, 0, -1],
  cold: [7, 0, -5],
}
const names: Record<ObjectId, string> = {
  honeypot: "HONEYPOT",
  verification: "CRE",
  accepted: "RECEIVER",
  registry: "REGISTRY",
  hot: "HOT",
  warm: "WARM",
  cold: "COLD",
}
export function objectState(id: ObjectId, stages: Stage[]) {
  return (
    stages.find((stage) => stage.id === (id === "honeypot" ? "detected" : id))
      ?.state ?? "unavailable"
  )
}
function objectHeight(id: ObjectId) {
  return id === "cold"
    ? 3.2
    : id === "warm"
      ? 1.8
      : id === "hot"
        ? 0.8
        : id === "verification"
          ? 1.15
          : 0.7
}
function stateLabel(id: ObjectId, state: string) {
  return state === "confirmed"
    ? id === "hot"
      ? "QUOTA 0"
      : id === "warm"
        ? "COSIGN ONLY"
        : id === "cold"
          ? "DELAY 72H"
          : "CONFIRMED"
    : state.toUpperCase()
}
function hexGeometry(radius: number) {
  const shape = new THREE.Shape()
  for (let index = 0; index < 6; index++) {
    const angle = (index * Math.PI) / 3 + Math.PI / 6
    const positionX = Math.cos(angle) * radius,
      positionY = Math.sin(angle) * radius
    if (index) shape.lineTo(positionX, positionY)
    else shape.moveTo(positionX, positionY)
  }
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    steps: 1,
    bevelSize: 0.025,
    bevelThickness: 0.025,
  })
  geometry.rotateX(-Math.PI / 2)
  return geometry
}
/* honey channels shared with the live Hive City: meandering, with land bridges */
const RIVERS: ((x: number, z: number) => number)[] = [
  (x, z) => Math.abs(z - (Math.sin(x * 0.35) * 1.4 - 3)),
  (x, z) => Math.abs(x - (10.5 + Math.sin(z * 0.3) * 2)),
  (x, z) => Math.abs(z - (8 + Math.cos(x * 0.25) * 1.6)),
  (x, z) => Math.abs(x - (-12 + Math.sin(z * 0.4) * 1.5)),
  (x, z) => Math.abs(z - (-11 + Math.sin(x * 0.2 + 1) * 2.2)),
  (x, z) => Math.abs(x + z * 0.6 - 24 - Math.sin(z * 0.3) * 2),
]
const STONE = ["#8d8074", "#887a6d", "#918376", "#84786c", "#8b7c6e", "#8f8278"].map((c) => new THREE.Color(c))
const STONE_BANK = new THREE.Color("#77706a")
export const WORLD_RADIUS = 40
const PAN_LIMIT = 6
const hash = (x: number, z: number) => {
  const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453
  return v - Math.floor(v)
}
function Terrain({
  wave,
  reduced,
  view,
}: {
  wave: number
  reduced: boolean
  view: "triggers" | "vaults"
}) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const geometry = useMemo(() => hexGeometry(0.31), [])
  const cells = useMemo(() => {
    const result: {
      x: number
      z: number
      height: number
      protected: boolean
      color: THREE.Color
    }[] = []
    for (let row = -80; row <= 80; row++)
      for (let column = -70; column <= 70; column++) {
        const positionX = Math.sqrt(3) * 0.34 * (column + (row & 1) / 2),
          positionZ = row * 0.51
        if (Math.hypot(positionX, positionZ) > WORLD_RADIUS) continue
        const isProtected = Object.values(positions).some(
          (point) =>
            Math.hypot(positionX - point[0], positionZ - point[2]) < 1.5,
        )
        const river = Math.min(...RIVERS.map((fn) => fn(positionX, positionZ)))
        const bridge =
          Math.abs((((positionX + positionZ * 0.5 + 3) % 15) + 15) % 15 - 7.5) < 0.7
        if (river < 0.42 && !bridge && !isProtected) continue
        const color = STONE[Math.floor(hash(column, row) * STONE.length)].clone()
        if (river < 0.9) color.lerp(STONE_BANK, 0.55)
        color.multiplyScalar(0.92 + hash(row, column) * 0.12)
        result.push({
          x: positionX,
          z: positionZ,
          height:
            0.32 +
            0.035 * Math.sin(positionX * 0.65) * Math.cos(positionZ * 0.7) +
            hash(column * 3, row) * 0.03,
          protected: isProtected,
          color,
        })
      }
    return result
  }, [view])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const coral = useMemo(() => new THREE.Color("#e88b7a"), [])
  const lastWave = useRef<number | null>(null)
  useEffect(() => () => geometry.dispose(), [geometry])
  useFrame(() => {
    if (!mesh.current) return
    const active = !reduced && wave >= 0 && wave < 9
    const effectiveWave = active ? wave : -1
    if (lastWave.current === effectiveWave) return
    lastWave.current = effectiveWave
    const radius = wave * 2.5
    cells.forEach((cell, index) => {
      const distance = Math.hypot(cell.x + 7, cell.z - 3)
      const delta = distance - radius
      const crest = active ? Math.exp((-delta * delta) / 0.65) : 0
      const secondary = Math.exp(-((delta + 1.7) ** 2) / 0.6)
      const trough = Math.exp(-((delta + 0.8) ** 2) / 0.35)
      const depression =
        wave < 1.4
          ? -0.16 *
            Math.exp((-distance * distance) / 3) *
            Math.sin((wave / 1.4) * Math.PI)
          : 0
      const decay = Math.max(0, 1 - wave / 9)
      const displacement =
        active && !cell.protected
          ? (0.95 * crest + 0.38 * secondary - 0.32 * trough + depression) *
            decay
          : 0
      dummy.position.set(cell.x, displacement, cell.z)
      dummy.scale.set(1, cell.height, 1)
      dummy.updateMatrix()
      mesh.current!.setMatrixAt(index, dummy.matrix)
      color.copy(cell.color)
      if (active && !cell.protected) color.lerp(coral, crest * decay * 0.85)
      mesh.current!.setColorAt(index, color)
    })
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor)
      mesh.current.instanceColor.needsUpdate = true
  })
  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, cells.length]}
      receiveShadow
      castShadow
    >
      <meshStandardMaterial roughness={0.82} metalness={0.04} />
    </instancedMesh>
  )
}
function HoneyRivers({
  wave,
  reduced,
  origin,
  hub,
}: {
  wave: number
  reduced: boolean
  origin: [number, number]
  hub: [number, number]
}) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: HONEY_VERT,
        fragmentShader: HONEY_FRAG,
        fog: true,
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            uTime: { value: 0 },
            uAge: { value: -1 },
            uAgeG: { value: -1 },
            uO: { value: new THREE.Vector2() },
            uG: { value: new THREE.Vector2() },
          },
        ]),
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  useFrame(({ clock }) => {
    const uniforms = material.uniforms
    uniforms.uTime.value = reduced ? 0 : clock.elapsedTime
    uniforms.uAge.value = !reduced && wave >= 0 && wave < 9 ? (wave * 2.5) / 4.6 : -1
    uniforms.uO.value.set(origin[0], origin[1])
    uniforms.uG.value.set(hub[0], hub[1])
  })
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.06} material={material}>
      <circleGeometry args={[WORLD_RADIUS + 30, 64]} />
    </mesh>
  )
}
function Landmark({
  id,
  stages,
  selected,
  onSelect,
  geometry,
  reduced,
}: {
  id: ObjectId
  stages: Stage[]
  selected: boolean
  onSelect: (id: ObjectId) => void
  geometry: THREE.BufferGeometry
  reduced: boolean
}) {
  const [hover, setHover] = useState(false)
  const gate = useRef<THREE.Mesh>(null)
  const state = objectState(id, stages)
  const restricted = state === "confirmed" && (id === "hot" || id === "warm")
  const isVault = ["hot", "warm", "cold"].includes(id)
  const height = objectHeight(id)
  const gold = id === "honeypot" || isVault
  const material =
    id === "honeypot" && state === "detected"
      ? "#d78370"
      : selected
        ? "#3a3b40"
        : gold
          ? "#191b20"
          : "#2c2d31"
  const structureMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: material,
        roughness: 0.42,
        metalness: 0.55,
      }),
    [],
  )
  const targetColor = useMemo(() => new THREE.Color(material), [material])
  useEffect(() => () => structureMaterial.dispose(), [structureMaterial])
  const columns = useMemo(() => {
    const radius = id === "hot" ? 2 : 1
    const result: [number, number, number][] = []
    for (let axialColumn = -radius; axialColumn <= radius; axialColumn++)
      for (let axialRow = -radius; axialRow <= radius; axialRow++) {
        if (
          Math.abs(axialColumn + axialRow) > radius ||
          (id === "hot" && axialRow === radius && axialColumn === -1)
        )
          continue
        const edge = Math.max(
          Math.abs(axialColumn),
          Math.abs(axialRow),
          Math.abs(axialColumn + axialRow),
        )
        result.push([
          Math.sqrt(3) * 0.39 * (axialColumn + axialRow / 2),
          height - edge * (id === "warm" ? 0.45 : 0.15),
          axialRow * 0.585,
        ])
      }
    return result
  }, [id, height])
  useFrame((_, delta) => {
    structureMaterial.color.lerp(
      targetColor,
      reduced ? 1 : 1 - Math.exp(-14 * delta),
    )
    if (gate.current)
      gate.current.position.y = reduced
        ? restricted
          ? 0.85
          : 0.35
        : THREE.MathUtils.damp(
            gate.current.position.y,
            restricted ? 0.85 : 0.35,
            12,
            delta,
          )
  })
  return (
    <group
      position={positions[id]}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(id)
      }}
      onPointerOver={(event) => {
        event.stopPropagation()
        setHover(true)
      }}
      onPointerOut={() => setHover(false)}
    >
      <mesh position-y={0.36} receiveShadow>
        <cylinderGeometry
          args={[id === "hot" ? 1.8 : 1.25, id === "hot" ? 1.9 : 1.35, 0.16, 6]}
        />
        <meshStandardMaterial
          color={selected || hover ? "#b98d3c" : "#2c2d31"}
          roughness={0.55}
          metalness={0.35}
        />
      </mesh>
      {isVault &&
        Array.from(
          { length: id === "cold" ? 7 : id === "warm" ? 4 : 2 },
          (_, index) => (
            <group key={index} position-y={0.52 + index * 0.4}>
              <mesh castShadow receiveShadow>
                <cylinderGeometry args={[1.05, 1.1, 0.32, 6]} />
                <meshStandardMaterial
                  color="#191b20"
                  roughness={0.55}
                  metalness={0.65}
                />
              </mesh>
              <mesh position-y={0.195}>
                <cylinderGeometry args={[0.99, 0.99, 0.018, 6]} />
                <meshStandardMaterial
                  color="#191b20"
                  roughness={0.6}
                  metalness={0.5}
                />
              </mesh>
              <mesh position-y={0.17}>
                <cylinderGeometry args={[1.055, 1.055, 0.035, 6]} />
                <meshStandardMaterial
                  color="#b98d3c"
                  emissive="#b98d3c"
                  emissiveIntensity={selected || hover ? 0.65 : 0.2}
                  metalness={0.65}
                  roughness={0.4}
                />
              </mesh>
              <mesh position={[0, 0, 0.96]}>
                <boxGeometry args={[0.38, 0.06, 0.04]} />
                <meshStandardMaterial
                  color="#ffb52e"
                  emissive="#ffb52e"
                  emissiveIntensity={0.7}
                />
              </mesh>
            </group>
          ),
        )}
      {id === "verification" && <group position-y={0.48}>
        <mesh castShadow><cylinderGeometry args={[0.58, 0.78, 1.2, 6]} /><meshStandardMaterial color="#191b20" metalness={0.6} roughness={0.45} /></mesh>
        <mesh position-y={0.8} rotation-x={Math.PI / 2}><torusGeometry args={[0.94, 0.045, 4, 6]} /><meshStandardMaterial color="#b98d3c" emissive="#b98d3c" emissiveIntensity={0.35} /></mesh>
        <mesh position-y={0.6}><cylinderGeometry args={[0.35, 0.35, 0.06, 6]} /><meshStandardMaterial color="#b98d3c" emissive="#b98d3c" emissiveIntensity={0.5} /></mesh>
      </group>}
      {id === "accepted" && <group position-y={0.47}>
        {[-0.65, 0.65].map(positionX => <mesh key={positionX} position={[positionX, 0.5, 0]} castShadow><boxGeometry args={[0.42, 1.05, 0.9]} /><meshStandardMaterial color="#191b20" roughness={0.55} metalness={0.6} /></mesh>)}
        <mesh position-y={1.05} castShadow><boxGeometry args={[1.75, 0.3, 0.9]} /><meshStandardMaterial color="#2c2d31" roughness={0.5} metalness={0.6} /></mesh>
        <mesh position={[0, 0.9, 0.46]}><boxGeometry args={[1.25, 0.035, 0.025]} /><meshStandardMaterial color="#b98d3c" emissive="#b98d3c" emissiveIntensity={0.35} /></mesh>
      </group>}
      {id === "registry" && <group position-y={0.47}>
        <mesh position-y={0.58} castShadow><boxGeometry args={[1.2, 1.15, 0.55]} /><meshStandardMaterial color="#191b20" roughness={0.55} metalness={0.55} /></mesh>
        {[0.3, 0.55, 0.8].map(positionY => <mesh key={positionY} position={[0, positionY, 0.285]}><boxGeometry args={[0.8, 0.035, 0.025]} /><meshStandardMaterial color="#b98d3c" emissive="#b98d3c" emissiveIntensity={0.25} /></mesh>)}
      </group>}
      {id === "honeypot" &&
        columns.map(([positionX, columnHeight, positionZ], index) => (
          <mesh
            key={index}
            geometry={geometry}
            material={structureMaterial}
            position={[positionX, 0.47, positionZ]}
            scale={[1, columnHeight, 1]}
            castShadow
            receiveShadow
          />
        ))}
      {id === "cold" &&
        Array.from({ length: 6 }, (_, index) => (
          <mesh
            key={index}
            geometry={geometry}
            position={[
              Math.cos((index * Math.PI) / 3) * 1.22,
              0.5,
              Math.sin((index * Math.PI) / 3) * 1.22,
            ]}
            scale={[0.3, 1.1, 0.3]}
            castShadow
          >
            <meshStandardMaterial
              color="#3a3b40"
              metalness={0.6}
              roughness={0.4}
            />
          </mesh>
        ))}
      {(id === "hot" || id === "warm") && (
        <mesh
          ref={gate}
          position={[0, 0.35, id === "hot" ? 1.2 : 0.9]}
          castShadow
        >
          <boxGeometry args={[0.72, 0.8, 0.18]} />
          <meshStandardMaterial
            color={restricted ? "#b98d3c" : "#3a3b40"}
            metalness={0.5}
            roughness={0.4}
          />
        </mesh>
      )}
      {id === "honeypot" && state === "detected" && (
        <Billboard position={[0, height + 1.05, 0]}>
          <mesh rotation-z={-Math.PI / 2}>
            <circleGeometry args={[0.25, 3]} />
            <meshBasicMaterial color="#e88b7a" side={THREE.DoubleSide} />
          </mesh>
        </Billboard>
      )}
      {id !== "honeypot" && (
        <mesh position={[0.9, height + 0.6, 0]}>
          <sphereGeometry args={[0.11, 12, 12]} />
          <meshStandardMaterial
            color={tone(state)}
            emissive={tone(state)}
            emissiveIntensity={0.25}
          />
        </mesh>
      )}
      {id === "honeypot" && (
        <pointLight
          position={[0, 2, 0]}
          intensity={4}
          distance={5}
          color="#e7b76c"
        />
      )}
    </group>
  )
}
function Routes({
  stages,
  selected,
  time,
  view,
}: {
  stages: Stage[]
  selected: ObjectId
  time: number
  view: "triggers" | "vaults"
}) {
  const routes: [ObjectId, ObjectId][] =
    view === "vaults"
      ? [
          ["hot", "warm"],
          ["warm", "cold"],
        ]
      : [
          ["honeypot", "verification"],
          ["verification", "accepted"],
          ["accepted", "hot"],
          ["accepted", "warm"],
          ["accepted", "cold"],
          ["accepted", "registry"],
        ]
  return (
    <group>
      {routes.map(([from, to]) => {
        const state = objectState(to, stages)
        const sourcePoint = positions[from],
          targetPoint = positions[to]
        return (
          <Line
            key={to}
            points={[
              [sourcePoint[0], 0.48, sourcePoint[2]],
              [sourcePoint[0], 0.48, (sourcePoint[2] + targetPoint[2]) / 2],
              [targetPoint[0], 0.48, (sourcePoint[2] + targetPoint[2]) / 2],
              [targetPoint[0], 0.48, targetPoint[2]],
            ]}
            color={
              selected === to || selected === from
                ? "#b98d3c"
                : state === "confirmed"
                  ? "#b98d3c"
                  : "#3a3b40"
            }
            lineWidth={
              to === "registry" &&
              state === "confirmed" &&
              time >= 24 &&
              time < 25.5
                ? 2.5
                : selected === to
                  ? 2
                  : 1
            }
          />
        )
      })}
      {stages.find((stage) => stage.id === "sweep")?.state === "confirmed" &&
        time >= 16 &&
        time < 18 && (
          <group position={[3 + (time - 16) * 2, 1.1, 3 - (time - 16) * 4]}>
            <mesh>
              <sphereGeometry args={[0.14, 12, 12]} />
              <meshBasicMaterial color="#e9c580" />
            </mesh>
          </group>
        )}
    </group>
  )
}
function BoundedCameraControls({ view, reduced }: { view: "triggers" | "vaults"; reduced: boolean }) {
  const { camera, size: canvasSize, controls } = useThree()
  const minimumZoom = Math.hypot(canvasSize.width, canvasSize.height * 2) / 30
  useEffect(() => {
    const orthographic = camera as THREE.OrthographicCamera
    orthographic.zoom = Math.max(minimumZoom,
      Math.min(34, canvasSize.width / 28, canvasSize.height / 16) *
      (view === "vaults" ? 1.35 : 1))
    orthographic.updateProjectionMatrix()
  }, [camera, canvasSize.width, canvasSize.height, view, minimumZoom])
  useFrame(() => {
    const orbit = controls as unknown as { target: THREE.Vector3 } | null
    if (!orbit) return
    const target = orbit.target
    const boundedX = THREE.MathUtils.clamp(target.x, -2, 2)
    const boundedZ = THREE.MathUtils.clamp(target.z, -2, 2)
    camera.position.x += boundedX - target.x
    camera.position.y -= target.y
    camera.position.z += boundedZ - target.z
    target.set(boundedX, 0, boundedZ)
  })
  return <OrbitControls
    makeDefault
    target={[0, 0, 0]}
    enableDamping={!reduced}
    dampingFactor={0.12}
    minZoom={minimumZoom}
    maxZoom={Math.max(65, minimumZoom * 2)}
    minPolarAngle={0.2}
    maxPolarAngle={Math.PI / 3}
    screenSpacePanning={false}
  />
}
function LabelProjector({
  labels,
  view,
  time,
}: {
  labels: RefObject<Partial<Record<ObjectId | "transfer", HTMLDivElement | null>>>
  view: "triggers" | "vaults"
  time: number
}) {
  const { camera, size } = useThree()
  const point = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    camera.updateMatrixWorld()
    for (const [id, element] of Object.entries(labels.current)) {
      if (!element) continue
      if (id === "transfer")
        point.set(3 + (time - 16) * 2, 1.65, 3 - (time - 16) * 4)
      else {
        const position = positions[id as ObjectId]
        point.set(position[0], objectHeight(id as ObjectId) + 1.2, position[2])
        if (id === "honeypot") point.x -= 3.2
      }
      if (view === "vaults") point.add(new THREE.Vector3(-4, 0, 1))
      point.project(camera)
      element.style.transform = `translate(${(point.x * 0.5 + 0.5) * size.width}px, ${(-point.y * 0.5 + 0.5) * size.height}px) translate(-50%, -50%)`
      element.style.visibility =
        point.z < -1 || point.z > 1 ? "hidden" : "visible"
    }
  })
  return null
}
export default function ControlScene({
  stages,
  selected,
  onSelect,
  view,
  wave,
  time,
  reduced,
  cameraKey,
}: {
  stages: Stage[]
  selected: ObjectId
  onSelect: (id: ObjectId) => void
  view: "triggers" | "vaults"
  wave: number
  time: number
  reduced: boolean
  cameraKey: number
}) {
  const geometry = useMemo(() => hexGeometry(0.36), [])
  const labels =
    useRef<Partial<Record<ObjectId | "transfer", HTMLDivElement | null>>>({})
  const visibleIds = (Object.keys(positions) as ObjectId[]).filter(
    (id) => view === "triggers" || ["hot", "warm", "cold"].includes(id),
  )
  const transferVisible =
    !reduced &&
    stages.find((stage) => stage.id === "sweep")?.state === "confirmed" &&
    time >= 16 &&
    time < 18
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <div className="relative h-full w-full">
      <Canvas
        key={cameraKey}
        shadows
        orthographic
        camera={{ position: [13, 22, 25], zoom: 31, near: 0.1, far: 200 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#1a2033"]} />
        <fog attach="fog" args={["#1a2033", 38, 70]} />
        <ambientLight intensity={0.55} color="#c8cbe0" />
        <hemisphereLight args={["#ffe2b8", "#2a2440", 1.1]} />
        <pointLight position={[0, 4, -1]} color="#ffb655" intensity={18} distance={16} decay={1.5} />
        <directionalLight
          position={[-8, 18, 8]}
          intensity={2.3}
          color="#ffe6c4"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-16}
          shadow-camera-right={16}
          shadow-camera-top={16}
          shadow-camera-bottom={-16}
          shadow-bias={-0.001}
        />
        <group position={view === "vaults" ? [-4, 0, 1] : [0, 0, 0]}>
          <Terrain key={view} wave={wave} reduced={reduced} view={view} />
          <Routes
            stages={stages}
            selected={selected}
            time={reduced ? 26 : time}
            view={view}
          />
          {(Object.keys(positions) as ObjectId[])
            .filter(
              (id) =>
                view === "triggers" || ["hot", "warm", "cold"].includes(id),
            )
            .map((id) => (
              <Landmark
                key={id}
                id={id}
                stages={stages}
                selected={selected === id}
                onSelect={onSelect}
                geometry={geometry}
                reduced={reduced}
              />
            ))}
        </group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position-y={-0.06} receiveShadow>
          <planeGeometry args={[200, 200]} />
          <meshStandardMaterial color="#0b0d10" roughness={1} />
        </mesh>
        <BoundedCameraControls view={view} reduced={reduced} />
        <LabelProjector labels={labels} view={view} time={time} />
      </Canvas>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {visibleIds.map((id) => {
          const state = objectState(id, stages)
          return (
            <div
              key={id}
              ref={(element) => {
                labels.current[id] = element
              }}
              className="absolute left-0 top-0"
            >
              <button
                onClick={() => onSelect(id)}
                aria-pressed={selected === id}
                className={`pointer-events-auto whitespace-nowrap rounded border px-2 py-1 text-center transition-colors duration-150 ${
                  selected === id
                    ? "border-[#d5b77e]/70 bg-[#14161b]/95"
                    : "border-white/10 bg-[#0f1115]/85 hover:border-white/40"
                }`}
              >
                <span className="block text-[10px] font-semibold tracking-[0.13em] text-[#f1e6ce]">
                  {names[id]}
                </span>
                <span
                  className="block text-[9px]"
                  style={{ color: tone(state) }}
                >
                  {stateLabel(id, state)}
                </span>
              </button>
            </div>
          )
        })}
        {transferVisible && (
          <div
            ref={(element) => {
              labels.current.transfer = element
            }}
            className="absolute left-0 top-0 whitespace-nowrap rounded bg-[#0f1115] px-2 py-1 text-[10px] text-[#e9c580]"
          >
            1,120 ETH · demo
          </div>
        )}
      </div>
    </div>
  )
}

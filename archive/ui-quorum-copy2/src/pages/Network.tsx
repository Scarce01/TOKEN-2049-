import { useEffect, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { Line } from "@react-three/drei"
import Html from "../components/SceneHtml"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import World, { type SceneState, type ViewCmd } from "../components/World"
import { AGENCIES, GLOBAL, ORIGIN_DECOY, T } from "../components/worldData"
import { MEMBERS } from "../components/mock"
import { Button, Label, Row } from "../components/ui"
import Registry from "./Registry"

const agencyIds = ["ag-a", "ag-d", "ag-b", "ag-c", "ag-e", "ag-f", "ag-g"]
const nodes = MEMBERS.map((member, index) => {
  const agency = AGENCIES.find((item) => item.id === agencyIds[index])!
  const position = agency.core ?? [agency.x, agency.z]
  return {
    ...member,
    agency,
    position,
    pick: `${agency.core ? "core" : "area"}:${agency.id}`,
  }
})
type Member = typeof nodes[number]
const status = (member: Member) =>
  member.id === "exA" ? "Origin" : member.state
const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

function SignalRoute({
  member,
  selected,
  reduced,
  replay,
}: {
  member: Member
  selected: boolean
  reduced: boolean
  replay: boolean
}) {
  const bead = useRef<THREE.Mesh>(null)
  const curve = useRef(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(GLOBAL[0], 9, GLOBAL[1]),
      new THREE.Vector3(member.position[0] * 0.5, 12, member.position[1] * 0.5),
      new THREE.Vector3(member.position[0], 3, member.position[1]),
    ),
  ).current
  useFrame(({ clock }) => {
    if (bead.current) {
      const progress = reduced
        ? 0.75
        : (clock.elapsedTime * 0.12 + nodes.indexOf(member) * 0.13) % 1
      curve.getPoint(progress, bead.current.position)
      bead.current.visible = member.state !== "Pending" && (replay || selected)
    }
  })
  const color = token("--color-gold")
  return (
    <group>
      <Line
        points={curve.getPoints(64)}
        color={color}
        transparent
        opacity={selected ? 0.65 : 0.18}
        lineWidth={selected ? 1.8 : 0.8}
        dashed={member.state === "Pending"}
        dashSize={0.5}
        gapSize={0.5}
      />
      <mesh ref={bead}>
        <sphereGeometry args={[0.14, 12, 8]} />
        <meshBasicMaterial color={token("--color-amber")} toneMapped={false} />
      </mesh>
    </group>
  )
}

export default function Network() {
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState(params.get("member") ?? "exB")
  const [view, setView] = useState<ViewCmd>({ kind: "reset", n: 0 })
  const [replaying, setReplaying] = useState(false)
  const [reduced, setReduced] = useState(false)
  const scene = useRef<SceneState>({
    t: T.end,
    tr: -1,
    mode: "live",
    selected: null,
    hover: null,
  })
  const member = nodes.find((node) => node.id === selected) ?? nodes[1]
  const core = selected === "global"
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)")
    const sync = () => setReduced(query.matches)
    sync()
    query.addEventListener("change", sync)
    return () => query.removeEventListener("change", sync)
  }, [])
  useEffect(() => {
    setSelected(params.get("member") ?? "exB")
  }, [params])
  useEffect(() => {
    if (!replaying || reduced) {
      scene.current.t = T.end
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      scene.current.t = Math.min(T.end, (now - start) / 1000)
      if (scene.current.t < T.end) frame = requestAnimationFrame(tick)
      else setReplaying(false)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [replaying, reduced])
  const select = (id: string) => {
    setSelected(id)
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.set("member", id)
        return next
      },
      { replace: true },
    )
  }
  const pick = (id: string | null) => {
    if (!id) return
    if (id === "global") select("global")
    else if (id.startsWith("decoy:")) {
      select("exA")
      setReplaying(true)
    } else {
      const node = nodes.find((item) => id.endsWith(item.agency.id))
      if (node) select(node.id)
    }
  }
  if (params.get("view") === "registry")
    return (
      <div className="h-full overflow-auto p-6">
        <Link to="/network" className="text-gold">
          ← Incident world
        </Link>
        <Registry />
      </div>
    )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 px-6 pt-5 pb-4">
        <div className="mb-2 flex items-center justify-between">
          <Label>Partner / network view · Incident #4,118</Label>
          <Link
            to="/network?view=registry"
            className="font-mono text-xs text-gold"
          >
            ThreatRegistry listing ↗
          </Link>
        </div>
        <div
          role="heading"
          aria-level={1}
          className="text-3xl font-medium text-cream"
        >
          One attack, <span className="text-amber">every member protected</span>
        </div>
        <p className="mt-2 text-sm text-dim">
          Exchange A’s decoy became ThreatRegistry entry #4,118. Within 44
          seconds, protected members received the signal and tightened their
          controls.
        </p>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(18rem,27%)] border-t border-line">
        <section
          aria-label="Interactive Hive City incident world"
          className="relative min-h-0 overflow-hidden"
        >
          <World
            incident
            reducedMotion={reduced}
            state={scene}
            mode="live"
            selected={core ? "global" : member.pick}
            traceFocus={false}
            onSelect={pick}
            view={view}
          >
            {nodes
              .filter((node) => node.id !== "exA")
              .map((node) => (
                <SignalRoute
                  key={node.id}
                  member={node}
                  selected={node.id === selected || core}
                  reduced={reduced}
                  replay={replaying}
                />
              ))}
            {nodes.map((node) => (
              <Html
                key={node.id}
                position={[node.position[0], 4.4, node.position[1]]}
                center
                distanceFactor={42}
                zIndexRange={[20, 0]}
              >
                <Button
                  variant="ghost"
                  onClick={() => select(node.id)}
                  className={`!h-auto !px-2 !py-1 bg-ink/90 border border-line !rounded-none whitespace-nowrap ${
                    node.id === selected
                      ? "!text-amber border-gold"
                      : "!text-cream"
                  }`}
                >
                  <span className="text-left">
                    <span className="block text-xs">{node.name}</span>
                    <span
                      className={`block font-mono text-[10px] uppercase tracking-wider ${
                        node.id === "exA" ? "text-alarm" : "text-dim"
                      }`}
                    >
                      {node.id === "exA" ? "▼ Attack origin" : status(node)}
                    </span>
                  </span>
                </Button>
              </Html>
            ))}
            <Html
              position={[GLOBAL[0], 12, GLOBAL[1]]}
              center
              distanceFactor={45}
              zIndexRange={[20, 0]}
            >
              <Button
                variant="ghost"
                className="bg-ink/90 !text-amber whitespace-nowrap !rounded-none border border-line"
                onClick={() => select("global")}
              >
                THREATREGISTRY / QUORUM CORE
              </Button>
            </Html>
            <Html
              position={[ORIGIN_DECOY.x, 3, ORIGIN_DECOY.z]}
              center
              zIndexRange={[20, 0]}
            >
              <Button
                variant="ghost"
                className="!text-alarm !text-xl"
                onClick={() => {
                  select("exA")
                  setReplaying(true)
                }}
              >
                ▼
              </Button>
            </Html>
          </World>
          <div className="pointer-events-none absolute left-5 right-5 top-4 flex flex-wrap items-center gap-4 border-b border-gold/20 bg-ink/80 px-4 py-3">
            {[
              ["36 / 38", "CONSUMED"],
              ["94%", "PROTECTED"],
              ["44s", "PROPAGATION"],
              ["38", "MEMBERS"],
            ].map(([value, label]) => (
              <div
                key={label}
                className="flex items-baseline gap-2 border-r border-line pr-4 last:border-0"
              >
                <span className="text-xl font-medium tabular-nums text-cream">
                  {value}
                </span>
                <span className="font-mono text-[10px] tracking-wider text-dim">
                  {label}
                </span>
              </div>
            ))}
          </div>
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t border-line bg-ink/95 px-5 py-3">
            <div className="space-y-2">
              <div className="font-mono text-xs text-amber">
                ●{" "}
                {replaying
                  ? "REPLAY · Signal propagating"
                  : "LIVE · Propagation complete"}
              </div>
              <div className="flex gap-3 font-mono text-[10px] text-dim">
                <span className="text-gold">━ Consumed</span>
                <span>●→ Propagating</span>
                <span>┄ Pending</span>
                <span>○ Received</span>
                <span>× Failed</span>
              </div>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                onClick={() => setReplaying((value) => !value)}
              >
                {replaying ? "Stop" : "Replay"}
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  setView((value) => ({ kind: "left", n: value.n + 1 }))
                }
              >
                Orbit
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  setView((value) => ({ kind: "reset", n: value.n + 1 }))
                }
              >
                Reset
              </Button>
            </div>
          </div>
        </section>
        <aside
          aria-label="Incident Intelligence"
          className="flex min-h-0 flex-col border-l border-line bg-coal px-5 py-4"
        >
          <div className="flex items-center justify-between border-b border-line pb-3">
            <Label>Incident Intelligence</Label>
            <span className="font-mono text-xs text-gold">#4,118</span>
          </div>
          <section className="border-b border-line py-4">
            <Label>
              {core ? "Shared threat intelligence" : "Selected member"}
            </Label>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div
                role="heading"
                aria-level={2}
                className="text-xl font-medium"
              >
                {core ? "Quorum Core" : member.name}
              </div>
              <span
                className={`font-mono text-[10px] uppercase ${
                  member.id === "exA" && !core ? "text-alarm" : "text-amber"
                }`}
              >
                {core ? "Verified" : status(member)}
              </span>
            </div>
            <p className="mt-1 mb-3 text-xs text-dim">
              {core
                ? "ThreatRegistry · Network-wide protection"
                : `${member.kind} · ${
                    member.enf ? "Protected member" : "Awaiting enforcement"
                  }`}
            </p>
            <dl>
              <Row k="Protection">
                {core ? "94" : Math.round(member.level * 100)}%
              </Row>
              <Row k="Last signal" mono>
                {core ? "14:02:51" : member.ack}
              </Row>
              <Row k="Enforcement">
                {core || member.enf ? "Enabled" : "Pending"}
              </Row>
              <Row k="Policy">
                {core
                  ? "Shared registry match"
                  : member.enf
                    ? "Stricter Cosign review"
                    : "Application queued"}
              </Row>
            </dl>
          </section>
          <section className="border-b border-line py-4">
            <Label>Received threat intelligence</Label>
            <dl className="mt-2">
              <Row k="Threat entry" mono>
                #4,118
              </Row>
              <Row k="Address match" mono>
                {member.state === "Pending" && !core
                  ? "Awaiting receipt"
                  : "0x7a3f…91c2"}
              </Row>
              <Row k="Fingerprint" mono>
                decoy-wallet-touch
              </Row>
              <Row k="Acknowledged" mono>
                {core
                  ? "Network verified"
                  : member.id === "exA"
                    ? "Origin · 14:02:07"
                    : member.ack === "—"
                      ? "—"
                      : `+${Number(member.ack.slice(-2)) + (member.ack.startsWith("14:03") ? 60 : 0) - 7}s`}
              </Row>
            </dl>
          </section>
          <section className="min-h-0 pt-4">
            <Label>Network propagation</Label>
            <div className="mt-2 space-y-1">
              {nodes.map((node) => (
                <Button
                  key={node.id}
                  variant="ghost"
                  onClick={() => select(node.id)}
                  className={`!h-8 w-full !px-0 !text-xs !font-normal ${
                    selected === node.id ? "!text-cream" : "!text-dim"
                  }`}
                >
                  <span
                    className={
                      node.id === "exA"
                        ? "text-alarm"
                        : node.state === "Pending"
                          ? "text-mute"
                          : "text-gold"
                    }
                  >
                    {node.state === "Pending" ? "○" : "●"}
                  </span>
                  <span className="flex-1 text-left">{node.name}</span>
                  <span className="font-mono text-[10px]">{status(node)}</span>
                  <span className="w-16 text-right font-mono text-[10px]">
                    {node.id === "exA" ? "14:02:07" : node.ack}
                  </span>
                </Button>
              ))}
            </div>
            <Link
              to="/network?view=registry"
              className="mt-3 inline-block font-mono text-xs text-gold"
            >
              View all 38 ↗
            </Link>
          </section>
          <div className="mt-auto pt-3 font-mono text-[10px] text-mute">
            Evidence shared. Member data stays private.
          </div>
        </aside>
      </div>
    </div>
  )
}

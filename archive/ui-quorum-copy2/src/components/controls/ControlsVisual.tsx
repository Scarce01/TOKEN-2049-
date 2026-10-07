import { useEffect, useRef, useState } from "react"
import { Link } from "react-router"
import ControlScene, { objectState, type ObjectId } from "./ControlScene"
import type { Snapshot, Trigger } from "./data"
import { REPLAY_END, tone, visualStages, type Scenario } from "./visualState"

const button =
  "rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-dim transition-colors duration-150 hover:border-honey/50 hover:text-cream focus-visible:outline-2 focus-visible:outline-honey"
export default function ControlsVisual({
  data,
  trigger,
  vaultId,
  view,
  trustworthy,
  onTab,
  onTrigger,
  onVault,
  newEvents,
}: {
  data: Snapshot
  trigger: Trigger
  vaultId: string
  view: "triggers" | "vaults"
  trustworthy: boolean
  onTab: (tab: string) => void
  onTrigger: (id: string) => void
  onVault: (id: string) => void
  newEvents: number
}) {
  const isDemo = data.connection === "demo"
  const [time, setTime] = useState(REPLAY_END)
  const [playing, setPlaying] = useState(false)
  const [replay, setReplay] = useState(false)
  const [scenario, setScenario] = useState<Scenario>("recorded")
  const [selected, setSelected] = useState<ObjectId>(
    view === "vaults" ? vaultId as ObjectId : "honeypot",
  )
  const [panel, setPanel] = useState(true)
  const [evidence, setEvidence] = useState(false)
  const [evidenceStage, setEvidenceStage] = useState<string | null>(null)
  const [cameraKey, setCameraKey] = useState(0)
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  )
  const [liveWave, setLiveWave] = useState(-1)
  const prior = useRef<string | null>(null)
  const liveStart = useRef<number | null>(null)
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReduced(query.matches)
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  useEffect(() => {
    if (view === "vaults") setSelected(vaultId as ObjectId)
  }, [view, vaultId])
  useEffect(() => {
    setPlaying(false)
    setReplay(false)
    setTime(REPLAY_END)
    setScenario("recorded")
    setEvidence(false)
    prior.current = null
    liveStart.current = null
    setLiveWave(-1)
  }, [trigger.id, isDemo])
  useEffect(() => {
    const state =
      trigger.stages.find((stage) => stage.id === "detected")?.state ??
      "unavailable"
    if (
      !isDemo &&
      trustworthy &&
      prior.current !== null &&
      prior.current !== "detected" &&
      state === "detected"
    )
      liveStart.current = performance.now()
    prior.current = state
  }, [trigger.stages, isDemo, trustworthy])
  useEffect(() => {
    let frame = 0,
      previous = performance.now()
    const tick = (now: number) => {
      if (playing)
        setTime((value) =>
          Math.min(REPLAY_END, value + Math.min((now - previous) / 1000, 0.1)),
        )
      if (liveStart.current !== null) {
        const elapsed = (now - liveStart.current) / 1000
        setLiveWave(elapsed < 9 ? elapsed : -1)
        if (elapsed >= 9) liveStart.current = null
      }
      previous = now
      frame = requestAnimationFrame(tick)
    }
    if (playing || !isDemo) frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, isDemo])
  useEffect(() => {
    if (time >= REPLAY_END) setPlaying(false)
  }, [time])
  const stages = visualStages(
    trigger,
    time,
    replay && isDemo,
    scenario,
    trustworthy,
  )
  const selectedStage = stages.find(
    (stage) => stage.id === (selected === "honeypot" ? "detected" : selected),
  )
  const displayedEvidence =
    stages.find((stage) => stage.id === evidenceStage) ?? selectedStage
  const vault = data.vaults.find((item) => item.id === selected)
  const state = objectState(selected, stages)
  const confirmed = state === "confirmed"
  const detected =
    stages.find((stage) => stage.id === "detected")?.state === "detected"
  const active =
    stages.find((stage) => stage.state === "failed") ??
    stages.find((stage) => stage.state === "pending") ??
    [...stages]
      .reverse()
      .find(
        (stage) => stage.state === "confirmed" || stage.state === "detected",
      )
  const canReplay = isDemo && trigger.decoyId === "DW-07"
  const selectObject = (id: ObjectId) => {
    setSelected(id)
    setEvidence(false)
    setEvidenceStage(null)
    if (["hot", "warm", "cold"].includes(id)) onVault(id)
  }
  const reset = () => {
    setPlaying(false)
    setReplay(true)
    setTime(0)
    setEvidence(false)
  }
  const restriction = !trustworthy
    ? "Unavailable"
    : confirmed
      ? selected === "hot"
        ? "Withdrawals restricted"
        : selected === "warm"
          ? "Cosign-only"
          : "Timelock extended"
      : "No incident action confirmed"
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 text-cream">
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 text-xs">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-dim">Incident</span>
          <select
            aria-label="Select trigger"
            value={trigger.id}
            onChange={(event) => onTrigger(event.target.value)}
            className="h-8 max-w-[320px] rounded border border-white/10 bg-coal-2 px-2 text-cream"
          >
            {data.triggers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.decoyId} · {item.label}
              </option>
            ))}
          </select>
          <span className="hidden text-dim lg:block">
            {trigger.incidentId ?? "No associated incident"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {newEvents > 0 && (
            <span role="status" className="text-gold">
              {newEvents} new · selection retained
            </span>
          )}
          <button
            className={button}
            onClick={() => setPanel((value) => !value)}
          >
            {panel ? "Hide details" : "Show details"}
          </button>
        </div>
      </div>
      <div
        className={`grid min-h-0 flex-1 gap-3 ${
          panel
            ? "grid-cols-1 md:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_310px]"
            : "grid-cols-1"
        }`}
      >
        <section
          aria-label={`${view} interactive honeycomb scene`}
          className="relative min-h-0 overflow-hidden clip-hexcard border border-white/10 bg-coal-2"
        >
          <ControlScene
            stages={stages}
            selected={selected}
            onSelect={selectObject}
            view={view}
            wave={detected ? (replay ? time - 1 : liveWave) : -1}
            time={replay ? time : REPLAY_END}
            reduced={reduced}
            cameraKey={cameraKey}
          />
          <div className="pointer-events-none absolute left-4 top-4">
            <div className="text-[10px] tracking-[0.18em] text-dim">
              {view === "vaults" ? "VAULT TERRITORY" : "RESPONSE TOPOLOGY"}
            </div>
            <div className="mt-1 text-sm text-cream">
              {view === "vaults"
                ? "Height identifies vault type · not balance"
                : (active?.name ?? "Armed · awaiting detection")}
            </div>
          </div>
          <div className="absolute right-3 top-3 flex gap-2">
            <button
              className={`${button} bg-coal-2/90`}
              onClick={() => setCameraKey((value) => value + 1)}
            >
              Reset view
            </button>
            <button
              aria-pressed={reduced}
              className={`${button} bg-coal-2/90`}
              onClick={() => setReduced((value) => !value)}
            >
              Motion {reduced ? "off" : "on"}
            </button>
          </div>
          <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2">
            <div
              className="flex gap-1 rounded bg-coal-2/90 p-1"
              aria-label="Select scene object"
            >
              {(view === "vaults"
                ? ["hot", "warm", "cold"]
                : [
                    "honeypot",
                    "verification",
                    "accepted",
                    "hot",
                    "warm",
                    "cold",
                    "registry",
                  ]
              ).map((id) => (
                <button
                  key={id}
                  aria-pressed={selected === id}
                  onClick={() => selectObject(id as ObjectId)}
                  className={`rounded px-2 py-1.5 text-[10px] capitalize ${
                    selected === id
                      ? "bg-gold/20 text-cream"
                      : "text-dim hover:text-white"
                  }`}
                >
                  {id === "verification"
                    ? "CRE"
                    : id === "accepted"
                      ? "Receiver"
                      : id}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-dim">
              Drag to orbit · scroll to zoom
            </span>
          </div>
        </section>
        {panel && (
          <aside className="hidden md:flex min-h-0 flex-col overflow-hidden clip-hexcard border border-white/10 bg-coal-2">
            <div className="shrink-0 border-b border-white/10 p-3">
              <div className="mb-1 text-[10px] tracking-[0.15em] text-dim">
                {vault ? "VAULT CONTROL" : "INCIDENT CONTEXT"}
              </div>
              <h2 className="text-lg">
                {vault?.name ??
                  (selected === "honeypot"
                    ? trigger.decoyId
                    : selected === "verification"
                      ? "CRE verification"
                      : selected === "accepted"
                        ? "Receiver"
                        : "ThreatRegistry")}
              </h2>
              <span
                className="mt-1 block text-xs"
                style={{ color: tone(state) }}
              >
                {vault
                  ? restriction
                  : state.charAt(0).toUpperCase() + state.slice(1)}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {vault ? (
                <dl className="space-y-2 text-sm [&_dt]:text-[10px] [&_dd]:mt-0.5">
                  <div>
                    <dt className="text-xs text-dim">
                      Balance · latest snapshot, not replayed
                    </dt>
                    <dd className="mt-1 text-xl">
                      {trustworthy ? vault.balance : "Unavailable"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-dim">
                      Available withdrawal quota
                    </dt>
                    <dd className="mt-1">
                      {!trustworthy
                        ? "Unavailable"
                        : selected === "hot" && confirmed
                          ? "0 ETH"
                          : selected === "cold"
                            ? "Timelock only"
                            : "Not evidenced for this frame"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-dim">Current restriction</dt>
                    <dd className="mt-1">{restriction}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-dim">Expiry / delay</dt>
                    <dd className="mt-1">
                      {confirmed
                        ? selected === "warm"
                          ? "Until 20:02 UTC"
                          : selected === "cold"
                            ? "72 hours"
                            : "No expiry evidenced"
                        : "Unconfirmed"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-dim">
                      Latest confirmed action
                    </dt>
                    <dd className="mt-1">
                      {confirmed
                        ? selectedStage?.name
                        : "None in selected frame"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <>
                  <div className="mb-4 text-xs text-dim">
                    {trigger.exchange} · {trigger.incidentId ?? "No incident"}
                  </div>
                  <ol className="space-y-2">
                    {stages.map((stage) => (
                      <li key={stage.id}>
                        <button
                          onClick={() => {
                            if (stage.objectId)
                              selectObject(stage.objectId as ObjectId)
                            else if (stage.id === "detected")
                              selectObject("honeypot")
                            else if (
                              ["verification", "accepted", "registry"].includes(
                                stage.id,
                              )
                            )
                              selectObject(stage.id as ObjectId)
                            setEvidenceStage(stage.id)
                            setEvidence(true)
                          }}
                          className="flex w-full items-center justify-between gap-2 rounded py-1 text-left text-xs hover:bg-white/5"
                        >
                          <span className="text-cream">{stage.name}</span>
                          <span
                            className="shrink-0 text-[10px]"
                            style={{ color: tone(stage.state) }}
                          >
                            {stage.state}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              <button
                className="mt-5 text-xs text-gold hover:text-white"
                onClick={() => setEvidence((value) => !value)}
                aria-expanded={evidence}
              >
                {evidence ? "− Close evidence" : "+ Evidence & timestamps"}
              </button>
              {evidence && (
                <div className="mt-3 space-y-3 border-t border-white/10 pt-3 text-xs text-dim">
                  <p>
                    {displayedEvidence?.evidence ??
                      "No object-level evidence available."}
                  </p>
                  <p>{displayedEvidence?.time ?? "Time unavailable"}</p>
                  <p className="break-all">
                    {displayedEvidence?.transactionId ??
                      "No transaction evidence for this stage"}
                  </p>
                  {vault && <p>Address {vault.addr} · fixture identifier</p>}
                  <p>
                    CRE node-level telemetry unavailable. Submission is not
                    acceptance; acceptance is not action execution.
                  </p>
                  {stages.map((stage) => (
                    <div
                      key={stage.id}
                      className="border-t border-white/5 pt-2"
                    >
                      <span style={{ color: tone(stage.state) }}>
                        {stage.name} · {stage.state}
                      </span>
                      <p className="mt-1 leading-5">{stage.evidence}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="shrink-0 border-t border-white/10 p-3">
              <Link
                to={
                  trigger.incidentId
                    ? `/cases/${trigger.incidentId}?returnTo=${encodeURIComponent(`/controls${window.location.search}`)}`
                    : `/controls?tab=triggers&decoy=${trigger.decoyId}`
                }
                className="flex h-9 items-center justify-center rounded bg-honey text-sm font-medium text-ink hover:bg-flare"
              >
                {trigger.incidentId
                  ? "Review incident evidence ↗"
                  : "Review decoy ↗"}
              </Link>
              <p className="mt-2 text-center text-[10px] text-dim">
                {isDemo
                  ? "Read-only demo · no signing or execution"
                  : "Evidence review · no execution implied"}
              </p>
            </div>
          </aside>
        )}
      </div>
      <section
        aria-label="Event replay"
        className="flex shrink-0 flex-col gap-2 clip-hexcard border border-white/10 bg-coal-2 px-3 py-2.5"
      >
        <div className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-[10px] tracking-[0.1em] text-gold">
            {replay ? "DEMO REPLAY" : "EVENT SNAPSHOT"}
          </span>
          {canReplay ? (
            <>
              <button
                className={button}
                aria-label={playing ? "Pause replay" : "Play replay"}
                onClick={() => {
                  setReplay(true)
                  if (time >= REPLAY_END) setTime(0)
                  setPlaying((value) => !value)
                }}
              >
                {playing ? "Pause" : "Play"}
              </button>
              <button className={button} onClick={reset}>
                Reset
              </button>
              <input
                aria-label="Replay timestamp"
                type="range"
                min="0"
                max={REPLAY_END}
                step="0.05"
                value={time}
                onChange={(event) => {
                  setReplay(true)
                  setPlaying(false)
                  setTime(Number(event.target.value))
                }}
                className="min-w-0 flex-1 accent-gold"
              />
              <span className="w-16 text-right font-mono text-[10px] text-dim">
                {time.toFixed(1)} / 26s
              </span>
              <select
                aria-label="Demo scenario"
                value={scenario}
                onChange={(event) => {
                  setScenario(event.target.value as Scenario)
                  reset()
                }}
                className="max-w-[170px] rounded border border-white/10 bg-coal-2 px-2 py-1.5 text-[11px]"
              >
                <option value="recorded">Recorded outcomes</option>
                <option value="verification-failure">
                  Synthetic: verify fails
                </option>
                <option value="partial">Synthetic: partial response</option>
              </select>
            </>
          ) : (
            <span className="text-xs text-dim">
              {isDemo
                ? "No replay evidence for this trigger"
                : "Live transitions only · no timed stage advancement"}
            </span>
          )}
        </div>
        <div className="flex justify-between gap-2 overflow-hidden text-[9px] text-dim">
          <span>
            {active?.name ?? "Idle"} · {active?.state ?? "inactive"}
          </span>
          <span>
            {reduced
              ? "Reduced motion · final states retained"
              : "Terrain ripple = signal, not funds"}
          </span>
          <span>
            {isDemo ? "CRE telemetry unavailable" : "No node votes inferred"}
          </span>
        </div>
      </section>
    </div>
  )
}

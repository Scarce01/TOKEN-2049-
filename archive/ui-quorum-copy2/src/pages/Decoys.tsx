import { useMemo } from "react"
import { Link, useSearchParams } from "react-router"
import DecoyField, { ORIGIN, RECEIVERS } from "../components/decoys/DecoyField"
import { AGENCIES, DECOYS, HISTORY, ROTATION, confidence, type FieldDecoy } from "../components/decoys/data"
import { Button, DataTable, HexDot, Icon, Label, Meter, Mono, Panel, Row, StateBadge, VTimeline, type Status } from "../components/ui"

const TYPES = ["All", "Wallet", "Account", "Address", "API key", "Threshold", "Credential"] as const
const STATES = ["Any state", "Triggered", "Armed", "Rotating", "Retired"] as const
const level = (d: FieldDecoy): Status => (d.state === "Triggered" ? "threat" : d.state === "Rotating" ? "warning" : d.state === "Armed" ? "active" : "idle")

function Chip({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`h-7 rounded px-2.5 text-[12px] font-medium transition-colors ${on ? "bg-honey/15 text-honey" : "text-dim hover:text-cream"}`}
    >
      {children}
    </button>
  )
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone: "honey" | "alarm" | "amber" | "mute" | "cream" }) {
  const color = { honey: "text-honey", alarm: "text-alarm", amber: "text-amber", mute: "text-dim", cream: "text-cream" }[tone]
  return (
    <div className="min-w-0 px-5 py-4">
      <Label>{label}</Label>
      <div className={`mt-1.5 truncate text-[24px] font-semibold tabular-nums tracking-tight ${color}`}>{value}</div>
    </div>
  )
}

export default function Decoys() {
  const [params, setParams] = useSearchParams()
  const type = (params.get("type") ?? "All") as (typeof TYPES)[number]
  const state = (params.get("state") ?? "Any state") as (typeof STATES)[number]
  const selectedId = params.get("decoy")
  const inspect = params.get("view") === "inspect"
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) v == null ? next.delete(k) : next.set(k, v)
    setParams(next, { replace: true })
  }
  const rows = useMemo(
    () => DECOYS.filter((d) => (type === "All" || d.type === type) && (state === "Any state" || d.state === state)),
    [type, state],
  )
  const selected = DECOYS.find((d) => d.id === selectedId) ?? null
  const open = (id: string | null) => set({ decoy: id, view: id ? "inspect" : null })
  const count = (s: FieldDecoy["state"]) => DECOYS.filter((d) => d.state === s).length
  const covered = new Set(DECOYS.filter((d) => d.state !== "Retired").map((d) => d.agency)).size

  return (
    <div className="max-w-[1560px]">
      <header className="mb-5 flex items-end justify-between gap-6">
        <div>
          <Label>Defensive lure infrastructure</Label>
          <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-tight text-cream">Decoys</h1>
          <p className="mt-1.5 max-w-[640px] text-[14px] text-dim">
            Planted lures no legitimate flow ever touches. A touch is proof of probing, and Quorum relays it to every protected agency.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary">Rotation schedule</Button>
          <Button>
            <Icon name="plus" size={15} />
            Deploy decoy
          </Button>
        </div>
      </header>

      <Panel className="mb-5">
        <div className="grid grid-cols-7 divide-x divide-white/[0.05]">
          <Stat label="Active decoys" value={count("Armed") + count("Triggered")} tone="honey" />
          <Stat label="Triggered · 24h" value={count("Triggered")} tone="alarm" />
          <Stat label="Rotating" value={count("Rotating")} tone="amber" />
          <Stat label="False positives" value="0" tone="mute" />
          <Stat label="Agencies covered" value={`${covered}/${AGENCIES.length}`} tone="cream" />
          <Stat label="Deterministic" value="100%" tone="honey" />
          <Stat label="Last trigger" value={<span className="font-mono text-[20px]">14:02:07</span>} tone="alarm" />
        </div>
      </Panel>

      {inspect && selected ? (
        <Inspect decoy={selected} onClose={() => set({ view: null, decoy: null })} onSelect={open} />
      ) : (
        <>
          <section className="relative mb-5 h-[64vh] min-h-[520px] overflow-hidden clip-hexcard bg-coal">
            <DecoyField decoys={rows} selected={selectedId} focus={false} onSelect={open} />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_75%_at_50%_45%,transparent_55%,color-mix(in_srgb,var(--color-ink)_70%,transparent)_100%)]" />
            <div className="absolute left-5 top-4 flex flex-wrap items-center gap-1 rounded-md bg-ink/70 p-1 backdrop-blur-sm">
              {TYPES.map((t) => (
                <Chip key={t} on={type === t} onClick={() => set({ type: t === "All" ? null : t })}>
                  {t}
                </Chip>
              ))}
              <span className="mx-1 h-4 w-px bg-white/10" />
              {STATES.slice(1).map((s) => (
                <Chip key={s} on={state === s} onClick={() => set({ state: state === s ? null : s })}>
                  {s}
                </Chip>
              ))}
            </div>
            <button
              onClick={() => open(ORIGIN.id)}
              className="absolute right-5 top-4 w-[300px] rounded-md border border-alarm/50 bg-ink/80 px-4 py-3 text-left backdrop-blur-sm transition-colors hover:border-alarm"
            >
              <div className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.22em] text-alarm">
                <span className="blink inline-block h-1.5 w-1.5 rounded-full bg-alarm" />
                LIVE TRIGGER · 14:02:07
              </div>
              <div className="mt-1.5 text-[14px] font-semibold text-cream">
                {ORIGIN.id} · {ORIGIN.label}
              </div>
              <div className="mt-0.5 text-[12.5px] text-dim">
                {ORIGIN.host} · Deterministic · relayed to {RECEIVERS.length} agencies
              </div>
            </button>
            <div className="pointer-events-none absolute bottom-4 left-5 flex gap-4 rounded-md bg-ink/70 px-3 py-2 text-[11.5px] text-dim backdrop-blur-sm">
              <span className="flex items-center gap-1.5 text-honey"><HexDot status="active" />Armed</span>
              <span className="flex items-center gap-1.5 text-alarm"><HexDot status="threat" />Triggered</span>
              <span className="flex items-center gap-1.5 text-amber"><HexDot status="warning" />Rotating</span>
              <span className="flex items-center gap-1.5 text-mute"><HexDot status="idle" />Retired</span>
            </div>
            <div className="pointer-events-none absolute bottom-4 right-5 font-mono text-[10.5px] tracking-[0.18em] text-mute">
              DRAG TO ORBIT · SCROLL TO ZOOM · CLICK A BEACON
            </div>
          </section>

          <div className="grid grid-cols-[1fr_420px] gap-5">
            <Panel title={`Decoy inventory · ${rows.length}`}>
              <DataTable
                rows={rows}
                rowKey={(d) => d.id}
                selected={selectedId}
                onSelect={(d) => open(d.id)}
                cols={[
                  { key: "id", label: "Decoy", render: (d) => <Mono>{d.id}</Mono> },
                  { key: "type", label: "Type", render: (d) => <span className="text-dim">{d.type}</span> },
                  { key: "lure", label: "Lure", render: (d) => <span className="text-cream">{d.label}</span> },
                  { key: "host", label: "Agency", render: (d) => d.host },
                  { key: "rot", label: "Rotation", render: (d) => <span className="text-dim">{ROTATION[d.type]}</span> },
                  { key: "commit", label: "Commitment", render: (d) => <span className="font-mono text-[12px] text-dim">{d.commit}</span> },
                  { key: "conf", label: "Confidence", render: (d) => <span className={d.hits ? "text-cream" : "text-mute"}>{confidence(d)}</span> },
                  { key: "hits", label: "Hits", align: "right", render: (d) => <span className={`tabular-nums ${d.hits ? "text-cream" : "text-mute"}`}>{d.hits}</span> },
                  { key: "state", label: "State", render: (d) => <StateBadge state={d.state} /> },
                ]}
              />
            </Panel>
            <Panel title="Trigger history">
              <div className="px-5 pb-5">
                <VTimeline
                  items={HISTORY.map((h) => ({
                    t: h.t,
                    level: h.level,
                    title: (
                      <button onClick={() => open(h.id)} className="text-left hover:text-honey">
                        <span className="font-mono text-honey">{h.id}</span> · {h.act}
                      </button>
                    ),
                    body: `${h.agency} → ${h.flow}`,
                  }))}
                />
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/[0.05] px-7 py-5">
      <Label>{title}</Label>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Inspect({ decoy, onClose, onSelect }: { decoy: FieldDecoy; onClose: () => void; onSelect: (id: string) => void }) {
  const triggered = decoy.state === "Triggered"
  const siblings = DECOYS.filter((d) => d.agency === decoy.agency && d.id !== decoy.id)
  const steps = [
    { t: decoy.lastHit.split(" ")[0], title: "Lure touched", body: decoy.type === "Account" ? "3 login probes against canary account" : "Outbound transfer signed from lure", level: "threat" as Status },
    { t: "+0.4s", title: "Matched DecoyCommit", body: `${decoy.commit} · deterministic proof`, level: "active" as Status },
    { t: "+11s", title: "Local node verified", body: `${decoy.host} Quorum node · vaults tightened`, level: "active" as Status },
    { t: "+24s", title: "Relayed via Quorum Core", body: `ThreatRegistry #4,118 → ${RECEIVERS.length} agencies acknowledged`, level: "active" as Status },
  ]
  return (
    <div className="grid h-[calc(100vh-220px)] min-h-[620px] grid-cols-2 gap-5">
      <section className="relative overflow-hidden clip-hexcard bg-coal">
        <DecoyField decoys={DECOYS} selected={decoy.id} focus onSelect={(id) => id && onSelect(id)} />
        <button onClick={onClose} className="absolute left-5 top-4 flex h-8 items-center gap-2 rounded-md bg-ink/80 px-3 text-[12.5px] text-cream backdrop-blur-sm hover:text-honey">
          ← Lure field
        </button>
        <div className="pointer-events-none absolute bottom-4 left-5 font-mono text-[10.5px] tracking-[0.18em] text-mute">
          {decoy.host.toUpperCase()} DISTRICT · DRAG TO ROTATE
        </div>
      </section>

      <Panel className="flex flex-col overflow-y-auto">
        <div className="px-7 pb-5 pt-6">
          <div className="flex items-center gap-3">
            <span className={`font-mono text-[12px] tracking-[0.2em] ${triggered ? "text-alarm" : "text-honey"}`}>{decoy.id}</span>
            <StateBadge state={decoy.state} />
          </div>
          <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-tight text-cream">{decoy.label}</h2>
          <div className="mt-1 text-[14px] text-dim">
            {decoy.type} decoy · {decoy.host}
          </div>
        </div>

        {triggered && (
          <div className="mx-7 mb-5 rounded-md border border-alarm/40 bg-alarm/[0.07] px-5 py-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Confidence</Label>
                <div className="mt-1 text-[16px] font-semibold text-cream">{confidence(decoy)}</div>
              </div>
              <div>
                <Label>Propagation</Label>
                <div className="mt-1 text-[16px] font-semibold text-honey">{RECEIVERS.length}/{RECEIVERS.length} acked</div>
              </div>
              <div>
                <Label>Incident</Label>
                <Link to="/cases/QRM-78452" className="mt-1 block text-[16px] font-semibold text-cream hover:text-honey">QRM-78452 →</Link>
              </div>
            </div>
          </div>
        )}

        <Section title="Lure">
          <Row k="Lure strength"><div className="w-[220px]"><Meter value={decoy.lure} label="Lure" /></div></Row>
          <Row k="Reference" mono>{decoy.ref}</Row>
          <Row k="Rotation policy">{ROTATION[decoy.type]}</Row>
          <Row k="Deployed">{decoy.deployed}</Row>
          <Row k="Commitment" mono>{decoy.commit} · verified</Row>
        </Section>

        <Section title="Triggers">
          <Row k="Trigger count">{decoy.hits}</Row>
          <Row k="Last trigger">{decoy.lastHit}</Row>
          <Row k="Confidence">{confidence(decoy)}</Row>
        </Section>

        {decoy.hits > 0 && decoy.state !== "Retired" && (
          <Section title="Trigger path">
            <VTimeline items={steps} />
          </Section>
        )}

        {triggered && (
          <Section title="Agencies notified">
            <div className="flex flex-wrap gap-2">
              {RECEIVERS.map((r) => (
                <span key={r.id} className="inline-flex h-8 items-center gap-2 rounded-md border border-honey/25 px-3 text-[12.5px] text-cream">
                  <span className="text-honey"><HexDot status="active" /></span>
                  {r.name}
                </span>
              ))}
            </div>
          </Section>
        )}

        {siblings.length > 0 && (
          <Section title={`Other decoys in ${decoy.host}`}>
            <div className="flex flex-wrap gap-2">
              {siblings.map((d) => (
                <button key={d.id} onClick={() => onSelect(d.id)} className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 px-3 text-[12.5px] text-cream hover:border-honey/50">
                  <span className={d.state === "Triggered" ? "text-alarm" : d.state === "Rotating" ? "text-amber" : d.state === "Retired" ? "text-mute" : "text-honey"}>
                    <HexDot status={level(d)} />
                  </span>
                  <span className="font-mono">{d.id}</span>
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title="Recommended next action">
          <p className="text-[14px] text-cream">
            {triggered
              ? "Rotate this lure after evidence capture and review the linked incident."
              : decoy.state === "Rotating"
                ? "Confirm the new commitment once the 24h timelock clears."
                : decoy.state === "Retired"
                  ? "No action. Kept for audit history."
                  : "No action. The lure is armed and committed."}
          </p>
        </Section>
      </Panel>
    </div>
  )
}

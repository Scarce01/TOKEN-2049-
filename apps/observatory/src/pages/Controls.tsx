import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { Button, Panel, Row, Tabs } from "../components/ui"
import ControlsVisual from "../components/controls/ControlsVisual"
import {
  demoControlsAdapter,
  type ControlsAdapter,
  type Snapshot,
} from "../components/controls/data"

const tabs = [
  "Triggers",
  "Vaults",
  "Requests",
  "Approvals",
  "Policies",
  "Activity",
] as const
type Tab = typeof tabs[number]
const aliases: Record<string, string> = {
  traps: "triggers",
  config: "policies",
  workflows: "activity",
  execution: "activity",
  reports: "activity",
}
const input =
  "h-9 min-w-0 rounded-md border border-white/10 bg-coal-3 px-3 text-xs text-cream focus-visible:outline-2 focus-visible:outline-honey"
function State({ value }: { value: string }) {
  return (
    <span
      className={`text-xs ${
        /reject|fail|mismatch/i.test(value)
          ? "text-threat"
          : /pending|held|queued|partial|escalated/i.test(value)
            ? "text-amber"
            : "text-dim"
      }`}
    >
      {value}
    </span>
  )
}
function Journey({ nodes }: { nodes: {
  title: string
  state: string
}[] }) {
  const completed = (state: string) => {
    const counts = state.match(/^(\d+)\s*\/\s*(\d+) recorded$/i)
    return counts ? Number(counts[1]) >= Number(counts[2]) : /^(recorded|verified|confirmed|executed|recorded applied|approved|detected|applied|not required)$/i.test(state)
  }
  const activeIndex = nodes.findIndex((node) => /pending|hold|queued|partial/i.test(node.state) || (/^\d+\s*\/\s*\d+ recorded$/i.test(node.state) && !completed(node.state)))
  return (
    <div className="hive-journey relative isolate flex items-start py-6" role="list" aria-label="Timeline stages">
      <div aria-hidden="true" className="hive-pattern honeycomb pointer-events-none absolute inset-0 -z-10" />
      {nodes.map((node, index) => (
        <div
          key={node.title}
          className="relative flex min-w-0 flex-1 flex-col items-center text-center"
          role="listitem"
          aria-current={index === activeIndex ? "step" : undefined}
        >
          {index > 0 && (
            <div aria-hidden="true" className={`hive-connector pointer-events-none absolute right-1/2 top-5 w-full ${completed(nodes[index - 1].state) && (completed(node.state) || index === activeIndex) ? "hive-live" : "hive-future"}`}>
              <span className="hive-liquid" /><span className="hive-highlight" /><span className="hive-droplet" /><span className="hive-droplet hive-droplet-late" />
            </div>
          )}
          {index === activeIndex && <div aria-hidden="true" className="hive-pool honeycomb pointer-events-none absolute top-0 h-10 w-11" />}
          <span
            aria-hidden="true"
            className={`hive-stage relative z-10 grid h-10 w-11 place-items-center clip-hex font-mono text-sm ${
              /rejected|failed/i.test(node.state)
                ? "bg-threat/30 text-threat"
                : index === activeIndex
                  ? "hive-active bg-amber/70 text-amber"
                  : completed(node.state) ? "hive-done bg-gold/50 text-gold" : "bg-white/10 text-dim"
            }`}
          >
            <span className="relative z-10">{/rejected|failed/i.test(node.state)
              ? "!"
              : completed(node.state)
                ? "✓"
                : "·"}</span>
          </span>
          <span className="mt-3 text-xs text-cream">{node.title}</span>
          <span className="mt-1">
            <State value={node.state} />
          </span>
        </div>
      ))}
    </div>
  )
}

export default function Controls({
  adapter = demoControlsAdapter,
}: {
  adapter?: ControlsAdapter
}) {
  const [params, setParams] = useSearchParams()
  const raw = params.get("tab") ?? "triggers"
  const tab =
    tabs.find((item) => item.toLowerCase() === (aliases[raw] ?? raw)) ??
    "Triggers"
  const key = tab.toLowerCase()
  const [data, setData] = useState<Snapshot | null>(null)
  const [error, setError] = useState("")
  const [showDetail, setShowDetail] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    adapter
      .read(controller.signal)
      .then(setData)
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error))
      })
    const unsubscribe = adapter.subscribe?.(setData)
    return () => {
      controller.abort()
      unsubscribe?.()
    }
  }, [adapter])
  const update = (values: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params)
    Object.entries(values).forEach(([name, value]) =>
      value === null ? next.delete(name) : next.set(name, value),
    )
    setParams(next, { replace })
  }
  const query = params.get(`${key}.q`) ?? ""
  const filter = params.get(`${key}.state`) ?? "All"
  const evidence = params.get("evidence") === "open"
  if (!data)
    return <div className="text-dim">{error || "Loading Controls…"}</div>
  const isDemo = data.connection === "demo"
  const trustworthy =
    isDemo ||
    (data.connection !== "stale" &&
      data.connection !== "disconnected" &&
      data.connection !== "failed" &&
      data.connection !== "permission-denied" &&
      Date.now() - Date.parse(data.updatedAt) < 60000)
  const triggerId =
    params.get("triggers.id") ??
    (params.get("decoy") ? `trigger-${params.get("decoy")}` : "trigger-DW-07")
  const trigger =
    data.triggers.find((item) => item.id === triggerId) ?? data.triggers[0]
  const vaultId = params.get("vaults.id") ?? params.get("vault") ?? "hot"
  const selection = params.get(`${key}.id`) ?? params.get("id")
  const request =
    data.requests.find((item) => item.id === selection) ?? data.requests[0]
  const approval =
    data.approvals.find((item) => item.id === selection) ?? data.approvals[0]
  const proposal =
    data.proposals.find((item) => item.id === selection) ??
    data.proposals.find((item) => item.state === "Queued") ??
    data.proposals[0]
  const run = data.runs.find((item) => item.id === selection) ?? data.runs[0]
  const linkedTrigger = data.triggers.find((item) => item.runId === run.id)
  const requestRun = data.runs.find((item) => item.ref === request.id)
  const incidentId =
    tab === "Requests" && /QRM-78452/.test(request.note)
      ? "QRM-78452"
      : tab === "Activity"
        ? linkedTrigger?.incidentId
        : undefined
  const recordedAt = Date.parse(`2026-10-05T${request.t}Z`)
  const waiting = Math.max(
    0,
    Math.floor((Date.parse(data.updatedAt) - recordedAt) / 1000),
  )
  const waitLabel = `${Math.floor(waiting / 60)}m ${waiting % 60}s at snapshot`
  const rows =
    tab === "Requests"
      ? data.requests.map((item) => ({
          id: item.id,
          label: `${item.amount} ${item.asset}`,
          state: item.state,
          sub: item.t,
          workflow: "",
          incident: /QRM-78452/.test(item.note),
        }))
      : tab === "Approvals"
        ? data.approvals.map((item) => ({
            id: item.id,
            label: item.action,
            state: item.state,
            sub: item.vault,
            workflow: "",
            incident: false,
          }))
        : tab === "Policies"
          ? [...data.proposals]
              .sort(
                (a, b) =>
                  Number(b.state === "Queued") - Number(a.state === "Queued"),
              )
              .map((item) => ({
                id: item.id,
                label: item.key,
                state: item.state,
                sub: item.path,
                workflow: "",
                incident: false,
              }))
          : data.runs.map((item) => ({
              id: item.id,
              label: `${item.wf} · ${item.result}`,
              state: item.state,
              sub: item.t,
              workflow: item.wf,
              incident: data.triggers.some(
                (trigger) => trigger.runId === item.id && trigger.incidentId,
              ),
            }))
  const visibleRows = rows.filter(
    (item) =>
      `${item.id} ${item.label} ${item.sub}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "All" || item.state === filter) &&
      (tab !== "Activity" ||
        !params.get("workflow") ||
        params.get("workflow") === "All" ||
        item.workflow === params.get("workflow")) &&
      (tab !== "Activity" ||
        params.get("incident") !== "linked" ||
        item.incident) &&
      (tab !== "Activity" ||
        params.get("time") !== "recent" ||
        item.sub >= "14:02:00"),
  )
  const selectedId =
    tab === "Requests"
      ? request.id
      : tab === "Approvals"
        ? approval.id
        : tab === "Policies"
          ? proposal.id
          : run.id
  const goTab = (next: string) => {
    update({ tab: next.toLowerCase(), id: null, evidence: null })
    setShowDetail(false)
  }
  const returnUrl = `/controls?${params.toString()}`
  const evidenceRecord =
    tab === "Requests"
      ? request
      : tab === "Approvals"
        ? approval
        : tab === "Policies"
          ? proposal
          : run
  const rejected = request.state === "Rejected"
  const hold = request.state !== "Approved" && !rejected
  const decisionStage = request.invalid
    ? 0
    : request.gate && request.gate >= 6
      ? 3
      : 1
  const requestNodes = [
    "Request recorded",
    "Cosign verdict",
    "Receiver record",
    "Vault execution",
  ].map((title, index) => ({
    title,
    state: rejected
      ? index < decisionStage
        ? "Recorded"
        : index === decisionStage
          ? "Rejected"
          : "Not reached"
      : hold
        ? index < decisionStage
          ? "Recorded"
          : index === decisionStage
            ? "Pending / hold"
            : "Unknown"
        : index === 0
          ? "Recorded"
          : index === 1
            ? request.cosign
              ? "Approved"
              : "Not required"
            : "Unknown",
  }))
  const approvalParts = approval.detail.split("→")
  const policyApproval = data.approvals.find((item) =>
    item.detail.includes(proposal.id),
  )
  const approvalCurrent =
    approval.action === "Manual release"
      ? (data.vaults.find((item) => item.name === approval.vault)
          ?.restriction ?? "Restriction unavailable")
      : approvalParts[0]
  const approvalProposed =
    approval.action === "Manual release"
      ? approval.detail
      : (approvalParts[1] ?? approval.detail)
  const operatorSigned = approval.signed.includes("M. Kovač")
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex h-9 shrink-0 items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold">Controls</h1>
          <span className="hidden text-xs text-dim sm:inline">
            Bybit / Ethereum
          </span>
        </div>
        <span className="text-xs text-amber">
          {isDemo ? "DEMO · recorded fixture" : data.connection}
        </span>
      </header>
      <div className="shrink-0 overflow-x-auto">
        <Tabs tabs={tabs} value={tab} onChange={goTab} />
      </div>
      {tab === "Triggers" || tab === "Vaults" ? (
        <div className="min-h-0 flex-1">
          <ControlsVisual
            data={data}
            trigger={trigger}
            vaultId={vaultId}
            view={tab === "Triggers" ? "triggers" : "vaults"}
            trustworthy={trustworthy}
            onTab={goTab}
            onTrigger={(id) => update({ "triggers.id": id })}
            onVault={(id) => update({ "vaults.id": id })}
            newEvents={0}
          />
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 text-xs text-dim">
            <span className="mr-auto">
              {tab === "Requests"
                ? "Withdrawal request queue"
                : tab === "Approvals"
                  ? "Pending decisions & signature history"
                  : tab === "Policies"
                    ? "Configuration changes · integrity telemetry unavailable"
                    : "Workflow execution history"}
            </span>
            <Button
              variant="secondary"
              onClick={() => update({ evidence: evidence ? null : "open" })}
            >
              {evidence ? "Close evidence" : "Open evidence"}
            </Button>
            <button
              className="text-honey md:hidden"
              onClick={() => setShowDetail(!showDetail)}
            >
              {showDetail ? "Queue" : "Detail"}
            </button>
          </div>
          <div className="relative grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[260px_minmax(0,1fr)]">
            <Panel
              className={`${
                showDetail ? "hidden md:flex" : "flex"
              } min-h-0 flex-col`}
            >
              <div className="shrink-0 space-y-2 border-b border-white/5 p-3">
                <input
                  aria-label={`Search ${tab}`}
                  placeholder={`Search ${tab.toLowerCase()}…`}
                  value={query}
                  onChange={(event) =>
                    update({ [`${key}.q`]: event.target.value }, true)
                  }
                  className={`${input} w-full`}
                />
                <select
                  aria-label="Status filter"
                  value={filter}
                  onChange={(event) =>
                    update({ [`${key}.state`]: event.target.value }, true)
                  }
                  className={`${input} w-full`}
                >
                  <option>All</option>
                  {[...new Set(rows.map((item) => item.state))].map((state) => (
                    <option key={state}>{state}</option>
                  ))}
                </select>
                {tab === "Activity" && (
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      aria-label="Workflow filter"
                      value={params.get("workflow") ?? "All"}
                      onChange={(event) =>
                        update({ workflow: event.target.value }, true)
                      }
                      className={input}
                    >
                      <option>All</option>
                      {[...new Set(data.runs.map((item) => item.wf))].map(
                        (wf) => (
                          <option key={wf}>{wf}</option>
                        ),
                      )}
                    </select>
                    <select
                      aria-label="Time filter"
                      value={params.get("time") ?? "snapshot"}
                      onChange={(event) =>
                        update({ time: event.target.value }, true)
                      }
                      className={input}
                    >
                      <option value="snapshot">Snapshot</option>
                      <option value="recent">14:02 onward</option>
                    </select>
                    <select
                      aria-label="Incident filter"
                      value={params.get("incident") ?? "all"}
                      onChange={(event) =>
                        update({ incident: event.target.value }, true)
                      }
                      className={`${input} col-span-2`}
                    >
                      <option value="all">All incidents</option>
                      <option value="linked">QRM-78452 linked</option>
                    </select>
                  </div>
                )}
              </div>
              <div
                key={key}
                className="min-h-0 flex-1 overflow-y-auto"
                ref={(element) => {
                  if (element)
                    element.scrollTop = Number(
                      sessionStorage.getItem(`controls.scroll.${key}`) ?? 0,
                    )
                }}
                onScroll={(event) =>
                  sessionStorage.setItem(
                    `controls.scroll.${key}`,
                    String(event.currentTarget.scrollTop),
                  )
                }
              >
                {visibleRows.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      update({
                        [`${key}.id`]: item.id,
                        id: null,
                        evidence: null,
                      })
                      setShowDetail(true)
                    }}
                    className={`block w-full border-b border-white/5 border-l-2 p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-honey ${
                      selectedId === item.id
                        ? "border-l-honey bg-honey/5"
                        : "border-l-transparent hover:bg-coal-3"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-cream">
                        {item.id}
                      </span>
                      <State value={item.state} />
                    </div>
                    <div className="mt-2 text-sm text-cream">{item.label}</div>
                    <div className="mt-1 truncate text-xs text-dim">
                      {item.sub}
                      {tab === "Requests" &&
                      !/Rejected|Approved/.test(item.state)
                        ? ` · ${Math.max(0, Math.floor((Date.parse(data.updatedAt) - Date.parse(`2026-10-05T${item.sub}Z`)) / 60000))}m waiting`
                        : ""}
                    </div>
                  </button>
                ))}
                {!visibleRows.length && (
                  <p className="p-4 text-sm text-dim">No matching records.</p>
                )}
              </div>
            </Panel>
            <Panel
              className={`${
                showDetail ? "flex" : "hidden md:flex"
              } min-h-0 flex-col`}
            >
              <div className="min-h-0 flex-1 overflow-y-auto p-5 lg:p-7">
                <div className="mb-5 flex justify-between gap-3">
                  <span className="font-mono text-xs text-dim">
                    {selectedId}
                  </span>
                  <State
                    value={
                      tab === "Requests"
                        ? request.state
                        : tab === "Approvals"
                          ? approval.state
                          : tab === "Policies"
                            ? proposal.state
                            : run.state
                    }
                  />
                </div>
                {tab === "Requests" && (
                  <>
                    <div className="flex flex-wrap items-baseline gap-3">
                      <h2 className="text-3xl font-semibold tabular-nums">
                        {request.amount}{" "}
                        <span className="text-xl text-dim">
                          {request.asset}
                        </span>
                      </h2>
                      <span className="text-sm text-dim">{request.usd}</span>
                    </div>
                    <h3
                      className={`mt-4 text-lg ${
                        rejected
                          ? "text-threat"
                          : hold
                            ? "text-amber"
                            : "text-cream"
                      }`}
                    >
                      {rejected
                        ? "Request rejected"
                        : hold
                          ? `${request.state} · ${request.constraint}`
                          : "Approved · execution unconfirmed"}
                    </h3>
                    {rejected && (
                      <p className="mt-2 text-sm text-dim">
                        {request.constraint}
                      </p>
                    )}
                    {hold && (
                      <p className="mt-2 text-xs text-dim">
                        Waiting {waitLabel}
                      </p>
                    )}
                    <Journey nodes={requestNodes} />
                    <p className="mb-5 border-l-2 border-gold/30 pl-3 text-sm leading-6 text-dim">
                      {request.note}
                    </p>
                    <dl>
                      <Row k="Source">
                        {request.source} · {request.from}
                      </Row>
                      <Row k="Destination" mono>
                        {request.to}
                      </Row>
                      <Row k="Related incident">
                        {incidentId ? (
                          <Link
                            className="text-honey hover:underline"
                            to={`/cases/${incidentId}?returnTo=${encodeURIComponent(returnUrl)}`}
                          >
                            {incidentId} ↗
                          </Link>
                        ) : (
                          "No incident linked in this record"
                        )}
                      </Row>
                    </dl>
                  </>
                )}
                {tab === "Approvals" && (
                  <>
                    <h2 className="text-xl font-semibold">
                      {approval.action} · {approval.vault}
                    </h2>
                    <div className="my-6 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                      <div className="border border-white/10 bg-coal p-5">
                        <p className="mb-3 text-xs text-dim">Current value</p>
                        <p className="text-lg">{approvalCurrent}</p>
                      </div>
                      <span className="text-gold">→</span>
                      <div className="border border-gold/25 bg-coal p-5">
                        <p className="mb-3 text-xs text-dim">Proposed value</p>
                        <p className="text-lg text-honey">{approvalProposed}</p>
                      </div>
                    </div>
                    <p className="text-sm">
                      {approval.signed.length} / {approval.required} signatures
                      collected
                    </p>
                    <div
                      className="my-3 flex gap-2"
                      aria-label={`${approval.signed.length} of ${approval.required} signatures`}
                    >
                      {Array.from({ length: approval.required }, (_, index) => (
                        <span
                          key={index}
                          className={`h-2 w-14 ${
                            index < approval.signed.length
                              ? "bg-gold"
                              : "bg-coal-3 border border-white/10"
                          }`}
                        />
                      ))}
                    </div>
                    <dl>
                      <Row k="Signers">
                        {approval.signed.join(" · ") || "None recorded"}
                      </Row>
                      <Row k="Expiry / wait">{approval.expiry}</Row>
                      <Row k="Eligibility">
                        {approval.state === "Queued"
                          ? "Timelock eligibility is not confirmed by chain evidence"
                          : operatorSigned
                            ? "M. Kovač has already signed"
                            : "Operator permissions and wallet connection unavailable"}
                      </Row>
                      <Row k="Consequence">{approval.detail}</Row>
                    </dl>
                  </>
                )}
                {tab === "Policies" && (
                  <>
                    <h2 className="text-xl font-semibold">{proposal.key}</h2>
                    <p className="mt-2 text-sm text-dim">
                      {proposal.state === "Queued"
                        ? "Proposed change · execution not confirmed"
                        : `${proposal.state} configuration change`}
                    </p>
                    <div className="my-6 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                      <div className="border border-white/10 bg-coal p-5">
                        <p className="mb-3 text-xs text-dim">
                          {proposal.state === "Applied"
                            ? "Previous"
                            : "Current"}
                        </p>
                        <p className="text-2xl">{proposal.from}</p>
                      </div>
                      <span className="text-gold">→</span>
                      <div className="border border-gold/25 bg-coal p-5">
                        <p className="mb-3 text-xs text-dim">
                          {proposal.state === "Applied"
                            ? "Recorded value"
                            : "Proposed"}
                        </p>
                        <p className="text-2xl text-honey">{proposal.to}</p>
                      </div>
                    </div>
                    <Journey
                      nodes={
                        proposal.path.includes("fast-path")
                          ? [
                              { title: "Tightening report", state: "Recorded" },
                              { title: "Receiver", state: "Unknown" },
                              { title: "Configuration", state: proposal.state },
                            ]
                          : [
                              { title: "Proposed", state: "Recorded" },
                              {
                                title: "Signatures",
                                state: policyApproval
                                  ? `${policyApproval.signed.length} / ${policyApproval.required} recorded`
                                  : "Unknown",
                              },
                              {
                                title: "Queued",
                                state:
                                  proposal.state === "Queued"
                                    ? "Queued"
                                    : "Unknown",
                              },
                              { title: "Eligible", state: "Unknown" },
                              {
                                title: "Executed",
                                state:
                                  proposal.state === "Applied"
                                    ? "Recorded applied"
                                    : proposal.state === "Rejected"
                                      ? "Not reached"
                                      : "Unconfirmed",
                              },
                            ]
                      }
                    />
                    <dl>
                      <Row k="Change path">{proposal.path}</Row>
                      <Row k="Proposed by">{proposal.by}</Row>
                      <Row k="Observed at">{proposal.t}</Row>
                      <Row k="Integrity">
                        Expected / observed hashes unavailable. No mismatch or
                        healthy state inferred.
                      </Row>
                    </dl>
                    <details className="mt-4 text-xs text-dim">
                      <summary className="cursor-pointer">
                        Unchanged fields
                      </summary>
                      <p className="mt-2">
                        Full configuration snapshot unavailable.
                      </p>
                    </details>
                  </>
                )}
                {tab === "Activity" && (
                  <>
                    <h2 className="text-xl font-semibold">
                      {run.wf} workflow · {run.result}
                    </h2>
                    <p
                      className={`mt-2 text-sm ${
                        run.state === "Partial" ? "text-amber" : "text-dim"
                      }`}
                    >
                      {run.state === "Partial"
                        ? "Partial verification · reason unavailable"
                        : "Workflow verdict recorded · downstream effects tracked separately"}
                    </p>
                    <p className="mt-2 font-mono text-xs text-dim">
                      {run.t} UTC · duration {run.dur}
                    </p>
                    <Journey
                      nodes={[
                        {
                          title: linkedTrigger
                            ? "Trigger"
                            : "Request / trigger",
                          state: linkedTrigger
                            ? "Detected"
                            : "Record unavailable",
                        },
                        { title: "Workflow run", state: run.state },
                        {
                          title: "Report",
                          state: linkedTrigger?.reportId
                            ? "Recorded"
                            : "Unknown",
                        },
                        {
                          title: "Receiver",
                          state:
                            linkedTrigger?.stages.find(
                              (stage) => stage.id === "accepted",
                            )?.state ?? "Unknown",
                        },
                      ]}
                    />
                    <h3 className="mb-3 text-xs uppercase tracking-wider text-dim">
                      Independent action results
                    </h3>
                    {linkedTrigger ? (
                      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                        {linkedTrigger.stages
                          .filter(
                            (stage) =>
                              stage.objectId ||
                              stage.id === "registry" ||
                              stage.id === "sweep",
                          )
                          .map((stage) => (
                            <div
                              key={stage.id}
                              className="border-l border-gold/30 bg-coal p-3"
                            >
                              <div className="flex justify-between gap-2 text-sm">
                                <span>{stage.name}</span>
                                <State value={stage.state} />
                              </div>
                              <p className="mt-1 font-mono text-xs text-dim">
                                {stage.time}
                              </p>
                              <p className="mt-2 text-xs leading-5 text-dim">
                                {stage.evidence}
                              </p>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="border-l border-amber/40 pl-3 text-sm text-dim">
                        Receiver acceptance and individual action telemetry
                        unavailable. No successful execution inferred from the
                        workflow verdict.
                      </p>
                    )}
                    <dl className="mt-5">
                      <Row k="Reference">{run.ref}</Row>
                      <Row k="CRE telemetry">
                        Node-level telemetry unavailable
                      </Row>
                    </dl>
                  </>
                )}
              </div>
              <div className="shrink-0 border-t border-white/5 px-5 py-3 text-xs text-dim">
                {tab === "Approvals"
                  ? "Signing unavailable · read-only fixture, no wallet or authorization adapter"
                  : tab === "Requests"
                    ? "No execution action supported · verdict is not a transfer"
                    : tab === "Policies"
                      ? "Change submission unavailable · read-only configuration history"
                      : "Recorded effects only · no live execution connection"}
              </div>
            </Panel>
            {evidence && (
              <aside
                role="dialog"
                aria-label="Record evidence"
                className="absolute inset-y-0 right-0 z-20 flex w-full max-w-lg flex-col border border-white/10 bg-coal shadow-2xl"
              >
                <header className="flex shrink-0 items-center justify-between border-b border-white/10 p-4">
                  <span className="font-mono text-sm">
                    Evidence · {selectedId}
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() => update({ evidence: null })}
                  >
                    Close
                  </Button>
                </header>
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
                  <section>
                    <h3 className="mb-2 text-sm text-cream">Backend says</h3>
                    <p className="text-xs leading-5 text-dim">
                      {isDemo
                        ? "Isolated demo fixture · not authorized live server evidence"
                        : `Adapter snapshot · ${data.connection}`}
                    </p>
                    <pre className="mt-3 whitespace-pre-wrap break-all font-mono text-xs leading-5 text-dim">
                      {JSON.stringify(evidenceRecord, null, 2)}
                    </pre>
                  </section>
                  <section>
                    <h3 className="mb-2 text-sm">User signed</h3>
                    <p className="text-xs text-dim">
                      {tab === "Requests"
                        ? (request.invalid?.sig ??
                          "Raw user signature unavailable; request verdict is not signature proof")
                        : tab === "Approvals"
                          ? `${approval.signed.join(", ") || "No signers recorded"} · raw signatures unavailable`
                          : "Signature evidence unavailable"}
                    </p>
                  </section>
                  <section>
                    <h3 className="mb-2 text-sm">Chain facts</h3>
                    <p className="text-xs leading-5 text-dim">
                      No live chain connection.{" "}
                      {tab === "Requests"
                        ? "Receiver acceptance and transfer transaction unconfirmed."
                        : "Fixtures do not establish current enforcement state."}
                    </p>
                    {tab === "Requests" && requestRun && (
                      <p className="mt-2 text-xs text-dim">
                        Workflow reference: {requestRun.id} ·{" "}
                        {requestRun.result}
                      </p>
                    )}
                  </section>
                </div>
              </aside>
            )}
          </div>
        </>
      )}
      <footer className="flex shrink-0 justify-between gap-3 text-xs text-dim">
        <span>
          {isDemo
            ? "Demo · no live chain connection"
            : trustworthy
              ? data.connection
              : "State unavailable / stale"}{" "}
          · Updated {data.updatedAt.replace("T", " ").replace("Z", " UTC")}
        </span>
        <span className="hidden lg:inline">
          {isDemo
            ? "Source: isolated fixtures · CRE telemetry unavailable"
            : "Source: authorized adapter"}
        </span>
      </footer>
    </div>
  )
}

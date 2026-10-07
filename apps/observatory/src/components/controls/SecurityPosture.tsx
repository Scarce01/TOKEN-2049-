import { useEffect, useRef, useState } from "react"
import SecurityPlots from "./SecurityPlots"
import {
  ALERT,
  CHAIN_LABEL,
  tokenAmount,
  type ChainEvent,
  type Live,
} from "../../live/chain"

type Selection = {
  org: string
  tier: "hot" | "warm" | "cold"
  sym: "qUSD" | "qETH"
}
type Props = {
  live: Live
  events: ChainEvent[]
  selection: Selection
  onSelect: (s: Selection) => void
  policy?: boolean
  eventsReady: boolean
  eventsError?: string
}
const number = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 3 })
const date = (n: number) =>
  new Date(n * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC"
const remaining = (n: number) =>
  n <= 0
    ? "Expired"
    : `${Math.floor(n / 3600)}h ${Math.ceil((n % 3600) / 60)}m remaining`
const trim = (s: string) => `${s.slice(0, 10)}…${s.slice(-6)}`
const focus =
  "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-honey"
const box = "border border-gold/20 bg-[#101215]"
const caption =
  "font-mono text-[10px] uppercase tracking-widest text-dim"
const Hex = () => <span aria-hidden="true" className="inline-block h-3 w-3 shrink-0 clip-hex bg-gold" />
/** Honey meter with the Overview glow; the empty track turns red at 0. */
const Meter = ({ pct, frozen, zero }: { pct: number; frozen?: boolean; zero?: boolean }) => (
  <div className={`h-1.5 rounded-full ${zero ? "bg-[#ff6b5a]/25" : "bg-white/[0.08]"}`} aria-hidden="true">
    <div className={`h-full rounded-full ${frozen ? "bg-[#9fd8ff]/70" : "bg-gradient-to-r from-[#B98C1A] via-[#E2B52E] to-[#F5CF63]"}`} style={{ width: `${pct}%`, boxShadow: pct && !frozen ? "0 0 10px rgba(245,207,99,.5)" : undefined }} />
  </div>
)
const supported = new Set([
  "Tightened",
  "QuotaZeroed",
  "QuotaRefilled",
  "FreezeSet",
  "AlertSet",
  "DelayRaised",
  "DelayLowered",
  "Swept",
  "ActionFailed",
  "ActionStale",
])
const failed = (e: ChainEvent) =>
  e.name === "ActionFailed" || e.name === "ActionStale"

function eventText(e: ChainEvent) {
  const tier = e.tier ? `${e.tier[0].toUpperCase()}${e.tier.slice(1)} · ` : ""
  const amount = tokenAmount(e.args.token, e.args.amount)
  switch (e.name) {
    case "QuotaZeroed":
      return `${tier}${tokenAmount(e.args.token, 0n).sym} quota zeroed`
    case "QuotaRefilled":
      return `${tier}Quota refilled · ${number(amount.value)} ${amount.sym}`
    case "FreezeSet":
      return Number(e.args.until) > 0
        ? `${tier}Freeze set`
        : `${tier}Freeze cleared`
    case "AlertSet":
      return `Alert set · ${ALERT[Number(e.args.level)] ?? e.args.level}`
    case "Tightened":
      return "Receiver tightening recorded"
    case "DelayRaised":
      return "Cold withdrawal delay raised"
    case "DelayLowered":
      return "Cold withdrawal delay lowered"
    case "Swept":
      return `Swept to cold · ${number(amount.value)} ${amount.sym}`
    case "ActionFailed":
      return "Receiver action failed"
    case "ActionStale":
      return "Stale action skipped"
    default:
      return e.name
  }
}

export default function SecurityPosture({
  live,
  events,
  selection,
  onSelect,
  policy,
  eventsReady,
  eventsError,
}: Props) {
  const [exceptionsOnly, setExceptionsOnly] = useState(false)
  const [record, setRecord] = useState<ChainEvent | null>(null)
  const [copied, setCopied] = useState(false)
  const recordPanel = useRef<HTMLElement>(null)
  useEffect(() => {
    if (record)
      recordPanel.current?.scrollIntoView({
        behavior: "instant",
        block: "nearest",
      })
  }, [record])
  const org = live.orgs.find((o) => o.letter === selection.org) ?? live.orgs[0]
  if (!org)
    return (
      <p className="p-6 text-sm text-dim">No exchange snapshot is available.</p>
    )
  const selected = org.vaults.find((v) => v.id === selection.tier)
  const history = events
    .filter((e) => e.org?.letter === org.letter && supported.has(e.name))
    .sort((a, b) => b.block - a.block || b.logIndex - a.logIndex)
  const exceptions = history.filter(failed)
  const rows = (exceptionsOnly ? exceptions : history).slice(0, 60)
  const activeAlert = org.alert > 0 && org.alertExpiresAt > live.chainTime
  const alertLabel =
    org.alert > 0 && !activeAlert
      ? "Alert expired"
      : (ALERT[org.alert] ?? "Unknown")
  const exportSnapshot = () => {
    const body = {
      source: CHAIN_LABEL,
      block: live.block,
      chainTime: live.chainTime,
      capturedAt: new Date(live.at).toISOString(),
      exchange: org,
      eventsReady,
      eventsError,
      events: history,
    }
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            body,
            (_, v) => (typeof v === "bigint" ? v.toString() : v),
            2,
          ),
        ],
        { type: "application/json" },
      ),
    )
    const a = document.createElement("a")
    a.href = url
    a.download = `controls-${org.letter}-block-${live.block}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <div className="space-y-4 pb-4 text-cream">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1">
          <span className={`${caption} mr-2`}>Exchange</span>
          {live.orgs.map((o) => (
            <button
              key={o.letter}
              aria-pressed={org.letter === o.letter}
              onClick={() => {
                onSelect({ ...selection, org: o.letter })
                setRecord(null)
              }}
              className={`min-h-9 px-3 font-mono text-[11px] uppercase tracking-[.12em] ${focus} ${
                org.letter === o.letter
                  ? "bg-gold/15 text-gold-2"
                  : "text-dim hover:text-cream"
              }`}
            >
              {o.name}
            </button>
          ))}
          <span className="ml-2 border border-gold/25 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-dim">
            {org.mode} · read only
          </span>
        </div>
        <button
          onClick={exportSnapshot}
          className={`min-h-9 border border-gold/30 px-4 font-mono text-[11px] uppercase tracking-[.12em] text-gold-2 hover:bg-gold/10 ${focus}`}
        >
          Export snapshot
        </button>
      </div>

      {policy ? (
        <>
          <div className={`${box} p-5`}>
            <p className={caption}>Change authority</p>
            <h2 className="mt-2 text-xl font-semibold text-cream">
              Tighten automatically. Review every relaxation.
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-dim">
              CRE reports apply defensive controls through the receiver.
              Configuration changes require two officer signatures and
              ConfigTimelock. This view does not submit or sign transactions.
            </p>
            <div className="mt-6 grid gap-5 md:grid-cols-3">
              {[
                [
                  "01",
                  "Propose & compare",
                  "Record the intended change, affected vaults, reason and before/after values.",
                ],
                [
                  "02",
                  "Collect two signatures",
                  "Verify independent officer approvals for the exact operation.",
                ],
                [
                  "03",
                  "Wait & verify",
                  "Respect the on-chain timelock; verify the resulting state after execution.",
                ],
              ].map(([n, t, d]) => (
                <div key={n} className="border-t border-gold/15 pt-4">
                  <span className="font-mono text-xs text-gold-2">{n}</span>
                  <h3 className="mt-2 text-sm font-semibold">{t}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-dim">
                    {d}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <section className={`${box} p-5`}>
            <h2 className="flex items-center gap-3 text-sm font-semibold text-cream"><Hex />Governance coverage</h2>
            <p className="mt-1 text-xs text-dim">
              Unobserved governance data must not appear as an empty queue or a
              passed integrity check.
            </p>
            <div className="mt-4 divide-y divide-gold/15">
              {[
                [
                  "Pending changes & signatures",
                  "Queue, operation hash, signer identities, ready-at time",
                ],
                [
                  "Configuration integrity",
                  "Expected and observed config hashes, anchored to the same block",
                ],
                [
                  "Workflow permissions",
                  "Receiver allowlist and currently authorized workflow IDs",
                ],
              ].map(([t, d]) => (
                <div
                  key={t}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div>
                    <h3 className="text-sm">{t}</h3>
                    <p className="mt-1 text-xs text-dim">{d}</p>
                  </div>
                  <span className="border border-gold/25 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-dim">
                    Not connected
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : (
        <>
          <section
            className={`${box} grid divide-y divide-gold/15 md:grid-cols-3 md:divide-x md:divide-y-0`}
            aria-label="Protection summary"
          >
            <div className="p-5">
              <p className={caption}>Receiver alert</p>
              <p
                className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${
                  activeAlert ? "text-[#ff8b78]" : "text-cream"
                }`}
              >
                {alertLabel}
              </p>
              <p className="mt-2 text-xs text-dim">
                {org.alert > 0
                  ? `${remaining(org.alertExpiresAt - live.chainTime)} · chain clock`
                  : "No active alert reported"}
              </p>
            </div>
            <div className="p-5">
              <p className={caption}>Frozen vaults</p>
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-cream">
                {
                  org.vaults.filter(
                    (v) => (v.frozenUntil ?? 0) > live.chainTime,
                  ).length
                }
                <span className="text-sm font-normal text-dim">
                  {" "}
                  / {org.vaults.filter((v) => v.id !== "cold").length} hot &
                  warm
                </span>
              </p>
              <p className="mt-2 text-xs text-dim">
                Cold releases use a separate withdrawal delay
              </p>
            </div>
            <button
              onClick={() => {
                setExceptionsOnly(true)
                document
                  .getElementById("control-evidence")
                  ?.scrollIntoView({ behavior: "instant", block: "start" })
              }}
              className={`p-5 text-left hover:bg-white/[.025] ${focus}`}
            >
              <p className={caption}>Execution exceptions</p>
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-amber">
                {eventsReady ? exceptions.length : "Unavailable"}
              </p>
              <p className="mt-2 text-xs text-dim">
                Historical failed / stale actions · not an open-case count
              </p>
            </button>
          </section>

          <SecurityPlots
            live={live}
            events={events}
            org={org.letter}
            sym={selection.sym}
            ready={eventsReady}
            error={eventsError}
            onInspect={(e) => {
              setRecord(e)
              setCopied(false)
            }}
          />

          <section className={box} aria-labelledby="effective-controls">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gold/15 px-5 py-4">
              <div>
                <h2 id="effective-controls" className="flex items-center gap-3 text-sm font-semibold text-cream">
                  <Hex />Effective vault controls
                </h2>
                <p className="mt-1 text-xs text-dim">
                  Current contract values. Quota is an allowance, not a
                  guarantee of executable withdrawals.
                </p>
              </div>
              <div
                className="flex gap-1 border border-gold/15 p-0.5"
                aria-label="Asset"
              >
                {(["qUSD", "qETH"] as const).map((sym) => (
                  <button
                    key={sym}
                    aria-pressed={selection.sym === sym}
                    onClick={() => onSelect({ ...selection, sym })}
                    className={`min-h-7 px-3 font-mono text-[11px] ${focus} ${
                      selection.sym === sym
                        ? "bg-gold/15 text-gold-2"
                        : "text-dim hover:text-cream"
                    }`}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid md:grid-cols-3">
              {org.vaults.map((v) => {
                const frozen = (v.frozenUntil ?? 0) > live.chainTime
                const quota = v.quota?.[selection.sym]
                const cap = v.cap?.[selection.sym]
                const state =
                  v.id === "cold"
                    ? "Delayed release"
                    : frozen
                      ? "Frozen"
                      : quota === 0
                        ? "Quota exhausted"
                        : "Quota available"
                const ratio =
                  cap && quota !== undefined
                    ? Math.max(0, Math.min(100, (quota / cap) * 100))
                    : 0
                const isSelected = v.id === selection.tier
                return (
                  <button
                    key={v.id}
                    aria-pressed={isSelected}
                    onClick={() => onSelect({ ...selection, tier: v.id })}
                    className={`min-w-0 border-b-2 p-5 text-left md:border-r md:border-r-white/10 ${focus} ${
                      isSelected
                        ? "border-b-honey bg-white/[.035]"
                        : "border-b-transparent hover:bg-white/[.025]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-lg font-semibold capitalize">
                        {v.id}
                      </h3>
                      <span
                        className={`border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${
                          frozen
                            ? "border-[#9fd8ff]/40 text-[#9fd8ff]"
                            : quota === 0 && v.id !== "cold"
                              ? "border-[#ff8b78]/40 text-[#ff8b78]"
                              : "border-gold/25 text-dim"
                        }`}
                      >
                        {state}
                      </span>
                    </div>
                    <p className="mt-5 font-mono text-2xl tabular-nums text-cream">
                      {v.id === "cold"
                        ? `${v.coldDelayHours ?? "Unknown"}h`
                        : quota === undefined
                          ? "Unknown"
                          : number(quota)}
                      <span className="ml-2 text-xs text-dim">
                        {v.id === "cold" ? "withdrawal delay" : selection.sym}
                      </span>
                    </p>
                    <div className="mt-4"><Meter pct={v.id === "cold" ? 0 : ratio} frozen={frozen} zero={quota === 0 && v.id !== "cold"} /></div>
                    <p className="mt-3 text-xs text-dim">
                      {v.id === "cold"
                        ? `Balance ${number(v.balance[selection.sym])} ${selection.sym}`
                        : `Quota / cap · ${
                            quota === undefined ? "Unknown" : number(quota)
                          } / ${cap === undefined ? "Unknown" : number(cap)}`}
                    </p>
                    <p className="mt-2 text-xs text-cream/80">
                      {frozen
                        ? remaining((v.frozenUntil ?? 0) - live.chainTime)
                        : v.id === "cold"
                          ? "Delay is not a pending release countdown"
                          : "Subject to receiver and execution checks"}
                    </p>
                  </button>
                )
              })}
            </div>
            {selected && (
              <div className="flex flex-wrap items-center gap-x-7 gap-y-2 border-t border-gold/15 px-5 py-3 text-xs text-dim">
                <span className="font-mono text-[10px] uppercase tracking-widest text-gold-2">
                  Selected: {selected.id}
                </span>
                <span>
                  Balance{" "}
                  <b className="font-mono font-normal text-cream">
                    {number(selected.balance[selection.sym])} {selection.sym}
                  </b>
                </span>
                {selected.hourCap && (
                  <span>
                    Hourly cap{" "}
                    <b className="font-mono font-normal text-cream">
                      {number(selected.hourCap[selection.sym])}
                    </b>
                  </span>
                )}
                {selected.dayCap && (
                  <span>
                    Daily cap{" "}
                    <b className="font-mono font-normal text-cream">
                      {number(selected.dayCap[selection.sym])}
                    </b>
                  </span>
                )}
                {(selected.frozenUntil ?? 0) > 0 && (
                  <span>Freeze until {date(selected.frozenUntil!)}</span>
                )}
                <details className="min-w-0">
                  <summary className={`cursor-pointer ${focus}`}>
                    Contract address
                  </summary>
                  <code className="block break-all pt-2">
                    {selected.address}
                  </code>
                </details>
              </div>
            )}
          </section>

          <section id="control-evidence" className={box}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gold/15 px-5 py-4">
              <div>
                <h2 className="flex items-center gap-3 text-sm font-semibold text-cream">
                  <Hex />Control execution evidence
                </h2>
                <p className="mt-1 text-xs text-dim">
                  {org.name} · loaded deployment history · latest 60 matching
                  logs
                </p>
              </div>
              <div className="flex gap-2">
                {[
                  [false, "All control events"],
                  [true, "Exceptions"],
                ].map(([value, label]) => (
                  <button
                    key={String(value)}
                    aria-pressed={exceptionsOnly === value}
                    onClick={() => setExceptionsOnly(Boolean(value))}
                    className={`min-h-8 px-3 font-mono text-[11px] ${focus} ${
                      exceptionsOnly === value
                        ? "bg-gold/15 text-gold-2"
                        : "text-dim hover:text-cream"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {eventsError && (
              <p role="status" className="px-5 py-3 text-xs text-amber">
                Event refresh failed.{" "}
                {eventsReady
                  ? "Showing the last loaded history."
                  : "Execution evidence is unavailable."}
              </p>
            )}
            <div className="max-h-[340px] overflow-auto [scrollbar-width:thin]">
              <table className="w-full min-w-[650px] text-left text-xs">
                <thead className="sticky top-0 bg-[#101215] text-dim">
                  <tr>
                    {[
                      "Time (UTC)",
                      "Control event",
                      "Evidence",
                      "Block",
                      "",
                    ].map((s, i) => (
                      <th key={i} className="px-5 py-3 font-medium">
                        {s}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {rows.map((e) => (
                    <tr
                      key={`${e.tx}:${e.logIndex}`}
                      className="hover:bg-white/[.025]"
                    >
                      <td className="whitespace-nowrap px-5 py-3 font-mono text-dim">
                        {date(e.time).slice(5, 19)}
                      </td>
                      <td className="px-5 py-3">{eventText(e)}</td>
                      <td
                        className={`px-5 py-3 ${
                          failed(e) ? "text-amber" : "text-dim"
                        }`}
                      >
                        {e.name === "ActionFailed"
                          ? "Failed"
                          : e.name === "ActionStale"
                            ? "Skipped"
                            : "Recorded"}
                      </td>
                      <td className="px-5 py-3 font-mono text-dim">
                        {e.block.toLocaleString("en-US")}
                      </td>
                      <td className="px-5 py-2">
                        <button
                          onClick={() => {
                            setRecord(e)
                            setCopied(false)
                          }}
                          aria-label={`Inspect ${e.name} at block ${e.block} log ${e.logIndex}`}
                          className={`min-h-8 whitespace-nowrap font-mono text-[11px] text-gold-2 hover:underline ${focus}`}
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && (
                <p className="p-6 text-sm text-dim">
                  {!eventsReady
                    ? eventsError
                      ? "Event history could not be loaded."
                      : "Loading event history…"
                    : "No matching events in the loaded history."}
                </p>
              )}
            </div>
            <p className="border-t border-gold/15 px-5 py-3 text-xs text-dim">
              A recorded report does not prove every action succeeded. Inspect
              individual logs and compare the current vault state.
            </p>
          </section>
        </>
      )}
      {record && (
        <section
          role="region"
          aria-label="Selected execution evidence"
          className={`${box} border-gold/50 p-5`}
          ref={recordPanel}
        >
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-3 text-sm font-semibold text-cream"><Hex />{eventText(record)}</h2>
            <button
              onClick={() => setRecord(null)}
              className={`min-h-9 px-3 font-mono text-[11px] text-dim hover:text-cream ${focus}`}
            >
              Close
            </button>
          </div>
          <p className="mt-2 text-xs text-dim">
            {date(record.time)} · block {record.block} · log {record.logIndex}
          </p>
          <p className="mt-3 break-all font-mono text-xs">{record.tx}</p>
          <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap break-all bg-ink p-4 text-xs text-dim">
            {JSON.stringify(
              record.args,
              (_, v) => (typeof v === "bigint" ? v.toString() : v),
              2,
            )}
          </pre>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(record.tx)
                setCopied(true)
              } catch {
                setCopied(false)
              }
            }}
            className={`mt-3 min-h-9 border border-gold/25 px-3 font-mono text-[11px] text-gold-2 hover:bg-gold/10 ${focus}`}
          >
            {copied ? "Copied" : `Copy transaction ${trim(record.tx)}`}
          </button>
        </section>
      )}
      <p className="text-xs leading-relaxed text-dim">
        Source: {CHAIN_LABEL} · block {live.block.toLocaleString("en-US")} ·{" "}
        {date(live.chainTime)}. Snapshot values are public contract reads, not
        an independent security attestation.
      </p>
    </div>
  )
}

import { useState } from "react"
import { tokenAmount, type ChainEvent, type Live } from "../../live/chain"

const GOLD = "#E2B52E", PALE = "#F5CF63", RED = "#ff8b78", MUTED = "#a49c89"
const stamp = (t: number) => new Date(t * 1000).toISOString().slice(5, 16).replace("T", " ")
const amount = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 })
const isException = (e: ChainEvent) => e.name === "ActionFailed" || e.name === "ActionStale"
const frames = [["1H", 3600], ["24H", 86400], ["7D", 604800], ["ALL", 0]] as const
const lanes = ["Hot", "Warm", "Cold", "Receiver"]
const lane = (e: ChainEvent) => e.tier === "hot" ? 0 : e.tier === "warm" ? 1 : e.tier === "cold" ? 2 : 3
type Props = { live: Live; events: ChainEvent[]; org: string; sym: "qUSD" | "qETH"; ready: boolean; error?: string; onInspect: (event: ChainEvent) => void }

/** Only plot observed values. In particular, refill/zero events are quota checkpoints,
 * not a complete reconstruction of withdrawals, cap changes, or intermediate balances. */
export default function SecurityPlots({ live, events, org, sym, ready, error, onInspect }: Props) {
  const [window, setWindow] = useState(86400)
  const [hover, setHover] = useState<ChainEvent | null>(null)
  const history = events.filter(e => e.org?.letter === org && e.time <= live.chainTime).sort((a,b) => a.block-b.block || a.logIndex-b.logIndex)
  const end = live.chainTime
  const start = window ? end-window : Math.min(end-60, ...history.map(e=>e.time))
  const visible = history.filter(e => e.time >= start)
  const checkpoints = visible.filter(e => (e.name === "QuotaRefilled" || e.name === "QuotaZeroed") && tokenAmount(e.args.token, 0n).sym === sym)
  const value = (e: ChainEvent) => e.name === "QuotaZeroed" ? 0 : tokenAmount(e.args.token, e.args.quota).value
  const max = Math.max(1, ...checkpoints.map(value))
  const x = (t: number) => 78 + (t-start)/(end-start)*604
  const y = (v: number) => 170-v/max*115
  // Co-located logs share a marker; the evidence table preserves every individual log.
  const groups = new Map<string, ChainEvent[]>()
  for (const e of visible) {
    const key = `${lane(e)}:${Math.round(x(e.time)/8)}`
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  const bins = Array.from({length:24}, (_,i)=>({start:start+(end-start)*i/24, failed:0, stale:0}))
  for (const e of visible.filter(isException)) {
    const bin = bins[Math.min(23, Math.floor((e.time-start)/(end-start)*24))]
    if(e.name === "ActionFailed") bin.failed++; else bin.stale++
  }
  const peak = Math.max(1,...bins.map(b=>b.failed+b.stale))
  const exceptionCount = visible.filter(isException).length
  const details = (e: ChainEvent) => `${e.name} · ${stamp(e.time)} UTC · block ${e.block}${e.name.startsWith("Quota") ? ` · ${amount(value(e))} ${sym}` : ""}`
  const markProps = (e: ChainEvent) => ({role:"button" as const, tabIndex:0, "aria-label":`Inspect plotted ${details(e)}`, onMouseEnter:()=>setHover(e), onMouseLeave:()=>setHover(null), onFocus:()=>setHover(e), onBlur:()=>setHover(null), onClick:()=>onInspect(e), onKeyDown:(k: React.KeyboardEvent)=>{if(k.key === "Enter" || k.key === " "){k.preventDefault();onInspect(e)}}})
  const ticks = Array.from({length:5},(_,i)=>start+(end-start)*i/4)
  return <section className="overflow-hidden border border-gold/20 bg-[#101215]" aria-label="Security control plots">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gold/15 px-5 py-3">
      <div className="flex items-center gap-3"><span className="h-3 w-3 clip-hex bg-gold"/><h2 className="text-sm font-semibold text-cream">Control observatory</h2><span className="font-mono text-[10px] uppercase tracking-widest text-dim">{sym} / UTC</span></div>
      <div className="flex gap-1" aria-label="Plot time window">{frames.map(([label, seconds])=><button key={label} aria-pressed={window===seconds} onClick={()=>{setWindow(seconds);setHover(null)}} className={`min-h-8 px-3 font-mono text-xs focus-visible:outline-2 focus-visible:outline-honey ${window===seconds ? "bg-gold/15 text-honey" : "text-dim hover:text-cream"}`}>{label}</button>)}</div>
    </div>
    {(!ready || error) && <p role="status" className="px-5 pt-3 text-xs text-amber">{error ? ready ? "Refresh failed. Plots use the last loaded event history." : "Event history unavailable." : "Loading on-chain observations…"}</p>}
    <div className="grid xl:grid-cols-[1.2fr_1fr]">
      <div className="min-w-0 p-5 xl:border-r xl:border-gold/15">
        <div className="flex items-start justify-between"><div><h3 className="text-sm text-cream">Response chronology</h3><p className="mt-1 text-xs text-dim">Recorded actions by control layer</p></div><span className="font-mono text-xs text-gold">{ready ? visible.length : "?"} logs</span></div>
        <div className="overflow-x-auto [scrollbar-width:thin]"><svg viewBox="0 0 720 244" className="mt-3 w-full min-w-[530px]" role="group" aria-label="Time-aligned control events and exception counts">
          {ticks.map(t=><g key={t}><line x1={x(t)} x2={x(t)} y1="14" y2="208" stroke={GOLD} strokeOpacity=".12" strokeDasharray="2 5"/><text x={x(t)} y="232" textAnchor="middle" fill={MUTED} fontSize="10" fontFamily="monospace">{stamp(t)}</text></g>)}
          {lanes.map((label,i)=><g key={label}><text x="0" y={33+i*33} fill={i===3?MUTED:PALE} fontSize="11" fontFamily="monospace">{label}</text><line x1="78" x2="682" y1={29+i*33} y2={29+i*33} stroke={GOLD} strokeOpacity=".2"/></g>)}
          {[...groups.values()].map(group=>{const e=group.find(isException)??group[group.length-1];const cy=29+lane(e)*33;const cx=x(e.time);return <g key={`${e.tx}:${e.logIndex}`} {...markProps(e)} className="cursor-pointer outline-none focus:[&>rect]:stroke-honey"><title>{group.length} log(s) near this point. {details(e)}. Inspect individual logs in the evidence table.</title><rect x={cx-9} y={cy-12} width="18" height="24" fill="transparent"/><path d={isException(e)?`M${cx} ${cy-5}l5 9h-10Z`:`M${cx} ${cy-5}l5 3v5l-5 3-5-3v-5Z`} fill={isException(e)?RED:GOLD}/>{group.length>1&&<text x={cx+7} y={cy-7} fontSize="9" fill={MUTED}>{group.length}</text>}</g>})}
          <text x="0" y="186" fill={MUTED} fontSize="10" fontFamily="monospace">Exceptions</text>
          {bins.map((b,i)=>{const bx=78+i*604/24;const f=b.failed/peak*35;const s=b.stale/peak*35;return <g key={i}><title>{stamp(b.start)} UTC: {b.failed} failed, {b.stale} stale</title><rect x={bx} y={207-f} width="22" height={f} fill={RED}/><rect x={bx} y={207-f-s} width="22" height={s} fill={GOLD} opacity=".7"/></g>})}
          <line x1="78" x2="682" y1="208" y2="208" stroke={GOLD} strokeOpacity=".25"/>
          {ready&&!visible.length&&<text x="380" y="86" textAnchor="middle" fill={MUTED} fontSize="12">No recorded actions in this window</text>}
        </svg></div>
        <div className="flex flex-wrap gap-4 text-[11px] text-dim"><span className="text-gold">⬡ Recorded action</span><span className="text-[#ff8b78]">△ Failed / skipped</span><span>{exceptionCount} exceptions · 24 equal time bins · peak {peak===1&&!exceptionCount?0:peak}</span></div>
      </div>
      <div className="min-w-0 border-t border-gold/15 p-5 xl:border-t-0">
        <div className="flex items-start justify-between"><div><h3 className="text-sm text-cream">Quota checkpoints</h3><p className="mt-1 text-xs text-dim">Exact values at refill and zero events</p></div><span className="font-mono text-xs text-gold">{sym}</span></div>
        <div className="overflow-x-auto [scrollbar-width:thin]"><svg viewBox="0 0 720 244" className="mt-3 w-full min-w-[530px]" role="group" aria-label={`${sym} observed quota checkpoints; no interpolation between observations`}>
          {[0,.5,1].map(n=><g key={n}><line x1="78" x2="682" y1={y(max*n)} y2={y(max*n)} stroke={GOLD} strokeOpacity=".13" strokeDasharray="3 5"/><text x="68" y={y(max*n)+4} textAnchor="end" fill={MUTED} fontSize="11" fontFamily="monospace">{amount(max*n)}</text></g>)}
          {ticks.map(t=><text key={t} x={x(t)} y="232" textAnchor="middle" fill={MUTED} fontSize="10" fontFamily="monospace">{stamp(t)}</text>)}
          {checkpoints.map(e=>{const cx=x(e.time);const cy=y(value(e));const zero=e.name==="QuotaZeroed";return <g key={`${e.tx}:${e.logIndex}`} {...markProps(e)} className="cursor-pointer outline-none focus:[&>rect]:stroke-honey"><title>{details(e)}</title><line x1={cx} x2={cx} y1={cy} y2="190" stroke={zero?RED:GOLD} strokeOpacity=".2"/><rect x={cx-9} y={cy-10} width="18" height="20" fill="transparent"/>{zero?<path d={`M${cx} ${cy-5}l5 5-5 5-5-5Z`} fill={RED}/>:<circle cx={cx} cy={cy} r="4" fill={PALE}/>}</g>})}
          {ready&&!checkpoints.length&&<text x="380" y="110" textAnchor="middle" fill={MUTED} fontSize="12">No quota checkpoints in this window</text>}
        </svg></div>
        <div className="flex flex-wrap gap-4 text-[11px] text-dim"><span className="text-[#F5CF63]">● Refill value</span><span className="text-[#ff8b78]">◆ Zeroed</span><span>Unobserved intervals are not interpolated.</span></div>
      </div>
    </div>
    <div className="min-h-10 border-t border-gold/15 bg-gold/[.025] px-5 py-3 font-mono text-[11px] text-dim" aria-live="polite">{hover?details(hover):`${stamp(start)} → ${stamp(end)} UTC · Select a marker to inspect its transaction. Counts describe logs, not unique incidents.`}</div>
  </section>
}

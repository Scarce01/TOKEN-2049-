import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "react-router"
import SecurityPosture from "../components/controls/SecurityPosture"
import VaultTerrain, { type Island, type Tier } from "../components/controls/VaultTerrain"
import { RED } from "../components/ui"
import { ALERT, CHAIN_LABEL, readEvents, readLive, tokenAmount, usdOf, useLive, type ChainEvent, type Live, type LiveOrg } from "../live/chain"

// Controls desk: a multi-widget workspace (trading-terminal layout) over live chain state.
// Every widget in link group 1 follows the selected vault: pick it in the watchlist or on the 3D terrain.
// Public chain reads only; decoy and officer-only data are not on this page (CLAUDE.md rule 2).

type Sym = "qUSD" | "qETH"
type Sel = { org: string; tier: Tier; sym: Sym }
type Pt = { t: number; v: number }
type Candle = { t: number; o: number; h: number; l: number; c: number; vol: number; marks: string[] }

const GREEN = "#2bc48a"
const ICE = "#9fd8ff"
const SYMS: Sym[] = ["qUSD", "qETH"]
const TIERS: Tier[] = ["hot", "warm", "cold"]
const FRAMES = [["1m", 60], ["5m", 300], ["15m", 900], ["1H", 3600], ["4H", 14400], ["1D", 86400]] as const
const SOURCE = `on-chain · ${CHAIN_LABEL}`
const FIDELITY = {
  exact: "replayed from events",
  partial: "from first refill, earlier value unknown",
  drift: "replay off the live value (cap change?)",
  "inflows only": "cold: sweeps in only",
} as const

const fmt = (v: number, sym: Sym) => v.toLocaleString("en-US", { maximumFractionDigits: sym === "qETH" ? 3 : 0 })
const short = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : v.toLocaleString("en-US", { maximumFractionDigits: 2 }))
const clock = (t: number) => (t ? new Date(t * 1000).toISOString().slice(11, 19) : "--:--:--")
const stamp = (t: number) => new Date(t * 1000).toISOString().slice(5, 16).replace("T", " ")
const dur = (s: number) => (s <= 0 ? "0m" : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.ceil(s / 60)}m`)
const tierName = (t: Tier) => t[0].toUpperCase() + t.slice(1)
const byChain = (a: ChainEvent, b: ChainEvent) => a.block - b.block || a.logIndex - b.logIndex

function vaultOf(org: LiveOrg | undefined, tier: Tier) {
  return org?.vaults.find((v) => v.id === tier)
}
/** Current value of a watchlist row: quota left for hot and warm, balance for cold. */
function valueOf(org: LiveOrg | undefined, tier: Tier, sym: Sym) {
  const v = vaultOf(org, tier)
  return { cur: (tier === "cold" ? v?.balance[sym] : v?.quota?.[sym]) ?? 0, cap: v?.cap?.[sym] ?? 0 }
}

/** How a rebuilt series relates to the chain: exact, partial (starts at the first exact anchor), or
 * drifted (the replay does not land on the live value: an unreplayed CapSet clamp or a missed event). */
type Fidelity = "exact" | "partial" | "drift" | "inflows only"
type Series = { start: number; pts: Pt[]; fidelity: Fidelity }

/** Quota (hot, warm) or cold balance over time, rebuilt from events. Follows QuorumVault.execute: a payout
 * takes quota only when it is not manual, the vault is not frozen and the alert is below CONFIRMED (otherwise
 * it goes through the R7 protected budget). QuotaRefilled carries the exact quota after it and QuotaZeroed sets
 * 0, so those are anchors; the value before the first anchor is only known when it can be solved from it. */
function seriesOf(events: ChainEvent[], s: Sel, live: Live): Series {
  const org = live.orgs.find((o) => o.letter === s.org)
  const { cur, cap } = valueOf(org, s.tier, s.sym)
  const mine = events.filter((e) => e.org?.letter === s.org).sort(byChain)
  const val = (e: ChainEvent, raw: unknown) => tokenAmount(e.args.token, raw).value
  const isSym = (e: ChainEvent) => tokenAmount(e.args.token, 0n).sym === s.sym
  if (s.tier === "cold") {
    // walk back from the live balance over Swept (funds into cold); cold payouts are not in the event set
    let v = cur
    const pts: Pt[] = [{ t: live.chainTime, v: cur }]
    for (const e of mine.filter((x) => x.name === "Swept" && isSym(x)).reverse()) {
      pts.unshift({ t: e.time, v })
      v -= val(e, e.args.amount)
    }
    return { start: Math.max(0, v), pts, fidelity: "inflows only" }
  }
  type Step = { t: number; set?: number; pre?: number; delta?: number }
  const steps: Step[] = []
  let level = 0
  let levelUntil = 0
  let frozenUntil = 0
  for (const e of mine) {
    if (e.name === "AlertSet") { level = Number(e.args.level); levelUntil = Number(e.args.expiresAt); continue }
    if (e.name === "FreezeSet" && e.tier === s.tier) { frozenUntil = Number(e.args.until); continue }
    if (e.tier !== s.tier || !isSym(e)) continue
    if (e.name === "QuotaRefilled") {
      const q = val(e, e.args.quota)
      // refill clamps at the cap, so the value before it is solvable only when it did not hit the cap
      steps.push({ t: e.time, set: q, pre: q < cap ? q - val(e, e.args.amount) : undefined })
    } else if (e.name === "QuotaZeroed") steps.push({ t: e.time, set: 0 })
    else if (e.name === "Executed" && !e.args.manual && frozenUntil <= e.time && !(level >= 4 && levelUntil > e.time))
      steps.push({ t: e.time, delta: -val(e, e.args.amount) })
  }
  const first = steps.findIndex((x) => x.set !== undefined)
  const sumBefore = (i: number) => steps.slice(0, i).reduce((a, x) => a + (x.delta ?? 0), 0)
  let start: number
  let from = 0
  let fidelity: Fidelity = "exact"
  if (first < 0) start = cur - sumBefore(steps.length)
  else if (steps[first].pre !== undefined) start = steps[first].pre! - sumBefore(first)
  else { start = steps[first].set!; from = first + 1; fidelity = "partial" }
  let v = start
  const pts: Pt[] = from ? [{ t: steps[first].t, v }] : []
  for (const x of steps.slice(from)) {
    v = x.set ?? v + (x.delta ?? 0)
    pts.push({ t: x.t, v })
  }
  if (Math.abs(v - cur) > 1e-9 && fidelity === "exact") fidelity = "drift"
  pts.push({ t: live.chainTime, v: cur })
  return { start, pts, fidelity }
}

/** Event markers on the time axis (like earnings/dividend dots): T tightened, Z quota zeroed, F freeze, A alert. */
function marksOf(events: ChainEvent[], s: Sel): { t: number; m: string }[] {
  return events
    .filter((e) => e.org?.letter === s.org)
    .flatMap((e) => {
      if (e.name === "Tightened") return [{ t: e.time, m: "T" }]
      if (e.name === "AlertSet" && Number(e.args.level) > 0) return [{ t: e.time, m: "A" }]
      if (e.name === "FreezeSet" && e.tier === s.tier) return [{ t: e.time, m: "F" }]
      if (e.name === "QuotaZeroed" && e.tier === s.tier && tokenAmount(e.args.token, 0n).sym === s.sym) return [{ t: e.time, m: "Z" }]
      return []
    })
    .sort((a, b) => a.t - b.t)
}

/** Bucket a step series into candles. Empty buckets are skipped, like non-trading hours. */
function candlesOf(start: number, pts: Pt[], marks: { t: number; m: string }[], size: number, n = 64): Candle[] {
  const key = (t: number) => Math.floor(t / size)
  const keys = [...new Set([...pts.map((p) => key(p.t)), ...marks.map((m) => key(m.t))])].sort((a, b) => a - b)
  const out: Candle[] = []
  let i = 0
  let j = 0
  let last = start
  for (const k of keys) {
    const o = last
    let h = o
    let l = o
    let vol = 0
    for (; i < pts.length && key(pts[i].t) === k; i++) {
      vol += Math.abs(pts[i].v - last)
      last = pts[i].v
      h = Math.max(h, last)
      l = Math.min(l, last)
    }
    const ms: string[] = []
    for (; j < marks.length && key(marks[j].t) === k; j++) if (!ms.includes(marks[j].m)) ms.push(marks[j].m)
    out.push({ t: k * size, o, h, l, c: last, vol, marks: ms })
  }
  return out.slice(-n)
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

// ---------------------------------------------------------------- widget chrome

function Widget({ title, link, tools, children, className = "", source = SOURCE }: { title: ReactNode; link?: number; tools?: ReactNode; children: ReactNode; className?: string; source?: string }) {
  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-[4px] border border-white/[0.06] bg-coal-2 ${link ? "border-t-2 border-t-honey/80" : ""} ${className}`}>
      <header className="flex h-9 shrink-0 items-center gap-3 border-b border-white/[0.05] px-3">
        <h2 className="text-[13px] font-semibold text-cream">{title}</h2>
        {tools}
        <span className="ml-auto truncate text-[10px] text-mute">{source}</span>
        {link !== undefined && (
          <span title={`Link group ${link}: follows the selected vault`} className="grid h-4 w-4 shrink-0 place-items-center rounded-[3px] bg-cream/85 text-[10px] font-bold text-ink">
            {link}
          </span>
        )}
      </header>
      <div className="relative min-h-0 flex-1">{children}</div>
    </section>
  )
}

function Waiting({ error }: { error?: string }) {
  return <div className="grid h-full place-items-center text-xs text-mute">{error ? "Chain unreachable" : "Reading chain…"}</div>
}

// ---------------------------------------------------------------- watchlist

function Spark({ pts, color }: { pts: Pt[]; color: string }) {
  const vs = pts.slice(-30).map((p) => p.v)
  if (vs.length < 2) return <svg width="48" height="22" />
  const lo = Math.min(...vs)
  const hi = Math.max(...vs)
  const y = (v: number) => (hi === lo ? 11 : 20 - ((v - lo) / (hi - lo)) * 18)
  return (
    <svg width="48" height="22" className="shrink-0">
      <polyline fill="none" stroke={color} strokeWidth="1.2" points={vs.map((v, i) => `${(i / (vs.length - 1)) * 46 + 1},${y(v)}`).join(" ")} />
    </svg>
  )
}

function Watchlist({ live, events, sel, onSelect }: { live: Live; events: ChainEvent[]; sel: Sel; onSelect: (s: Sel) => void }) {
  const [org, setOrg] = useState<string>("All")
  const rows = live.orgs
    .filter((o) => org === "All" || o.letter === org)
    .flatMap((o) => TIERS.flatMap((tier) => SYMS.map((sym) => ({ o, tier, sym }))))
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1.5 px-3 py-2">
        {["All", ...live.orgs.map((o) => o.letter)].map((k) => (
          <button key={k} onClick={() => setOrg(k)} className={`rounded-[3px] border px-2 py-0.5 text-[11px] ${org === k ? "border-honey/60 text-cream" : "border-white/10 text-dim hover:text-cream"}`}>
            {k === "All" ? "All vaults" : `Exchange ${k}`}
          </button>
        ))}
      </div>
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_48px_70px_40px] gap-2 border-b border-white/[0.05] px-3 pb-1.5 text-[10.5px] text-mute">
        <span>Vault</span>
        <span />
        <span className="text-right">Quota left</span>
        <span className="text-right">cap / delay</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map(({ o, tier, sym }) => {
          const s = { org: o.letter, tier, sym }
          const { cur, cap } = valueOf(o, tier, sym)
          const v = vaultOf(o, tier)
          const frozen = (v?.frozenUntil ?? 0) > live.chainTime
          const pct = cap ? cur / cap : 1
          const color = tier === "cold" ? "#d6a61f" : pct <= 0 ? RED : pct < 0.5 ? "#fcad17" : GREEN
          const active = sel.org === s.org && sel.tier === tier && sel.sym === sym
          return (
            <button
              key={`${o.letter}:${tier}:${sym}`}
              onClick={() => onSelect(s)}
              className={`grid w-full grid-cols-[minmax(0,1fr)_48px_70px_40px] items-center gap-2 border-l-2 px-3 py-2 text-left ${active ? "border-honey bg-white/[0.05]" : "border-transparent hover:bg-white/[0.025]"}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-cream">{tierName(tier)} · {sym}</span>
                <span className="flex items-center gap-1 text-[10.5px] text-mute">
                  {o.name}
                  {frozen && <span className="rounded-[2px] px-1 text-[9px] font-semibold text-ink" style={{ background: ICE }}>FROZEN</span>}
                  {o.alert >= 4 && tier === "hot" && <span className="rounded-[2px] px-1 text-[9px] font-semibold text-ink" style={{ background: RED }}>CONF</span>}
                </span>
              </span>
              <Spark pts={seriesOf(events, s, live).pts} color={color} />
              <span className="text-right font-mono text-[12.5px]" style={{ color }}>{fmt(cur, sym)}</span>
              <span className="text-right font-mono text-[11.5px] text-dim">{tier === "cold" ? `${v?.coldDelayHours ?? 0}h` : `${Math.round(pct * 100)}%`}</span>
            </button>
          )
        })}
      </div>
      <p className="shrink-0 border-t border-white/[0.05] px-3 py-1.5 text-[10px] text-mute">Cold rows show balance and withdrawal delay.</p>
    </div>
  )
}

// ---------------------------------------------------------------- candle chart

function CandleChart({ candles, cap, cur, sym, tier }: { candles: Candle[]; cap: number; cur: number; sym: Sym; tier: Tier }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const axis = 66
  const top = 24
  const xAxis = 18
  const priceH = Math.max(40, (h - top - xAxis) * 0.72)
  const volTop = top + priceH + 10
  const volH = Math.max(16, h - volTop - xAxis)
  const slots = Math.max(candles.length, 16)
  const step = (w - axis - 8) / slots
  const xs = (i: number) => 8 + (slots - candles.length + i + 0.5) * step
  const vals = [...candles.flatMap((c) => [c.h, c.l]), cur, ...(tier === "cold" ? [] : [cap])]
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  if (hi === lo) { hi = hi * 1.05 + 1; lo = Math.max(0, lo * 0.95 - 1) }
  const pad = (hi - lo) * 0.08
  lo = Math.max(0, lo - pad)
  hi += pad
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * priceH
  const maxVol = Math.max(1, ...candles.map((c) => c.vol))
  const shown = candles[hover ?? candles.length - 1]
  const tag = (v: number, color: string, label: string, dashed: string) => (
    <g>
      <line x1={8} x2={w - axis} y1={y(v)} y2={y(v)} stroke={color} strokeDasharray={dashed} strokeWidth={1} opacity={0.8} />
      <rect x={w - axis + 2} y={y(v) - 8} width={axis - 4} height={16} rx={2} fill={color} />
      <text x={w - axis / 2} y={y(v) + 3.5} textAnchor="middle" fontSize="10" fontFamily="ui-monospace,monospace" fill="#0b0d10">{label}</text>
    </g>
  )
  return (
    <div ref={ref} className="absolute inset-0">
      {w > 0 && (
        <svg width={w} height={h} className="block select-none">
          {[0, 0.25, 0.5, 0.75, 1].map((k) => {
            const v = lo + (hi - lo) * k
            return (
              <g key={k}>
                <line x1={8} x2={w - axis} y1={y(v)} y2={y(v)} stroke="#ffffff" opacity={0.04} />
                <text x={w - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fontFamily="ui-monospace,monospace" fill="#6a665e">{short(v)}</text>
              </g>
            )
          })}
          {candles.map((c, i) => {
            const up = c.c >= c.o
            const color = up ? GREEN : RED
            const x = xs(i)
            const bw = Math.max(1.5, step * 0.62)
            const bodyTop = y(Math.max(c.o, c.c))
            const bodyH = Math.max(1, Math.abs(y(c.o) - y(c.c)))
            const vh = (c.vol / maxVol) * volH
            return (
              <g key={c.t}>
                <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={color} />
                <rect x={x - bw / 2} y={bodyTop} width={bw} height={bodyH} fill={up ? "transparent" : color} stroke={color} />
                <rect x={x - bw / 2} y={volTop + volH - vh} width={bw} height={Math.max(vh, c.vol ? 1 : 0)} fill={color} opacity={0.75} />
                {c.marks.map((m, k) => (
                  <g key={m}>
                    <circle cx={x} cy={top + priceH - 9 - k * 17} r={7} fill="#0f1115" stroke={m === "F" ? ICE : m === "A" ? "#fcad17" : RED} />
                    <text x={x} y={top + priceH - 5.5 - k * 17} textAnchor="middle" fontSize="9" fontWeight="600" fill={m === "F" ? ICE : m === "A" ? "#fcad17" : RED}>{m}</text>
                  </g>
                ))}
              </g>
            )
          })}
          {tier !== "cold" && cap > 0 && tag(cap, "#ffc700", `CAP ${short(cap)}`, "6 4")}
          {tag(cur, cur <= 0 && tier !== "cold" ? RED : GREEN, short(cur), "2 3")}
          {candles.map((c, i) => i % Math.max(1, Math.ceil(90 / step)) === 0 && (
            <text key={c.t} x={xs(i)} y={h - 5} textAnchor="middle" fontSize="10" fill="#6a665e">{stamp(c.t)}</text>
          ))}
          <text x={10} y={volTop + 10} fontSize="10" fill="#9a9488">Volume <tspan fill="#6a665e">(quota moved)</tspan></text>
          {shown && (
            <text x={10} y={15} fontSize="10.5" fontFamily="ui-monospace,monospace" fill="#9a9488">
              {stamp(shown.t)}  O <tspan fill="#fff1c1">{short(shown.o)}</tspan>  H <tspan fill="#fff1c1">{short(shown.h)}</tspan>  L <tspan fill="#fff1c1">{short(shown.l)}</tspan>  C <tspan fill={shown.c >= shown.o ? GREEN : RED}>{short(shown.c)}</tspan>  Vol <tspan fill="#fff1c1">{short(shown.vol)}</tspan> {sym}
            </text>
          )}
          {hover !== null && <line x1={xs(hover)} x2={xs(hover)} y1={top} y2={h - xAxis} stroke="#ffffff" opacity={0.18} strokeDasharray="3 3" />}
          <rect
            x={8}
            y={top}
            width={Math.max(0, w - axis - 8)}
            height={Math.max(0, h - top - xAxis)}
            fill="transparent"
            onMouseMove={(e) => {
              const bx = e.clientX - e.currentTarget.getBoundingClientRect().left
              const i = Math.round(bx / step - 0.5) - (slots - candles.length)
              setHover(i >= 0 && i < candles.length ? i : null)
            }}
            onMouseLeave={() => setHover(null)}
          />
        </svg>
      )}
    </div>
  )
}

function ChartWidget({ live, events, sel }: { live: Live; events: ChainEvent[]; sel: Sel }) {
  const [frame, setFrame] = useState<number>(900)
  const org = live.orgs.find((o) => o.letter === sel.org)
  const { cur, cap } = valueOf(org, sel.tier, sel.sym)
  const { start, pts, fidelity } = useMemo(() => seriesOf(events, sel, live), [events, sel, live])
  const candles = useMemo(() => candlesOf(start, pts, marksOf(events, sel), frame), [start, pts, events, sel, frame])
  const first = candles[0]?.o ?? cur
  const chg = cur - first
  const color = chg >= 0 ? GREEN : RED
  return (
    <Widget
      link={1}
      title="Chart"
      className="h-full"
      source={`${SOURCE} · ${FIDELITY[fidelity]}`}
      tools={
        <span className="flex min-w-0 items-baseline gap-2 truncate font-mono text-[12px]">
          <span className="text-cream">{org?.name} · {tierName(sel.tier)} {sel.sym}</span>
          <span style={{ color }}>{fmt(cur, sel.sym)}</span>
          <span style={{ color }}>{chg >= 0 ? "+" : ""}{fmt(chg, sel.sym)} ({first ? `${((chg / first) * 100).toFixed(2)}%` : "n/a"})</span>
        </span>
      }
    >
      <div className="flex h-full flex-col">
        <div className="relative min-h-0 flex-1">
          {candles.length ? <CandleChart candles={candles} cap={cap} cur={cur} sym={sel.sym} tier={sel.tier} /> : <Waiting />}
        </div>
        <div className="flex shrink-0 items-center gap-1 border-t border-white/[0.05] px-3 py-1.5 text-[11.5px]">
          {FRAMES.map(([label, s]) => (
            <button key={label} onClick={() => setFrame(s)} className={`rounded-[3px] px-2 py-0.5 ${frame === s ? "border border-white/25 text-cream" : "border border-transparent text-dim hover:text-cream"}`}>
              {label}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-3 text-[10.5px] text-mute">
            {[["T", "tightened", RED], ["Z", "quota zeroed", RED], ["F", "freeze", ICE], ["A", "alert", "#fcad17"]].map(([m, l, c]) => (
              <span key={m} className="flex items-center gap-1">
                <span className="grid h-3.5 w-3.5 place-items-center rounded-full border text-[8px] font-semibold" style={{ borderColor: c, color: c }}>{m}</span>
                {l}
              </span>
            ))}
          </span>
        </div>
      </div>
    </Widget>
  )
}

// ---------------------------------------------------------------- right column

function AlertSummary({ live }: { live: Live }) {
  return (
    <div className="grid gap-px bg-white/[0.04]">
      {live.orgs.map((o) => {
        const hot = vaultOf(o, "hot")
        const q = usdOf(hot?.quota ?? { qUSD: 0, qETH: 0 }, live.ethUsd)
        const c = usdOf(hot?.cap ?? { qUSD: 0, qETH: 0 }, live.ethUsd)
        const frozen = o.vaults.filter((v) => (v.frozenUntil ?? 0) > live.chainTime)
        const frozenFor = Math.max(0, ...frozen.map((v) => (v.frozenUntil ?? 0) - live.chainTime))
        const color = o.alert >= 4 ? RED : o.alert > 0 ? "#fcad17" : GREEN
        return (
          <div key={o.letter} className="bg-coal-2 px-3 py-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-dim">{o.name}</span>
              <span className="text-[10.5px] text-mute">{o.alert > 0 ? `expires in ${dur(o.alertExpiresAt - live.chainTime)}` : "no alert"}</span>
            </div>
            <div className="mt-0.5 font-mono text-[24px] font-semibold leading-tight" style={{ color }}>{(ALERT[o.alert] ?? "Normal").toUpperCase()}</div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full" style={{ width: `${c ? Math.min(100, (q / c) * 100) : 0}%`, background: q > 0 ? "#ffc700" : RED }} />
            </div>
            <div className="mt-1 flex justify-between text-[10.5px] text-mute">
              <span>Hot quota ${short(q)} / ${short(c)}</span>
              <span style={{ color: frozen.length ? ICE : undefined }}>{frozen.length ? `${frozen.map((v) => tierName(v.id)).join(" + ")} frozen ${dur(frozenFor)}` : "No vault frozen"}</span>
            </div>
          </div>
        )
      })}
      <div className="flex justify-between bg-coal-2 px-3 py-2 font-mono text-[10.5px] text-mute">
        <span>Registry <span className={live.activeConfirmed ? "text-[#E5484D]" : "text-cream"}>{live.activeConfirmed}</span></span>
        <span>ETH/USD <span className="text-cream">{live.ethUsd.toLocaleString("en-US")}</span></span>
        <span>blk <span className="text-cream">{live.block.toLocaleString("en-US")}</span></span>
        <span>{live.orgs[0]?.mode}</span>
      </div>
    </div>
  )
}

const DECISION = ["None", "Approve", "Reject", "Pending"]
const DECISION_COLOR = ["#6a665e", GREEN, RED, "#fcad17"]

function VerdictMix({ events, org }: { events: ChainEvent[]; org: string }) {
  const counts = [0, 0, 0, 0]
  let fast = 0
  let manual = 0
  for (const e of events) {
    if (e.org?.letter !== org) continue
    if (e.name === "VerdictRecorded") counts[Number(e.args.decision)] = (counts[Number(e.args.decision)] ?? 0) + 1
    if (e.name === "Executed") e.args.manual ? manual++ : fast++
  }
  const total = counts[1] + counts[2] + counts[3]
  const R = 30
  const C = 2 * Math.PI * R
  let off = 0
  return (
    <div className="flex items-center gap-4 px-3 py-3">
      <svg width="84" height="84" viewBox="0 0 84 84" className="shrink-0 -rotate-90">
        <circle cx="42" cy="42" r={R} fill="none" stroke="#ffffff" strokeOpacity="0.06" strokeWidth="11" />
        {[1, 2, 3].map((d) => {
          const len = total ? (counts[d] / total) * C : 0
          const el = <circle key={d} cx="42" cy="42" r={R} fill="none" stroke={DECISION_COLOR[d]} strokeWidth="11" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} />
          off += len
          return el
        })}
        <text x="42" y="46" textAnchor="middle" fontSize="15" fontWeight="600" fill="#fff1c1" transform="rotate(90 42 42)">{total}</text>
      </svg>
      <div className="grid flex-1 gap-1 text-[11.5px]">
        {[1, 2, 3].map((d) => (
          <div key={d} className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-dim"><span className="h-2 w-2 rounded-[2px]" style={{ background: DECISION_COLOR[d] }} />{DECISION[d]}</span>
            <span className="font-mono text-cream">{counts[d]} <span className="text-mute">{total ? `${Math.round((counts[d] / total) * 100)}%` : ""}</span></span>
          </div>
        ))}
        <div className="mt-1 border-t border-white/[0.05] pt-1 text-[10.5px] text-mute">Paid out: {fast} automatic · {manual} manual (two officers)</div>
      </div>
    </div>
  )
}

function tapeRow(e: ChainEvent): { label: string; amount: string; color: string } | null {
  const a = tokenAmount(e.args.token, e.args.amount)
  const amt = a.sym === "?" ? "" : `${short(a.value)} ${a.sym}`
  switch (e.name) {
    case "VerdictRecorded": {
      const d = Number(e.args.decision)
      return { label: `Verdict ${DECISION[d] ?? d}`, amount: "", color: DECISION_COLOR[d] ?? "#9a9488" }
    }
    case "Executed": return { label: e.args.manual ? "Paid out · manual" : "Paid out · automatic", amount: amt, color: e.args.manual ? "#fcad17" : GREEN }
    case "QuotaRefilled": return { label: `${tierName((e.tier ?? "hot") as Tier)} quota refilled`, amount: amt, color: GREEN }
    case "QuotaZeroed": return { label: `${tierName((e.tier ?? "hot") as Tier)} quota zeroed`, amount: tokenAmount(e.args.token, 0n).sym, color: RED }
    case "FreezeSet": return Number(e.args.until) > 0 ? { label: `${tierName((e.tier ?? "warm") as Tier)} frozen to ${clock(Number(e.args.until))}`, amount: "", color: ICE } : { label: "Unfrozen", amount: "", color: GREEN }
    case "AlertSet": return { label: `Alert → ${ALERT[Number(e.args.level)] ?? e.args.level}`, amount: "", color: Number(e.args.level) >= 4 ? RED : Number(e.args.level) > 0 ? "#fcad17" : GREEN }
    case "Tightened": return { label: "Tightened by CRE report", amount: "", color: RED }
    case "ThreatAdded": return { label: "Threat listed in registry", amount: "", color: RED }
    case "TopUp": return { label: "Top-up warm → hot", amount: amt, color: "#9a9488" }
    case "Swept": return { label: "Swept to cold", amount: amt, color: "#d6a61f" }
    case "ActionFailed": return { label: "Action failed (receiver)", amount: "", color: "#fcad17" }
    case "ActionStale": return { label: "Report stale (receiver)", amount: "", color: "#fcad17" }
    default: return null
  }
}

function Tape({ events, org }: { events: ChainEvent[]; org: string }) {
  // consecutive identical rows (e.g. a burst of stale reports) collapse into one row with a count
  const rows: { e: ChainEvent; label: string; amount: string; color: string; n: number }[] = []
  for (const e of events.filter((x) => !x.org || x.org.letter === org || x.name === "ThreatAdded").sort((a, b) => byChain(b, a))) {
    const r = tapeRow(e)
    if (!r) continue
    const prev = rows[rows.length - 1]
    if (prev && prev.label === r.label && prev.amount === r.amount) prev.n++
    else if (rows.length < 80) rows.push({ e, ...r, n: 1 })
  }
  return (
    <div className="absolute inset-0 overflow-y-auto">
      <table className="w-full text-[11.5px]">
        <tbody>
          {rows.map(({ e, label, amount, color, n }) => (
            <tr key={`${e.tx}:${e.logIndex}`} className="border-b border-white/[0.03] hover:bg-white/[0.025]">
              <td className="py-1 pl-3 font-mono text-[10.5px] text-mute">{clock(e.time)}</td>
              <td className="py-1 pl-2" style={{ color }}>{label}{n > 1 && <span className="ml-1 text-mute">×{n}</span>}</td>
              <td className="py-1 pl-2 text-right font-mono text-cream">{amount}</td>
              <td className="py-1 pl-2 pr-3 text-right font-mono text-[10px] text-mute" title={e.tx}>{e.tx.slice(0, 6)}…{e.tx.slice(-4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <div className="p-4 text-xs text-mute">No events yet.</div>}
    </div>
  )
}

// ---------------------------------------------------------------- page

export default function Controls() {
  const [params, setParams] = useSearchParams()
  const section = params.get("tab")
  const view = section === "policies" || section === "approvals" ? "policies" : section === "telemetry" || section === "vaults" ? "telemetry" : "protection"
  const live = useLive(readLive, 6000)
  const ev = useLive(readEvents, 8000)
  const [picked, setPicked] = useState<Sel | null>(null)
  const data = live.data
  const events = ev.data ?? []
  const sel: Sel = picked ?? { org: data?.orgs.find((o) => o.alert > 0)?.letter ?? data?.orgs[0]?.letter ?? "A", tier: "hot", sym: "qUSD" }

  const islands: Island[] = (data?.orgs ?? []).map((o) => ({
    org: o.letter,
    name: o.name,
    alert: o.alert,
    columns: o.vaults.map((v) => {
      const cap = usdOf(v.cap ?? v.balance, data!.ethUsd)
      const quota = usdOf(v.quota ?? v.balance, data!.ethUsd)
      const bal = usdOf(v.balance, data!.ethUsd)
      return {
        key: `${o.letter}:${v.id}`,
        tier: v.id,
        fill: v.id === "cold" ? (bal > 0 ? 1 : 0) : cap ? Math.min(1, quota / cap) : 0,
        frozen: (v.frozenUntil ?? 0) > data!.chainTime,
        label: `${v.id.toUpperCase()} ${o.letter}`,
        value: v.id === "cold" ? `$${short(bal)} · ${v.coldDelayHours}h` : `$${short(quota)} / $${short(cap)}`,
      }
    }),
  }))

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto [scrollbar-width:thin]">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div><p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-dim">Security operations / Controls</p><h1 className="text-2xl font-semibold tracking-tight text-cream">Protection & control</h1><p className="mt-1 text-sm text-dim">Verify restrictions, investigate execution, review change authority.</p></div>
        <span className="font-mono text-[11px] text-dim">
          {data ? <>{CHAIN_LABEL} · blk {data.block.toLocaleString("en-US")} · chain time {clock(data.chainTime)} UTC</> : live.error ? "chain unreachable" : "connecting…"}
        </span>
      </div>
      <div className="flex shrink-0 gap-5 overflow-x-auto border-b border-gold/15" aria-label="Control views">
        {([["protection", "Protection overview"], ["telemetry", "Vault telemetry"], ["policies", "Policy & approvals"]] as const).map(([key,label]) => <button key={key} aria-current={view === key ? "page" : undefined} onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set("tab", key); return next })} className={`min-h-10 shrink-0 border-b-2 px-1 font-mono text-[11px] uppercase tracking-[.12em] focus-visible:outline-2 focus-visible:outline-honey ${view === key ? "border-gold-2 text-gold-2" : "border-transparent text-dim hover:text-cream"}`}>{label}</button>)}
      </div>
      {live.error && <p role="status" className="border border-amber/30 bg-amber/5 px-4 py-3 text-sm text-amber">Snapshot refresh failed. {data ? `Showing the last successful read from ${new Date(data.at).toLocaleTimeString()}. Values may be stale.` : "Current control state is unavailable."}</p>}
      {view !== "telemetry" ? data ? <SecurityPosture live={data} events={events} selection={sel} onSelect={setPicked} policy={view === "policies"} eventsReady={!!ev.data} eventsError={ev.error} /> : <div className="min-h-48"><Waiting error={live.error} /></div> : <>
      <p className="text-xs text-dim">Select a vault to link the terrain, historical quota chart and event tape. Candles summarize quota changes; they are not asset prices.</p>
      {ev.error && <p role="status" className="text-xs text-amber">Event refresh unavailable. Historical charts may be incomplete.</p>}
      <div className="grid min-h-[820px] flex-1 grid-cols-1 gap-2 xl:grid-cols-[300px_minmax(0,1fr)_300px] xl:grid-rows-[minmax(380px,1.05fr)_minmax(360px,1fr)]">
        <Widget link={1} title="Vault watchlist" className="h-[420px] xl:row-span-2 xl:h-auto">
          {data ? <Watchlist live={data} events={events} sel={sel} onSelect={setPicked} /> : <Waiting error={live.error} />}
        </Widget>
        <Widget link={1} title="Vault terrain" className="h-[380px] xl:h-auto">
          {data ? (
            <VaultTerrain
              islands={islands}
              active={data.activeConfirmed}
              selected={`${sel.org}:${sel.tier}`}
              onSelect={(key) => {
                const [org, tier] = key.split(":")
                setPicked({ org, tier: tier as Tier, sym: sel.sym })
              }}
            />
          ) : (
            <Waiting error={live.error} />
          )}
        </Widget>
        <div className="flex min-h-0 flex-col gap-2 xl:row-span-2">
          <Widget title="Alert summary" className="shrink-0">
            {data ? <AlertSummary live={data} /> : <div className="h-40"><Waiting error={live.error} /></div>}
          </Widget>
          <Widget link={1} title="Verdict mix" className="shrink-0">
            <VerdictMix events={events} org={sel.org} />
          </Widget>
          <Widget link={1} title="Event tape" className="h-[360px] xl:h-auto xl:flex-1">
            <Tape events={events} org={sel.org} />
          </Widget>
        </div>
        <div className="h-[360px] xl:h-auto xl:col-start-2 xl:row-start-2">
          {data ? <ChartWidget live={data} events={events} sel={sel} /> : <Widget title="Chart" className="h-full"><Waiting error={live.error} /></Widget>}
        </div>
      </div>
      </>}
    </div>
  )
}

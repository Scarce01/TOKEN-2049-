import { useEffect, useMemo, useRef, useState } from 'react'
import { Decision, Kind } from '../shared/constants'
import { ALERT, CHAIN_LABEL, ORGS, readEvents, readLive, tokenAmount, usdOf, useLive, type ChainEvent, type Live, type LiveOrg } from '../live/chain'
import { HANDLERS, readPatrol, toMap, type HandlerState, type PatrolStatus } from '../live/bridge'

// Security console side panel. Network view: every exchange in the deployment, Patrol status, shared
// threats, activity. Exchange view: reserves, vault policy, protected-asset and CUSUM plots, activity.
// Every value is read from the fork (contracts, events) or from the Patrol scheduler's status.

const TIER = { hot: '#F5CF63', warm: '#E2B52E', cold: '#A9770F' } as const // honey shades (light->dark), distinguishable by lightness
const KIND_NAME = Object.fromEntries(Object.entries(Kind).map(([k, v]) => [v, k.toLowerCase().replace(/_/g, ' ')]))
const DECISION_NAME = Object.fromEntries(Object.entries(Decision).map(([k, v]) => [v, k]))
const DAY = 86400

const usd = (n: number): string => {
  if (n < 0) return `-${usd(-n)}`
  return n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
const num = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d })
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`
const hhmmss = (t: number) => (t ? new Date(t * 1000).toISOString().slice(11, 19) : '--:--:--')
function left(sec: number) {
  if (sec <= 0) return ''
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m ${sec % 60}s` : `${sec}s`
}
const ago = (ms: number) => (ms < 60e3 ? `${Math.max(0, Math.round(ms / 1e3))}s ago` : `${Math.round(ms / 60e3)}m ago`)

type Tone = 'good' | 'warn' | 'crit' | 'idle'
const TONE: Record<Tone, string> = { good: 'bg-[#E2B52E]', warn: 'bg-[#E2B52E]', crit: 'bg-[#ff6b5a]', idle: 'bg-white/25' } // honey for everything but red
function orgTone(o: LiveOrg, now: number): Tone {
  if (o.alert >= 4 && o.alertExpiresAt > now) return 'crit'
  if (o.alert > 0 && o.alertExpiresAt > now) return 'warn'
  return 'good'
}
function orgStatus(o: LiveOrg, now: number) {
  const t = orgTone(o, now)
  return t === 'good' ? 'Monitoring' : `Alert ${o.alertLabel} · ${left(o.alertExpiresAt - now)} left`
}

/** One line per event, in console wording. */
function describe(e: ChainEvent, ethUsd: number): { title: string; detail: string; tone?: Tone } {
  const a = e.args
  const amt = () => {
    const x = tokenAmount(a.token, a.amount)
    return `${num(x.value, x.sym === 'qETH' ? 3 : 0)} ${x.sym}`
  }
  switch (e.name) {
    case 'AlertSet': return { title: `Alert ${ALERT[Number(a.level)] ?? a.level}`, detail: `until ${hhmmss(Number(a.expiresAt))} UTC`, tone: Number(a.level) >= 4 ? 'crit' : 'warn' }
    case 'FreezeSet': return { title: 'Vault frozen', detail: `until ${hhmmss(Number(a.until))} UTC`, tone: 'warn' }
    case 'Tightened': return { title: 'Tightened', detail: `${KIND_NAME[Number(a.kind)] ?? `kind ${a.kind}`} · case ${short(String(a.caseId))}`, tone: 'crit' }
    case 'Ping': return { title: 'Patrol ping', detail: `anchor blk ${num(Number(BigInt(String(a.note ?? '0x0'))))}` }
    case 'VerdictRecorded': return { title: `Verdict ${DECISION_NAME[Number(a.decision)] ?? a.decision}`, detail: `reason ${a.publicReason} · ${short(String(a.txHash))}`, tone: Number(a.decision) === 2 ? 'warn' : undefined }
    case 'ActionFailed': return { title: 'Action failed', detail: KIND_NAME[Number(a.kind)] ?? `kind ${a.kind}`, tone: 'warn' }
    case 'ActionStale': return { title: 'Report stale', detail: `case ${short(String(a.caseId ?? '0x'))}`, tone: 'warn' }
    case 'Executed': return { title: a.manual ? 'Manual release paid' : 'Withdrawal paid', detail: `${amt()} → ${short(String(a.to))}` }
    case 'QuotaZeroed': return { title: 'Hot quota set to 0', detail: tokenAmount(a.token, 0n).sym, tone: 'crit' }
    case 'QuotaRefilled': { const q = tokenAmount(a.token, a.quota); return { title: 'Quota refilled', detail: `${num(q.value)} ${q.sym}` } }
    case 'TopUp': return { title: 'Hot vault topped up', detail: amt() }
    case 'Swept': return { title: 'Swept to cold', detail: amt(), tone: 'warn' }
    case 'DelayRaised': return { title: 'Cold timelock raised', detail: `${num(Number(a.delay) / 3600)}h`, tone: 'warn' }
    case 'DelayLowered': return { title: 'Cold timelock lowered', detail: `${num(Number(a.delay) / 3600)}h` }
    case 'ThreatAdded': return { title: 'Threat shared', detail: `${short(String(a.suspect))} · ${e.org?.name ?? 'org'}`, tone: 'crit' }
    case 'AssetCheckpoint': { const x = tokenAmount(a.token, a.assetValue); return { title: 'Asset checkpoint', detail: `${num(x.value, x.sym === 'qETH' ? 3 : 0)} ${x.sym}` } }
    case 'PatrolStateUpdated': return { title: a.alarm ? 'CUSUM alarm' : 'CUSUM checkpoint', detail: `S ${num(Number(a.S))}`, tone: a.alarm ? 'crit' : undefined }
    case 'ThresholdCommitted': return { title: 'Threshold committed', detail: `epoch ${a.epoch}` }
    case 'ThresholdRevealed': return { title: 'Threshold revealed', detail: `epoch ${a.epoch}` }
    default: return { title: e.name, detail: '' }
  }
}

export default function SecurityPanel({ selected, onSelect, hidden }: { selected: string | null; onSelect: (letter: string | null) => void; hidden: boolean }) {
  const live = useLive(readLive, 5000)
  const events = useLive(readEvents, 6000)
  const patrol = useLive(readPatrol, 2000)
  usePatrolBees(patrol.data)
  const [collapsed, setCollapsed] = useState(false)
  // picking an exchange on the map (re)opens the popup
  useEffect(() => { if (selected) setCollapsed(false) }, [selected])

  // real hot quota and alert level for the vault labels on the map, keyed by exchange letter
  useEffect(() => {
    if (!live.data) return
    toMap({ type: 'live', ...Object.fromEntries(live.data.orgs.map((o) => [o.letter, { alert: o.alert, alertLabel: o.alertLabel, quota: o.vaults[0].quota?.qUSD ?? 0 }])) })
  }, [live.data])

  const org = live.data?.orgs.find((o) => o.letter === selected)
  const alerts = live.data?.orgs.filter((o) => orgTone(o, live.data!.chainTime) !== 'good').length ?? 0
  if (hidden) return null
  if (collapsed) {
    return (
      <button onClick={() => setCollapsed(false)} aria-label="Open network panel"
        className="absolute top-4 right-4 z-30 flex items-center gap-2 h-9 pl-3 pr-3.5 rounded-full bg-[#0D0F12]/92 backdrop-blur border border-white/[0.1] shadow-[0_8px_30px_rgba(0,0,0,.5)] text-[12.5px] text-cream hover:border-white/25 transition-colors">
        <span className={`w-1.5 h-1.5 rounded-full ${alerts ? 'bg-[#ff6b5a] animate-pulse' : 'bg-[#E2B52E]'}`} />
        Network{alerts ? ` · ${alerts} alert${alerts > 1 ? 's' : ''}` : ''}
      </button>
    )
  }
  return (
    <div className="absolute top-4 right-4 z-30 w-[440px] h-[564px] max-h-[calc(100%-32px)] flex flex-col rounded-2xl bg-[#0D0F12]/95 backdrop-blur-xl border border-white/[0.08] shadow-[0_24px_80px_rgba(0,0,0,.55)] overflow-hidden">
      {org && live.data ? (
        <ExchangeView org={org} live={live.data} events={events.data ?? []} updatedAt={live.at} onBack={() => onSelect(null)} onClose={() => { onSelect(null); setCollapsed(true) }} />
      ) : (
        <NetworkView live={live.data} error={live.error} events={events.data ?? []} patrol={patrol.data} patrolDown={!!patrol.error && !patrol.data} onSelect={onSelect} onClose={() => setCollapsed(true)} />
      )}
      <footer className="shrink-0 px-5 py-2.5 border-t border-white/[0.06] flex items-center justify-between font-mono text-[10px] text-mute">
        <span>{CHAIN_LABEL} · measured</span>
        <span>{live.data ? `blk ${num(live.data.block)} · ${hhmmss(live.data.chainTime)} UTC` : live.error ? 'chain offline' : 'connecting'}</span>
      </footer>
    </div>
  )
}

function TabBar({ tabs, tab, setTab }: { tabs: readonly string[]; tab: string; setTab: (t: string) => void }) {
  return (
    <div className="shrink-0 px-5 flex gap-5 border-b border-white/[0.06]" role="tablist">
      {tabs.map((t) => (
        <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
          className={`pb-2 -mb-px text-[12.5px] capitalize border-b-2 transition-colors ${tab === t ? 'text-cream border-[#D6A61F]' : 'text-dim border-transparent hover:text-cream'}`}>{t}</button>
      ))}
    </div>
  )
}

function PopupHead({ eyebrow, title, onClose }: { eyebrow?: string; title: React.ReactNode; onClose: () => void }) {
  return (
    <div className="shrink-0 px-5 pt-4 pb-3 flex items-start gap-2">
      <div className="min-w-0">
        {eyebrow && <div className="text-[11.5px] text-dim">{eyebrow}</div>}
        <h2 className="text-[22px] leading-tight font-semibold text-cream tracking-tight truncate">{title}</h2>
      </div>
      <button onClick={onClose} aria-label="Collapse" className="ml-auto w-7 h-7 grid place-items-center rounded-md text-dim hover:text-cream hover:bg-white/[0.06]">
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- network view

function NetworkView({ live, error, events, patrol, patrolDown, onSelect, onClose }: { live?: Live; error?: string; events: ChainEvent[]; patrol?: PatrolStatus; patrolDown: boolean; onSelect: (l: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'overview' | 'patrol' | 'threats' | 'activity'>('overview')
  const now = live?.chainTime ?? 0
  const alerts = live?.orgs.filter((o) => orgTone(o, now) !== 'good').length ?? 0
  const threats = events.filter((e) => e.name === 'ThreatAdded').reverse()
  // accumulate a live hot-quota time series per org, for the expandable bar plot (updates each live poll)
  const seriesRef = useRef<Record<string, { t: number; v: number }[]>>({})
  useEffect(() => {
    if (!live) return
    const t = Date.now() / 1000
    for (const o of live.orgs) {
      const arr = seriesRef.current[o.letter] ?? (seriesRef.current[o.letter] = [])
      const v = o.vaults[0].quota?.qUSD ?? 0
      const last = arr[arr.length - 1]
      if (!last || last.v !== v || t - last.t > 20) { arr.push({ t, v }); if (arr.length > 90) arr.shift() }
    }
  }, [live])
  return (
    <>
      <PopupHead eyebrow="Exchanges" title="Network" onClose={onClose} />
      {error && !live && <p className="px-5 pb-2 text-[12px] text-[#ff8a7a]">Chain unreachable on 127.0.0.1:8545</p>}
      <div className="shrink-0 mx-5 grid grid-cols-3 border-y border-white/[0.06] py-3">
        <Kpi value={live ? live.orgs.length : '\u2026'} label="Connected" />
        <Kpi value={live ? alerts : '\u2026'} label="Active alerts" tone={alerts ? 'crit' : undefined} />
        <Kpi value={live ? live.activeConfirmed : '\u2026'} label="Threats shared" tone={live?.activeConfirmed ? 'warn' : undefined} />
      </div>
      <TabBar tabs={['overview', 'patrol', 'threats', 'activity']} tab={tab} setTab={(t) => setTab(t as typeof tab)} />
      <div className="flex-1 min-h-0 overflow-hidden px-5 py-3">
        {tab === 'overview' && (
          <ul className="space-y-2">
            {(live?.orgs ?? ORGS.map(() => undefined)).map((o, i) =>
              o ? <ExchangeRow key={o.letter} o={o} live={live!} series={seriesRef.current[o.letter] ?? []} onClick={() => { onSelect(o.letter); toMap({ type: 'focus', exchange: o.letter }) }} /> : <li key={i} className="h-[82px] rounded-lg bg-white/[0.02]" />,
            )}
          </ul>
        )}
        {tab === 'patrol' && (
          <>
            <div className="mb-2.5 flex items-center justify-between text-[11.5px]">
              <span className="text-dim">Automatic \u00b7 every {patrol ? patrol.tickEverySec : 60}s</span>
              <span className="text-[#D6A61F]">{patrolDown ? 'scheduler offline' : patrol?.running ? `running \u00b7 ${patrol.running}` : patrol ? `next tick ${Math.max(0, Math.round((patrol.nextTickAt - patrol.now) / 1000))}s` : '\u2026'}</span>
            </div>
            <PatrolTable patrol={patrol} />
          </>
        )}
        {tab === 'threats' && (threats.length === 0 ? <Empty>No entries since deployment</Empty> : (
          <ul className="divide-y divide-white/[0.05]">
            {threats.slice(0, 6).map((t, i) => (
              <li key={`th${i}`} className="py-2 grid grid-cols-[1fr_auto] gap-x-3 text-[12px]">
                <span className="font-mono text-cream">{short(String(t.args.suspect))}</span>
                <span className="text-right text-dim">{t.org?.name ?? 'org'}{!/^0x0*$/.test(String(t.args.parentEvidence ?? '0x0')) ? ' \u00b7 traced' : ''}</span>
                <span className="font-mono text-[10.5px] text-mute">blk {num(t.block)} \u00b7 {hhmmss(t.time)}</span>
                <span className="text-right font-mono text-[10.5px] text-mute">{Number(t.args.expiresAt) > now ? `expires in ${left(Number(t.args.expiresAt) - now)}` : 'expired'}</span>
              </li>
            ))}
          </ul>
        ))}
        {tab === 'activity' && <Activity events={events} ethUsd={live?.ethUsd ?? 0} limit={6} showOrg />}
      </div>
    </>
  )
}

function ExchangeRow({ o, live, series, onClick }: { o: LiveOrg; live: Live; series: { t: number; v: number }[]; onClick: () => void }) {
  const tone = orgTone(o, live.chainTime)
  const parts = o.vaults.map((v) => usdOf(v.balance, live.ethUsd))
  const total = parts.reduce((a, b) => a + b, 0)
  const hot = o.vaults[0]
  const alerted = tone !== 'good'
  const [expanded, setExpanded] = useState(false)
  return (
    <li className="rounded-lg bg-white/[0.025] border border-white/[0.05] overflow-hidden">
      <button onClick={onClick} className="w-full text-left px-3.5 pt-3 pb-2 hover:bg-white/[0.035] transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-cream">{o.name}</span>
          <span className={`ml-1 w-1.5 h-1.5 rounded-full ${TONE[tone]}`} />
          <span className={`text-[11.5px] ${tone === 'crit' ? 'text-[#ff8a7a]' : 'text-[#E2B52E]'}`}>{orgStatus(o, live.chainTime)}</span>
          <span className="ml-auto text-[13px] font-semibold text-cream tabular-nums">{usd(total)}</span>
        </div>
        <div className="mt-2"><ReserveBar parts={parts} thin /></div>
      </button>
      <button onClick={() => setExpanded((e) => !e)} aria-expanded={expanded} title="Show the hot quota over time"
        className="w-full text-left px-3.5 pb-2.5 pt-0.5 hover:bg-white/[0.035] transition-colors">
        <div className="flex items-center gap-2 text-[11px] text-dim">
          <span className="w-[86px]">Hot quota</span>
          <Meter value={hot.quota?.qUSD ?? 0} max={hot.cap?.qUSD ?? 0} thin />
          <span className="w-[86px] text-right font-mono text-[10.5px] text-cream">{num(hot.quota?.qUSD ?? 0)} / {num(hot.cap?.qUSD ?? 0)}</span>
          <svg width="11" height="11" viewBox="0 0 12 12" className={`shrink-0 text-mute transition-transform ${expanded ? 'rotate-180' : ''}`}><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        {alerted && (
          <div className="mt-1.5 flex items-center gap-2 text-[11px]">
            <span className="w-[86px] text-dim">Temp vault</span>
            <span className="font-mono text-[11.5px] text-[#E2B52E]">{usd(total)}</span>
            <span className="ml-auto font-mono text-[10px] text-mute">funds secured</span>
          </div>
        )}
      </button>
      {expanded && (
        <div className="px-3.5 pb-3">
          <div className="mb-1 font-mono text-[10px] text-dim">Hot quota (qUSD) over time {'·'} live</div>
          <Spark points={series} format={num} empty="Watching the hot quota (builds up live)" />
        </div>
      )}
    </li>
  )
}

function PatrolTable({ patrol }: { patrol?: PatrolStatus }) {
  if (!patrol) return <Empty>Waiting for the Patrol scheduler (fork bridge, port 8790)</Empty>
  return (
    <ul className="space-y-1.5">
      {HANDLERS.map((h) => {
        const s = patrol.handlers[h]
        const runs = patrol.history.filter((x) => x.handler === h).slice(0, 12).reverse()
        const tone: Tone = s.status === 'ok' ? 'good' : s.status === 'fail' ? 'crit' : s.status === 'run' ? 'warn' : 'idle'
        return (
          <li key={h} className="grid grid-cols-[10px_76px_1fr_auto] items-center gap-2 text-[11.5px]">
            <span className={`w-1.5 h-1.5 rounded-full ${TONE[tone]} ${s.status === 'run' ? 'animate-pulse' : ''}`} />
            <span className="text-cream capitalize">{h}</span>
            <span className="flex gap-[3px] items-center" title="last runs, oldest first">
              {runs.map((r, i) => <span key={i} className={`w-[5px] h-[12px] rounded-[2px] ${r.status === 'ok' ? 'bg-[#E2B52E]/70' : 'bg-[#ff6b5a]/80'}`} />)}
              {s.status === 'run' && <span className="w-[5px] h-[12px] rounded-[2px] bg-[#E2B52E] animate-pulse" />}
            </span>
            <span className="font-mono text-[10.5px] text-mute text-right" title={s.result}>
              {s.status === 'run' ? 'running' : s.finishedAt ? `${s.result && s.result.length < 22 ? s.result : s.status} · ${ago(patrol.now - s.finishedAt)}` : 'not run yet'}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------- exchange view

function ExchangeView({ org, live, events, updatedAt, onBack, onClose }: { org: LiveOrg; live: Live; events: ChainEvent[]; updatedAt?: number; onBack: () => void; onClose: () => void }) {
  const [tab, setTab] = useState<'overview' | 'policy' | 'patrol' | 'activity'>('overview')
  const now = live.chainTime
  const mine = useMemo(() => events.filter((e) => e.org?.letter === org.letter), [events, org.letter])
  const day = mine.filter((e) => e.time > now - DAY)
  const tone = orgTone(org, now)
  const [hot, warm, cold] = org.vaults
  const parts = org.vaults.map((v) => usdOf(v.balance, live.ethUsd))
  const total = parts.reduce((a, b) => a + b, 0)
  const lastTight = [...mine].reverse().find((e) => e.name === 'Tightened')
  const incidents = new Set(day.filter((e) => e.name === 'Tightened').map((e) => String(e.args.caseId))).size
  const warmFrozen = (warm.frozenUntil ?? 0) > now
  const hotFrozen = (hot.frozenUntil ?? 0) > now
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t) }, [])
  return (
    <>
      <div className="shrink-0 px-5 pt-3.5 flex items-center gap-2 text-[12.5px]">
        <button onClick={onBack} className="text-dim hover:text-cream">Exchanges</button>
        <span className="text-mute">/</span>
        <span className="text-cream">{org.name}</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => toMap({ type: 'focus', exchange: org.letter })} aria-label="Locate on map" title="Locate on map" className="w-7 h-7 grid place-items-center rounded-md text-dim hover:text-cream hover:bg-white/[0.06]">
            <svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="7" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M8 13.5C8 13.5 13 10 13 6.5A5 5 0 0 0 3 6.5C3 10 8 13.5 8 13.5Z" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
          </button>
          <button onClick={onClose} aria-label="Collapse" className="w-7 h-7 grid place-items-center rounded-md text-dim hover:text-cream hover:bg-white/[0.06]">
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>
      <div className="shrink-0 px-5 pt-1.5 flex items-center gap-2">
        <h2 className="text-[24px] leading-tight font-semibold text-cream tracking-tight">{org.name}</h2>
        <span className={`w-2 h-2 rounded-full ${TONE[tone]}`} />
        <span className={`text-[12px] ${tone === 'crit' ? 'text-[#ff8a7a]' : 'text-[#E2B52E]'}`}>{orgStatus(org, now)}</span>
        <span className="ml-auto text-[11px] text-mute">{org.mode}{updatedAt ? ` \u00b7 ${ago(Date.now() - updatedAt)}` : ''}</span>
      </div>
      <div className="shrink-0 mx-5 mt-3 grid grid-cols-3 border-y border-white/[0.06] py-3">
        <Kpi value={day.filter((e) => e.name === 'Executed').length} label="Withdrawals / 24h" />
        <Kpi value={incidents} label="Incidents / 24h" tone={incidents ? 'crit' : undefined} />
        <Kpi value={mine.filter((e) => e.name === 'ThreatAdded').length} label="Threats reported" />
      </div>
      <TabBar tabs={['overview', 'policy', 'patrol', 'activity']} tab={tab} setTab={(t) => setTab(t as typeof tab)} />
      <div className="flex-1 min-h-0 overflow-hidden px-5 py-3">
        {tab === 'overview' && (
          <>
            <p className="text-[13px] text-cream">{tone === 'good' ? 'No active incident.' : `Tightened${lastTight ? ` at blk ${num(lastTight.block)}` : ''}: hot quota ${num(hot.quota?.qUSD ?? 0)}, warm ${warmFrozen ? 'frozen' : 'open'}, cold ${num(cold.coldDelayHours ?? 0)}h.`}</p>
            <div className="mt-3 flex items-baseline justify-between"><span className="text-[13px] text-dim">Reserves</span><span className="text-[16px] font-semibold text-cream">{usd(total)}</span></div>
            <div className="mt-1.5"><ReserveBar parts={parts} /></div>
            <div className="mt-3.5 grid grid-cols-3 gap-2">
              {org.vaults.map((v, i) => (
                <div key={v.id}>
                  <div className="flex items-center gap-1.5 text-[11.5px] text-dim"><span className="w-2 h-2 rounded-[2px]" style={{ background: TIER[v.id] }} />{v.id[0].toUpperCase() + v.id.slice(1)}</div>
                  <div className="mt-0.5 text-[14px] font-semibold text-cream tabular-nums">{usd(parts[i])}</div>
                  <div className="font-mono text-[10px] text-mute">{num(v.balance.qUSD)} qUSD{v.balance.qETH ? ` \u00b7 ${num(v.balance.qETH, 2)} qETH` : ''}</div>
                </div>
              ))}
            </div>
            <p className="mt-3.5 text-[11px] text-mute">Reserves are the on-chain balances of this exchange's hot, warm and cold Quorum vaults.</p>
          </>
        )}
        {tab === 'policy' && (
          <>
            <PolicyRow name="Hot" sub="Withdrawal quota">
              <div className="flex items-center gap-3"><Meter value={hot.quota?.qUSD ?? 0} max={hot.cap?.qUSD ?? 0} /><div className="text-right"><div className="text-[14px] font-semibold text-cream tabular-nums">{num(hot.quota?.qUSD ?? 0)}</div><div className="text-[10.5px] text-dim">of {num(hot.cap?.qUSD ?? 0)}</div></div></div>
            </PolicyRow>
            <PolicyRow name="Hot" sub="Hour / day caps"><Value main={hot.hourCap?.qUSD || hot.dayCap?.qUSD ? `${num(hot.hourCap?.qUSD ?? 0)} / ${num(hot.dayCap?.qUSD ?? 0)}` : 'Off'} sub={hotFrozen ? `Frozen \u00b7 ${left((hot.frozenUntil ?? 0) - now)}` : 'qUSD'} /></PolicyRow>
            <PolicyRow name="Warm" sub="Freeze"><Value main={warmFrozen ? 'Frozen' : 'Open'} sub={warmFrozen ? `${left((warm.frozenUntil ?? 0) - now)} left` : 'No freeze'} tone={warmFrozen ? 'warn' : undefined} /></PolicyRow>
            <PolicyRow name="Cold" sub="Release"><Value main={`${num(cold.coldDelayHours ?? 0)} hours`} sub="Timelock" /></PolicyRow>
          </>
        )}
        {tab === 'patrol' && (
          <div className="space-y-3">
            <div><div className="mb-1 text-[11.5px] text-dim">Asset conservation \u00b7 flat = balanced</div><AssetChart events={mine} ethUsd={live.ethUsd} /></div>
            <div><div className="mb-1 text-[11.5px] text-dim">Outflow CUSUM \u00b7 hot vault</div><CusumChart events={mine} /></div>
            <Value main={org.lastPingBlock ? `Last ping \u00b7 blk ${num(org.lastPingBlock)}` : 'No ping yet'} sub={`${mine.filter((e) => e.name === 'AssetCheckpoint').length} checkpoints \u00b7 ${mine.filter((e) => e.name === 'Ping').length} pings`} />
          </div>
        )}
        {tab === 'activity' && <Activity events={mine} ethUsd={live.ethUsd} limit={7} />}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- charts

/** Patrol's conservation value V = hot + warm + paid out - funded (workflows/patrol assetValue), per
 * checkpoint, all tokens in USD. It stays flat under every legitimate path; a drop is unexplained loss. */
function AssetChart({ events, ethUsd }: { events: ChainEvent[]; ethUsd: number }) {
  const pts = useMemo(() => {
    const by = new Map<number, { t: number; v: number }>()
    for (const e of events) {
      if (e.name !== 'AssetCheckpoint') continue
      const x = tokenAmount(e.args.token, e.args.assetValue)
      const p = by.get(e.block) ?? { t: e.time, v: 0 }
      p.v += x.sym === 'qETH' ? x.value * ethUsd : x.value
      by.set(e.block, p)
    }
    return [...by.values()]
  }, [events, ethUsd])
  return <Spark points={pts} format={usd} empty="Waiting for Patrol asset checkpoints" />
}

/** CUSUM statistic S of the hot vault outflow (PatrolStateUpdated); alarms marked. */
function CusumChart({ events }: { events: ChainEvent[] }) {
  const pts = useMemo(
    () => events.filter((e) => e.name === 'PatrolStateUpdated' && e.tier !== 'warm').map((e) => ({ t: e.time, v: Number(e.args.S), alarm: !!e.args.alarm })),
    [events],
  )
  return <Spark points={pts} format={(v) => `S ${num(v)}`} empty="No CUSUM checkpoints yet (written every 10 min of outflow)" />
}

type Pt = { t: number; v: number; alarm?: boolean }
function Spark({ points, format, empty, line = '#E2B52E' }: { points: Pt[]; format: (v: number) => string; empty: string; line?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const ref = useRef<SVGSVGElement>(null)
  if (points.length < 2) return <Empty>{points.length === 1 ? `1 point · ${format(points[0].v)}` : empty}</Empty>
  const W = 352, H = 84, P = 6
  const t0 = points[0].t, t1 = points[points.length - 1].t || t0 + 1
  const lo = Math.min(...points.map((p) => p.v)), hi = Math.max(...points.map((p) => p.v))
  const span = hi - lo || Math.max(1, Math.abs(hi) * 0.1)
  const x = (t: number) => P + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * P)
  const y = (v: number) => H - P - ((v - (hi - lo ? lo : lo - span / 2)) / span) * (H - 2 * P)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
  const h = hover !== null ? points[hover] : points[points.length - 1]
  const onMove = (ev: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const mx = ((ev.clientX - r.left) / r.width) * W
    let best = 0
    points.forEach((p, i) => { if (Math.abs(x(p.t) - mx) < Math.abs(x(points[best].t) - mx)) best = i })
    setHover(best)
  }
  const id = `g${line.slice(1)}`
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[18px] font-semibold text-cream tabular-nums">{format(h.v)}</span>
        <span className="font-mono text-[10.5px] text-mute">{hhmmss(h.t)} UTC{h.alarm ? ' · alarm' : ''}</span>
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full h-[84px] cursor-crosshair" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={`${points.length} points, latest ${format(points[points.length - 1].v)}`}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={line} stopOpacity=".28" /><stop offset="1" stopColor={line} stopOpacity="0" /></linearGradient>
        </defs>
        <line x1={P} x2={W - P} y1={H - P} y2={H - P} stroke="rgba(255,255,255,.08)" />
        <path d={`${d}L${x(t1).toFixed(1)},${H - P}L${x(t0).toFixed(1)},${H - P}Z`} fill={`url(#${id})`} />
        <path d={d} fill="none" stroke={line} strokeWidth="2" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 4px ${line}66)` }} />
        {points.map((p, i) => p.alarm ? <circle key={i} cx={x(p.t)} cy={y(p.v)} r="4" fill="#ff6b5a" stroke="#0D0F12" strokeWidth="2" /> : null)}
        {hover !== null && <><line x1={x(h.t)} x2={x(h.t)} y1={P} y2={H - P} stroke="rgba(255,255,255,.25)" /><circle cx={x(h.t)} cy={y(h.v)} r="4" fill={line} stroke="#0D0F12" strokeWidth="2" /></>}
      </svg>
      <div className="flex justify-between font-mono text-[10px] text-mute"><span>{hhmmss(t0)}</span><span>{points.length} points</span><span>{hhmmss(t1)}</span></div>
    </div>
  )
}

/** Hot / warm / cold share of the reserves: 2px gaps, rounded ends, warm glow on the hot segment. */
function ReserveBar({ parts, thin }: { parts: number[]; thin?: boolean }) {
  const total = parts.reduce((a, b) => a + b, 0)
  const ids = ['hot', 'warm', 'cold'] as const
  if (!total) return <div className={`${thin ? 'h-1.5' : 'h-2.5'} rounded-full bg-white/[0.06]`} title="No reserves in the vaults" />
  return (
    <div className={`flex gap-[2px] ${thin ? 'h-1.5' : 'h-2.5'}`}>
      {parts.map((p, i) => p > 0 && (
        <div key={ids[i]} title={`${ids[i]} ${usd(p)} (${Math.round((p / total) * 100)}%)`} className="h-full rounded-full first:rounded-l-full last:rounded-r-full"
          style={{ width: `${(p / total) * 100}%`, minWidth: 4, background: TIER[ids[i]], boxShadow: ids[i] === 'hot' ? '0 0 10px rgba(226,181,46,.45)' : undefined }} />
      ))}
    </div>
  )
}

/** Single-value meter with the warm gold glow; empty track turns red-tinted at 0. */
function Meter({ value, max, thin }: { value: number; max: number; thin?: boolean }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className={`flex-1 ${thin ? 'h-1' : 'h-1.5'} rounded-full ${value === 0 && max ? 'bg-[#ff6b5a]/25' : 'bg-white/[0.08]'}`}>
      <div className="h-full rounded-full bg-gradient-to-r from-[#B98C1A] via-[#E2B52E] to-[#F5CF63]"
        style={{ width: `${pct}%`, boxShadow: pct ? '0 0 10px rgba(245,207,99,.5), 0 0 2px rgba(255,236,170,.8)' : undefined }} />
    </div>
  )
}

// ---------------------------------------------------------------- small pieces

function Activity({ events, ethUsd, limit, showOrg }: { events: ChainEvent[]; ethUsd: number; limit: number; showOrg?: boolean }) {
  const rows = events.slice(-limit).reverse()
  if (!rows.length) return <Empty>No events since deployment</Empty>
  return (
    <ul className="divide-y divide-white/[0.05]">
      {rows.map((e, i) => {
        const x = describe(e, ethUsd)
        return (
          <li key={`${e.tx}:${e.logIndex}:${i}`} className="py-2.5 grid grid-cols-[66px_1fr] gap-x-3">
            <span className="font-mono text-[11px] text-mute pt-0.5">{hhmmss(e.time)}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[13px] text-cream">
                {x.tone && <span className={`w-1.5 h-1.5 rounded-full ${TONE[x.tone]}`} />}
                <span className="truncate">{x.title}</span>
                {showOrg && e.org && <span className="ml-auto shrink-0 text-[11px] text-dim">{e.org.name}</span>}
              </div>
              <div className="text-[11.5px] text-dim truncate">{x.detail}{e.tier ? ` · ${e.tier}` : ''} · blk {num(e.block)}</div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function Kpi({ value, label, tone }: { value: React.ReactNode; label: string; tone?: Tone }) {
  return (
    <div className="px-3 first:pl-0 border-l first:border-l-0 border-white/[0.06]">
      <div className={`text-[26px] leading-none font-semibold tabular-nums ${tone === 'crit' ? 'text-[#ff8a7a]' : tone === 'warn' ? 'text-[#E2B52E]' : 'text-cream'}`}>{value}</div>
      <div className="mt-1.5 text-[12px] text-dim">{label}</div>
    </div>
  )
}

function Section({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-baseline justify-between border-b border-white/[0.06] pb-2">
        <h3 className="text-[17px] font-semibold text-cream">{title}</h3>
        {right && <span className="text-[12px] text-[#D6A61F]">{right}</span>}
      </div>
      {children}
    </section>
  )
}

function PolicyRow({ name, sub, children }: { name: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="py-3 grid grid-cols-[120px_1fr] items-center gap-3 border-b border-white/[0.05] last:border-b-0">
      <div><div className="text-[15px] font-semibold text-cream">{name}</div><div className="text-[12px] text-dim">{sub}</div></div>
      <div className="flex justify-end">{children}</div>
    </div>
  )
}

function Value({ main, sub, tone }: { main: string; sub?: string; tone?: Tone }) {
  return (
    <div className="text-right">
      <div className={`text-[15px] font-semibold tabular-nums ${tone === 'warn' ? 'text-[#E2B52E]' : 'text-cream'}`}>{main}</div>
      {sub && <div className="text-[11.5px] text-dim">{sub}</div>}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-[12px] text-mute">{children}</p>
}

// ---------------------------------------------------------------- bees

/** Turns scheduler status changes into map messages: a handler starts -> bees fly its route; it ends -> result. */
function usePatrolBees(p?: PatrolStatus) {
  const seen = useRef<{ running: string | null; done: Record<string, number> }>({ running: null, done: {} })
  useEffect(() => {
    if (!p) return
    const s = seen.current
    for (const h of HANDLERS) {
      const st: HandlerState = p.handlers[h]
      if (st.finishedAt && st.finishedAt !== s.done[h]) {
        const first = s.done[h] === undefined
        s.done[h] = st.finishedAt
        if (!first) {
          const reports: Record<string, { block: number; tx: string }> = {}
          for (const r of st.reports ?? []) reports[r.org] = { block: r.block, tx: r.tx }
          toMap({ type: 'patrol', handler: h, status: st.status === 'ok' ? 'ok' : 'fail', reports })
        }
      }
    }
    if (p.running && p.running !== s.running) toMap({ type: 'patrol', handler: p.running, status: 'run', reports: {} })
    s.running = p.running
  }, [p])
}

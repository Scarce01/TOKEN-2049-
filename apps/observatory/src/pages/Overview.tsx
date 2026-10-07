import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { PANEL_SHARE, type SceneState, type ViewCmd } from '../components/World'
import HexWorld from '../components/HexWorld'
import { DetailPanel } from '../components/WorldDetail'
import { DECOYS, DISTRICTS, STEPS, T, TR, stepAt, traceCaption, type WorldMode } from '../components/worldData'
import { useReplay } from '../components/replay'
import SecurityPanel from '../components/SecurityPanel'
import AttackTimeline from '../components/AttackTimeline'
import { ORGS, readLive, useLive } from '../live/chain'
import { BRIDGE, runAttack, toMap } from '../live/bridge'

const MODES: [WorldMode, string][] = [['live', 'Live'], ['trace', 'Trace origin']]
const LEGEND: [React.ReactNode, string][] = [
  [<span className="w-2.5 h-2.5 clip-hex bg-[#ffb52e] shadow-[0_0_8px_#ffb52e]" />, 'Decoy · armed'],
  [<span className="w-2.5 h-2.5 clip-hex bg-[#ff3b24]" />, 'Decoy · triggered'],
  [<svg width="12" height="10" viewBox="0 0 12 10"><path d="M1 1h10L6 9z" fill="#E5484D" /></svg>, 'Malicious interaction'],
  [<svg width="22" height="4"><line x1="0" y1="2" x2="22" y2="2" stroke="#FFC54A" strokeWidth="2" strokeDasharray="1.5 3" /></svg>, 'Signal in transit'],
  [<span className="w-2 h-2 rounded-full bg-[#d6a61f]" />, 'Protected agency'],
  [<span className="w-2 h-2 rounded-full border border-[#8a877f]" />, 'Not onboarded'],
]

export default function Overview() {
  // deep links: /?mode=trace · /?t=11.5 · /?select=decoy
  const [sp] = useSearchParams()
  const qMode = (MODES.find(([m]) => m === sp.get('mode'))?.[0] ?? 'live') as WorldMode
  const qT = sp.has('t') ? Math.min(T.end, Math.max(0, Number(sp.get('t')) || 0)) : -1
  const qTr = qMode === 'trace' ? (sp.has('tr') ? Number(sp.get('tr')) || 0 : 0) : -1
  const S = useRef<SceneState>({ t: qT, tr: qTr, mode: qMode, selected: null, hover: null })
  const [mode, setMode] = useState<WorldMode>(qMode)
  const [selected, setSelected] = useState<string | null>(sp.get('select'))
  const [t, setT] = useState(qT)
  const [tr, setTr] = useState(qTr)
  const [playing, setPlaying] = useState(qMode === 'trace' && !sp.has('tr'))
  const [legend, setLegend] = useState(false)
  // keep the last inspected object mounted while the panel slides out
  const [panelId, setPanelId] = useState<string | null>(selected)
  useEffect(() => { if (selected) setPanelId(selected) }, [selected])
  const [view, setView] = useState<ViewCmd>({ kind: 'reset', n: 0 })
  const cmd = (kind: ViewCmd['kind']) => { if (kind === 'reset') setSelected(null); setView((v) => ({ kind, n: v.n + 1 })) }
  const { set: setReplay } = useReplay()

  // one clock drives both the incident replay and Trace Origin
  useEffect(() => {
    if (!playing) return
    let raf = 0, last = performance.now(), acc = 0
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      const s = S.current
      if (mode === 'trace') { s.tr = Math.min(TR.end, s.tr + dt); if (s.tr >= TR.end) setPlaying(false) }
      else { s.t = Math.min(T.end, s.t + dt); if (s.t >= T.end) setPlaying(false) }
      acc += dt
      if (acc > 0.08 || !playing) { acc = 0; setT(s.t); setTr(s.tr) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); setT(S.current.t); setTr(S.current.tr) }
  }, [playing, mode])

  useEffect(() => {
    setReplay(mode === 'trace' ? 'trace' : t >= 0 ? (playing ? 'replay' : 'paused') : 'live')
  }, [mode, t, playing, setReplay])
  useEffect(() => () => setReplay('live'), [setReplay])

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSelected(null); setExchange(null); toMap({ type: 'home' }) } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  const setClock = (v: number) => { S.current.t = v; setT(v) }
  const play = () => {
    if (mode === 'trace') changeMode('live')
    setSelected(null)
    if (S.current.t < 0 || S.current.t >= T.end) setClock(0)
    setPlaying(true)
  }
  const reset = () => { setPlaying(false); setClock(-1); S.current.tr = -1; setTr(-1) }
  const stepFwd = () => {
    setPlaying(false)
    if (mode === 'trace') { const n = [...TR.cut, TR.area, TR.found, TR.end].find((x) => x > S.current.tr + 0.01) ?? TR.end; S.current.tr = n; setTr(n); return }
    const next = STEPS.find((s) => s.at > S.current.t + 0.01)
    setClock(next ? next.at + 0.01 : T.end)
  }
  const changeMode = (m: WorldMode) => {
    setPlaying(false)
    setSelected(null)
    if (m === 'trace') { S.current.tr = 0; setTr(0); setMode(m); setPlaying(true); return }
    S.current.tr = -1; setTr(-1)
    setMode(m)
  }
  // Map clicks. A connected exchange (its land or vaults) opens its view in the security panel; the same
  // land again, or empty space, goes back. Other land opens the detail panel; with any panel open, a click
  // on land or empty space closes it. Objects (decoys) always open or switch the detail panel.
  const [exchange, setExchange] = useState<string | null>(null)
  const open = useRef({ selected, exchange })
  open.current = { selected, exchange }
  const onSelect = useCallback((id: string | null) => {
    const letter = id?.match(/^(?:vault|area):ag-([a-z])$/)?.[1]?.toUpperCase()
    const { selected: cur, exchange: ex } = open.current
    if (letter && ORGS.some((o) => o.letter === letter)) {
      setSelected(null)
      setExchange(id!.startsWith('area:') && ex === letter ? null : letter)
      return
    }
    if (id === null || id.startsWith('area:')) {
      if (cur || ex) { setSelected(null); setExchange(null) } else if (id) setSelected(id)
      return
    }
    setSelected(id)
  }, [])

  // Leaving the focused ("special") view returns the camera to the original angle. Fires however the panel
  // closes: its X, the Escape key, a back/collapse, or another click on the map or interface.
  const wasFocused = useRef(false)
  useEffect(() => {
    const focused = !!selected || !!exchange
    if (wasFocused.current && !focused) toMap({ type: 'home' })
    wasFocused.current = focused
  }, [selected, exchange])

  const tracing = mode === 'trace'
  const step = stepAt(t)
  const progress = tracing ? Math.max(0, tr) / TR.end : t < 0 ? 0 : t / T.end
  // idle caption reflects the real fork state: a raised alert is never shown as "nominal"
  const live = useLive(readLive, 6000)
  const alerted = live.data?.orgs.filter((o) => o.alert > 0 && o.alertExpiresAt > live.data!.chainTime) ?? []
  const idle = alerted.length ? `${alerted.map((o) => `${o.name} alert ${o.alertLabel}`).join(' · ')} · live` : 'All systems nominal · press attack'
  const caption = tracing ? traceCaption(Math.max(0, tr)) : step >= 0 ? STEPS[step].label : idle

  // Live attack: the button runs the real backend flow on the fork; each on-chain response plays as a map
  // beat (no scrubber). Beat values are positions on the map's own 0-18s visual clock.
  const BEAT: Record<string, number> = { start: 0, scan: 0.4, probe: 0.9, tripwire: 1.3, verify: 1.7, report: 4, QuotaZeroed: 4, FreezeSet: 5, Swept: 6, DelayRaised: 6.5, ThreatAdded: 8, done: 10 }
  const [atk, setAtk] = useState<{ busy: boolean; status: string; tx?: string; block?: number; done?: boolean; resetting?: boolean; err?: string }>({ busy: false, status: '' })
  const atkOrg = useRef<string | null>(null)
  const runAttackDemo = async () => {
    if (atk.busy) return
    if (mode !== 'live') changeMode('live')
    setSelected(null)
    atkOrg.current = null
    sawAlert.current = false
    setAtk({ busy: true, status: 'Attacker compromises the exchange backend' })
    toMap({ type: 'beat', t: 0 })
    try {
      await runAttack((e) => {
        if (e.type === 'error') { setAtk((a) => ({ ...a, busy: false, err: e.message })); return }
        if (e.type === 'start') { atkOrg.current = e.org; toMap({ type: 'home' }); return } // overview angle; the verify step runs the attack -> CRE -> NOWNodes -> hornet choreography at one consistent angle
        if (e.type === 'done') {
          // attacker trapped -> finale: blue trail settles back to the decoy
          toMap({ type: 'beat', t: BEAT.done }) // 10: caged, cash-out held
          setTimeout(() => toMap({ type: 'beat', t: 13.6 }), 2200) // blue trail settles back to the decoy
          setTimeout(() => toMap({ type: 'beat', t: 16 }), 5200) // settle: attacker neutralised, deposit held
          setTimeout(() => toMap({ type: 'fund' }), 4200) // trail back: the ground flattens and the walled reserve rises (until Reset)
          setAtk({ busy: false, done: true, status: 'Attacker trapped · funds held in the temporary-lane reserve' })
          return
        }
        const key = e.type === 'response' ? e.event : e.phase
        if (BEAT[key] !== undefined) toMap({ type: 'beat', t: BEAT[key] })
        // integrated CRE + NOWNodes verification card on the map
        if (e.type === 'step' && e.phase === 'verify') toMap({ type: 'verify', phase: 'run', exchange: e.org })
        if (e.type === 'step' && e.phase === 'verified') toMap({ type: 'verify', phase: 'done', exchange: e.org, cre: e.cre, nownodes: e.nownodes, verdict: e.verdict })
        setAtk({ busy: true, status: e.detail, tx: e.tx, block: e.block })
      })
    } catch (err) {
      setAtk((a) => ({ ...a, busy: false, err: err instanceof Error ? err.message : String(err) }))
    }
  }
  // recovery: once the attacked org's alert clears (reset or TTL), return the map to calm and free the bees.
  // Only after the live read has shown the alert raised: 'done' lands about 1 s after the alert, before the next
  // 6 s live poll, and that stale pre-attack read must not count as "cleared" (it wiped the finale).
  const atkAlerted = !!atkOrg.current && !!live.data && live.data.orgs.some((o) => o.letter === atkOrg.current && o.alert > 0 && o.alertExpiresAt > live.data!.chainTime)
  const sawAlert = useRef(false)
  if (atkAlerted) sawAlert.current = true
  const atkRecovered = sawAlert.current && !atkAlerted
  const recovering = useRef(false)
  useEffect(() => {
    if (atk.done && atkRecovered && !recovering.current) {
      recovering.current = true
      toMap({ type: 'beat', t: 0 }) // alert cleared -> the map returns to calm, bees resume patrol
      setAtk((a) => ({ ...a, status: 'Exchange standing down · patrol resumed' }))
      setTimeout(() => { atkOrg.current = null; sawAlert.current = false; recovering.current = false; setAtk({ busy: false, status: '' }) }, 1500)
    }
  }, [atk.done, atkRecovered])
  // Reset: after an attack the button becomes Reset. It reverts the fork to the clean post-setup snapshot and
  // returns the map to calm, so the next run starts fresh. done:false up front so the recovery effect won't also fire.
  const resetDemo = async () => {
    if (atk.busy) return
    recovering.current = false
    setAtk({ busy: true, done: false, resetting: true, status: 'Resetting the fork to a clean state…' })
    try {
      await fetch(`${BRIDGE}/reset`, { method: 'POST' }).catch(() => null)
    } finally {
      atkOrg.current = null
      sawAlert.current = false
      toMap({ type: 'beat', t: 0 })
      toMap({ type: 'home' })
      setAtk({ busy: false, status: '' })
    }
  }

  const done = tracing ? tr >= TR.end : t >= T.end

  return (
    <section className="relative h-full overflow-hidden bg-[#0f1526]">
      <div className="absolute inset-0">
        <HexWorld t={t} view={view} onSelect={onSelect} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#070a12]/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#070a12]/80 to-transparent" />

      {/* mode switcher */}
      <div className="absolute top-4 left-5 z-20 flex items-center gap-3">
        <div className="flex p-0.5 rounded-lg bg-[#0F1115]/80 backdrop-blur border border-white/[0.06]" role="tablist" aria-label="World mode">
          {MODES.map(([m, l]) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => changeMode(m)}
              className={`h-7 px-3 rounded-md font-mono text-[10.5px] uppercase tracking-[0.12em] transition-colors ${mode === m ? 'bg-[#D6A61F]/15 text-[#E2B52E]' : 'text-dim hover:text-cream'}`}>{l}</button>
          ))}
        </div>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-mute">{`Hive City · ${7 + DISTRICTS.length} agencies mapped · 5 protected · ${DECOYS.length} decoys`}</span>
      </div>

      <SecurityPanel selected={exchange} onSelect={setExchange} hidden={!!selected} />

      {/* inspection mode — right half; the world keeps the left */}
      <div className={`absolute top-0 right-0 bottom-0 z-30 transition-[transform,opacity] duration-500 ease-[cubic-bezier(.2,.7,.2,1)] ${selected ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none'}`} style={{ width: `${PANEL_SHARE * 100}%` }}>
        {panelId && <DetailPanel key={panelId} id={panelId} t={t} trace={tracing} traceT={tr} onClose={() => setSelected(null)} />}
      </div>

      {/* legend */}
      <div className={`absolute left-5 bottom-5 z-20 transition-opacity duration-300 ${selected ? 'opacity-0 pointer-events-none' : ''}`}>
        {legend && (
          <ul className="panel-in mb-2 w-[210px] p-3 space-y-1.5 rounded-lg bg-[#0F1115]/90 backdrop-blur border border-white/[0.06]">
            {LEGEND.map(([g, l]) => <li key={l} className="flex items-center gap-2.5 text-[11.5px] text-dim"><span className="w-[22px] grid place-items-center">{g}</span>{l}</li>)}
          </ul>
        )}
        <button onClick={() => setLegend(!legend)} aria-expanded={legend} className="h-8 px-3 rounded-md bg-[#0F1115]/80 backdrop-blur border border-white/[0.06] font-mono text-[10.5px] uppercase tracking-[0.12em] text-dim hover:text-cream">Legend</button>
      </div>

      {/* view controls — full orbit; right-drag also rotates */}
      <div className={`absolute right-5 bottom-5 z-20 flex items-center gap-2 transition-opacity duration-300 ${selected ? 'opacity-0 pointer-events-none' : ''}`}>
        <span className="hidden 2xl:block font-mono text-[10px] uppercase tracking-[0.12em] text-mute">Drag orbit · right-drag pan · scroll zoom</span>
        <div className="flex items-center p-0.5 rounded-lg bg-[#0F1115]/80 backdrop-blur border border-white/[0.06]">
          <Ctl label="Orbit left" onClick={() => cmd('left')}><path d="M5 3 2 6l3 3M2.5 6H9a3 3 0 0 1 0 6H7" fill="none" stroke="currentColor" strokeWidth="1.3" /></Ctl>
          <Ctl label="Orbit right" onClick={() => cmd('right')}><path d="M9 3l3 3-3 3M11.5 6H5a3 3 0 0 0 0 6h2" fill="none" stroke="currentColor" strokeWidth="1.3" /></Ctl>
          <Ctl label="Top view" onClick={() => cmd('top')}><path d="M7 1.8 11.5 4.4v5.2L7 12.2 2.5 9.6V4.4z" fill="none" stroke="currentColor" strokeWidth="1.3" /><circle cx="7" cy="7" r="1.2" fill="currentColor" /></Ctl>
          <Ctl label="Reset view" onClick={() => cmd('reset')}><path d="M2.5 7a4.5 4.5 0 1 0 1.4-3.3M2.5 2v2.6h2.6" fill="none" stroke="currentColor" strokeWidth="1.3" /></Ctl>
        </div>
      </div>

      {/* left pop-out: one card per stage of the real attack (bridge /attack/status) */}
      <AttackTimeline />

      {/* attack control: no scrubber. The button runs the real backend flow; the map plays each response. */}
      <div className="absolute -translate-x-1/2 bottom-6 z-20 flex flex-col items-center transition-[left] duration-500" style={{ left: selected ? `${(1 - PANEL_SHARE) * 50}%` : '50%' }}>
        {tracing ? (
          <button onClick={() => (done ? changeMode('trace') : setPlaying(!playing))}
            className="flex items-center gap-2 h-11 px-6 rounded-xl bg-[#D6A61F] text-ink text-[13px] font-semibold hover:bg-[#E2B52E] shadow-[0_8px_30px_rgba(214,166,31,.35)]">
            <PlayGlyph playing={playing && !done} />{done ? 'Re-trace' : playing ? 'Pause trace' : 'Resume trace'}
          </button>
        ) : (
          <button onClick={atk.done ? resetDemo : runAttackDemo} disabled={atk.busy}
            title={atk.done ? 'Reset the fork and map to a clean state' : 'Runs the real attack on the fork; the defence response drives this view'}
            className="flex items-center gap-2.5 h-11 px-6 rounded-xl bg-[#D6A61F] text-ink text-[13.5px] font-semibold hover:bg-[#E2B52E] disabled:opacity-60 disabled:hover:bg-[#D6A61F] shadow-[0_8px_30px_rgba(214,166,31,.35)] transition-colors">
            {atk.busy
              ? <svg width="14" height="14" viewBox="0 0 24 24" className="animate-spin"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="42" strokeLinecap="round" opacity="0.9" /></svg>
              : atk.done
                ? <svg width="14" height="14" viewBox="0 0 16 16"><path d="M13.6 8a5.6 5.6 0 1 1-1.7-4M13.6 2.4V6H10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                : <svg width="13" height="13" viewBox="0 0 14 14"><path d="M3.5 2v10l8.5-5z" fill="currentColor" /></svg>}
            {atk.busy ? (atk.resetting ? 'Resetting\u2026' : 'Attack in progress\u2026') : atk.done ? 'Reset' : 'Attack'}
          </button>
        )}
      </div>
    </section>
  )
}

function PlayGlyph({ playing }: { playing: boolean }) {
  return <svg width="11" height="11" viewBox="0 0 14 14" aria-hidden>{playing ? <path d="M3.5 2.5h2.4v9H3.5zM8.1 2.5h2.4v9H8.1z" fill="currentColor" /> : <path d="M3.5 2v10l8.5-5z" fill="currentColor" />}</svg>
}
function Ctl({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className="h-8 w-8 grid place-items-center rounded-md text-dim hover:text-cream hover:bg-white/[0.04] disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
      <svg width="13" height="13" viewBox="0 0 14 14">{children}</svg>
    </button>
  )
}

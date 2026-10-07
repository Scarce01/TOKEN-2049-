import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import World, { InspectStage, PANEL_SHARE, type SceneState, type ViewCmd } from '../components/World'
import { DetailPanel } from '../components/WorldDetail'
import { DECOYS, DISTRICTS, STEPS, T, TR, stepAt, traceCaption, type WorldMode } from '../components/worldData'
import { useReplay } from '../components/replay'

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
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null) }
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
  const onSelect = useCallback((id: string | null) => setSelected(id), [])

  const tracing = mode === 'trace'
  const step = stepAt(t)
  const progress = tracing ? Math.max(0, tr) / TR.end : t < 0 ? 0 : t / T.end
  const caption = tracing ? traceCaption(Math.max(0, tr)) : step >= 0 ? STEPS[step].label : 'All systems nominal · press play incident'
  const done = tracing ? tr >= TR.end : t >= T.end

  return (
    <section className="relative h-full overflow-hidden bg-[#0f1526]">
      <div className="absolute inset-0">
        <World state={S} mode={mode} selected={selected} traceFocus={tracing && tr >= TR.area} onSelect={onSelect} view={view} />
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

      {/* inspection mode — left: isolated model stage, right: intelligence */}
      <div className={`absolute top-0 left-0 bottom-0 z-30 border-r border-line bg-[radial-gradient(ellipse_70%_60%_at_50%_45%,rgba(40,34,22,.55),rgba(11,13,16,.94))] backdrop-blur-md transition-[transform,opacity] duration-500 ease-[cubic-bezier(.2,.7,.2,1)] ${selected ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0 pointer-events-none'}`} style={{ width: `${(1 - PANEL_SHARE) * 100}%` }}>
        {panelId && <InspectStage key={panelId} id={panelId} state={S} />}
        <span className="pointer-events-none absolute left-5 bottom-5 font-mono text-[10px] uppercase tracking-[0.16em] text-mute">Drag to rotate · scroll to zoom</span>
      </div>
      {/* inspection mode — right half */}
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

      {/* replay controls */}
      <div className="absolute -translate-x-1/2 bottom-5 z-20 w-[min(560px,48vw)] transition-[left] duration-500" style={{ left: selected ? `${(1 - PANEL_SHARE) * 50}%` : '50%' }}>
        <div className="mb-2 flex justify-center">
          <div key={caption} className="tag-in flex items-center gap-2.5 h-7 px-3 rounded-md bg-[#0B0D10]/80 backdrop-blur">
            <span className="font-mono text-[10px] text-mute">{tracing ? 'TRACE' : step >= 0 ? `${String(step + 1).padStart(2, '0')} / ${STEPS.length}` : mode.toUpperCase()}</span>
            <span className={`font-mono text-[11px] uppercase tracking-[0.14em] ${tracing && tr >= TR.found ? 'text-[#ff8a8d]' : step >= 0 || tracing ? 'text-cream' : 'text-dim'}`}>{caption}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 h-11 pl-1.5 pr-3 rounded-xl bg-[#0F1115]/88 backdrop-blur-md border border-white/[0.07]">
          {tracing ? (
            <button onClick={() => (done ? changeMode('trace') : setPlaying(!playing))} className="flex items-center gap-2 h-8 px-3 rounded-lg bg-[#D6A61F] text-ink text-[12px] font-semibold hover:bg-[#E2B52E]">
              <PlayGlyph playing={playing && !done} />{done ? 'Re-trace' : playing ? 'Pause trace' : 'Resume trace'}
            </button>
          ) : (
            <button onClick={playing ? () => setPlaying(false) : play} className="flex items-center gap-2 h-8 px-3 rounded-lg bg-[#D6A61F] text-ink text-[12px] font-semibold hover:bg-[#E2B52E] transition-colors">
              <PlayGlyph playing={playing} />{playing ? 'Pause' : t < 0 ? 'Play incident' : done ? 'Replay incident' : 'Resume'}
            </button>
          )}
          <Ctl label="Step forward" onClick={stepFwd} disabled={done}><path d="M3 2.5v9l6-4.5zM10 2.5h1.6v9H10z" fill="currentColor" /></Ctl>
          <Ctl label="Reset" onClick={() => (tracing ? changeMode('live') : reset())} disabled={!tracing && t < 0}><path d="M3 3h8v8H3z" fill="none" stroke="currentColor" strokeWidth="1.4" /></Ctl>
          <div className="relative flex-1 mx-2 h-8 flex items-center">
            <div className="absolute inset-x-0 h-[2px] bg-white/[0.07] rounded" />
            <div className="absolute left-0 h-[2px] bg-[#D6A61F] rounded" style={{ width: `${progress * 100}%` }} />
            {!tracing && STEPS.map((s, i) => (
              <button key={i} title={s.label} aria-label={s.label} onClick={() => { setPlaying(false); if (mode !== 'live') changeMode('live'); setClock(s.at + 0.01) }}
                className="absolute -translate-x-1/2 w-3 h-3 grid place-items-center" style={{ left: `${(s.at / T.end) * 100}%` }}>
                <span className={`w-1.5 h-1.5 clip-hex ${t >= s.at ? 'bg-[#D6A61F]' : 'bg-[#3a3b40]'}`} />
              </button>
            ))}
            {!tracing && (
              <input type="range" min={0} max={T.end} step={0.05} value={Math.max(0, t)} aria-label="Incident timeline"
                onChange={(e) => { setPlaying(false); if (mode !== 'live') changeMode('live'); setClock(Number(e.target.value)) }}
                className="scrub absolute inset-0 w-full opacity-0 cursor-pointer" />
            )}
          </div>
          <span className="w-[54px] text-right font-mono text-[10.5px] tabular-nums text-mute">{tracing ? `${Math.max(0, tr).toFixed(1)}s` : t < 0 ? 'idle' : `+${t.toFixed(1)}s`}</span>
        </div>
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

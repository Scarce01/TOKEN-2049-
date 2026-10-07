import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import HiveScene, { REPLAY_DUR, TRACE_DUR, TRACE_OUT, TRACE_REJECT, TRACE_VERIFY, VAULT_AT, type ViewMode } from '../components/HiveScene'
import { Events, IncidentPanel, Kpis, NodeDetail, Timeline } from '../components/Panels'
import { NODES, PATHS, STEPS, TRAP_CHAIN, type NodeId } from '../components/data'
import { Button, Icon, Label } from '../components/ui'

const LEGEND: Record<string, React.ReactNode> = {
  request: <line x1="0" y1="2" x2="22" y2="2" stroke="#8f8a7a" strokeWidth="2" strokeDasharray="2 3" />,
  trap: <line x1="0" y1="2" x2="22" y2="2" stroke="#FCAD17" strokeWidth="2" strokeDasharray="4 3" />,
  verify: <line x1="0" y1="2" x2="22" y2="2" stroke="#FACF30" strokeWidth="2" strokeDasharray="8 2" />,
  exec: <line x1="0" y1="2" x2="22" y2="2" stroke="#FFC700" strokeWidth="3" />,
  intel: <line x1="0" y1="2" x2="22" y2="2" stroke="#FFF1C1" strokeWidth="2" />,
}
const STATUS = ['Backend untrusted', 'Trap verified by CRE', 'QuorumReceiver executed response', 'Threat shared network-wide']
const LAST = STEPS.length
const VIEWS: [ViewMode, string][] = [['live', 'Live incident'], ['trace', 'Trace origin'], ['net', 'Network propagation'], ['arch', 'System architecture']]
const ARCH = [
  ['Entry', 'Exchange backend → RequestBoard', 'untrusted · records only'],
  ['Verification', 'CRE · Cosign / Trap / Patrol', '7 independent nodes'],
  ['Execution', 'QuorumReceiver', 'DON-signed reports only'],
  ['Onchain', 'QuorumVault · ColdVault · DecoyCommit', 'quotas, timelocks, commitments'],
  ['Governance', 'ConfigTimelock', 'relax = 48h delay'],
  ['Intelligence', 'ThreatRegistry → members', 'shared, TTL-bound'],
]
const PROP = [['Exchange B', '14:02:44'], ['Kestrel Custody', '14:02:46'], ['Sable Agents', '14:02:49'], ['Meridian DAO', '14:02:51'], ['Vela Prime', 'applying'], ['Orbit Exchange', 'ack overdue']]

type Mode = 'flow' | null
const FINAL = STEPS.length
const ACKS: [number, number][] = [[1.0, 1], [1.4, 12], [2.1, 27], [2.8, 36]]
const cre = (el: number) => Math.min(7, Math.floor(el / 0.45))
/** Architecture route that leads to a structure — shown when it is clicked */
function routeOf(id: NodeId): NodeId[] {
  if (id === 'exA' || id === 'board') return ['exA', 'board', 'core']
  const i = TRAP_CHAIN.indexOf(id)
  const vaults: NodeId[] = ['hot', 'warm', 'cold']
  if (vaults.includes(id)) return ['threat', 'decoy', 'core', 'receiver', id]
  return i < 0 ? [id] : TRAP_CHAIN.slice(0, i + 1).filter((n) => !vaults.includes(n) || id === 'registry' || id === 'exB')
}
const isNode = (id: string): id is NodeId => NODES.some((n) => n.id === id)
function caption(i: number, el: number) {
  if (i === 2) { const n = cre(el); return n >= 7 ? 'CRE verification · 7/7 · verified' : n >= 5 ? `CRE verification · ${n}/7 · quorum reached` : `CRE verification · ${n}/7` }
  if (i === 6) return `Network propagation · ${ACKS.filter(([t]) => el >= t).pop()?.[1] ?? 0}/38 members`
  return ['Probing detected', 'Decoy triggered', '', 'Report #78452 accepted', 'Hive lockdown · controlled tightening', 'ThreatRegistry updated'][i]
}
/** Trace Origin narrative, keyed to the same clock the scene uses */
function traceInfo(t: number): { caption: string; tags: Partial<Record<NodeId, string>> } {
  const left = 4 - TRACE_REJECT.filter((r) => t >= r + 0.5).length
  if (t >= TRACE_VERIFY) return { caption: 'Source identified · route verified', tags: { threat: 'SOURCE IDENTIFIED\n0x7a3f…91c2', decoy: 'Decoy DW-07 · entry hex' } }
  if (t < TRACE_OUT) return { caption: 'Detection · signal spreading from attack hex', tags: { decoy: 'Decoy DW-07 TRIGGERED' } }
  if (t >= TRACE_OUT + 1.4) return { caption: `Narrowing · ${left + 1} candidate route${left ? 's' : ''}`, tags: { decoy: 'Tracing back from DW-07' } }
  return { caption: 'Tracing origin · rings converging', tags: { decoy: 'Tracing back from DW-07' } }
}
function tagsFor(i: number | null, el: number): Partial<Record<NodeId, string>> {
  if (i === 0) return { threat: '0x7a3f…91c2\nMalicious withdrawal' }
  if (i === 1) return { threat: '0x7a3f…91c2', decoy: 'Decoy DW-07 TRIGGERED' }
  if (i === 2) { const n = cre(el); return { core: `${n}/7 nodes${n >= 7 ? ' · verified' : n >= 5 ? ' · quorum reached' : ''}` } }
  if (i === 3) return { receiver: el > 0.5 ? 'Report #78452 accepted\nDirectives → QuorumVault · ColdVault' : 'Verified report received' }
  if (i === 4) return {
    ...(el >= VAULT_AT.hot && { hot: 'Quota 2,400 → 0 ETH\nSweep 1,120 ETH → cold' }),
    ...(el >= VAULT_AT.warm && { warm: 'Open → Cosign-only · 6h' }),
    ...(el >= VAULT_AT.cold && { cold: 'Timelock 24h → 72h' }),
  }
  if (i === 5) return { registry: el > 0.9 ? 'Entry #4,118 · 0x7a3f…91c2\nVerified threat' : 'Publishing entry…' }
  if (i === 6) return el > 0.8 ? { exB: 'ThreatRegistry match\nControls tightened' } : {}
  return {}
}

export default function Overview() {
  const [mode, setMode] = useState<Mode>(null)
  const [path, setPath] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('live')
  /** replay: step 0–6 is the sequence, 7 = contained summary; playing auto-advances, paused freezes the clock */
  const [rs, setRs] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const [el, setEl] = useState(0)
  const [drag, setDrag] = useState<'orbit' | 'pan'>('orbit')
  const [tr, setTr] = useState(0)
  const [trRun, setTrRun] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const clock = useRef({ el: 0, last: 0, raf: 0 })

  useEffect(() => {
    const c = clock.current
    c.el = 0; c.last = performance.now(); setEl(0)
    if (rs === null || rs >= FINAL) return
    const tick = (now: number) => {
      const dt = (now - c.last) / 1000; c.last = now
      if (!paused) c.el = Math.min(c.el + dt, REPLAY_DUR[rs] + 0.6)
      setEl(Math.floor(c.el * 10) / 10)
      if (playing && !paused && c.el >= REPLAY_DUR[rs]) { setRs(rs + 1); return }
      c.raf = requestAnimationFrame(tick)
    }
    c.raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(c.raf)
  }, [rs, playing, paused])

  // Trace Origin clock — runs once per start, honours Pause
  useEffect(() => {
    if (view !== 'trace') return
    let raf = 0, last = performance.now(), t = 0
    setTr(0)
    const tick = (now: number) => {
      const dt = (now - last) / 1000; last = now
      if (!pausedRef.current) t = Math.min(TRACE_DUR, t + dt)
      setTr(Math.floor(t * 10) / 10)
      if (t < TRACE_DUR) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [view, trRun])
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const startTrace = () => { setRs(null); setPlaying(false); setPaused(false); setMode(null); setSelected(null); setView('trace'); setTrRun((n) => n + 1) }
  const tracing = view === 'trace'
  const ti = tracing ? traceInfo(tr) : null

  const go = (i: number | null, play: boolean) => { setMode(null); setSelected(null); setView('live'); setRs(i); setPlaying(play); setPaused(false) }
  const replay = () => go(0, true)
  const reset = () => { setTr(0); go(null, false) }
  const forward = () => go(rs === null ? 0 : Math.min(FINAL, rs + 1), false)
  const onStep = (i: number) => (rs === i && !playing ? reset() : go(i, false))
  const toggle = (m: 'flow') => { reset(); setPath(null); setMode(mode === m ? null : m) }

  const phase = rs === null ? LAST : Math.min(rs + 1, LAST)
  const step = rs !== null && rs < FINAL ? rs : null
  const focus: NodeId[] | null =
    step !== null ? STEPS[step].focus
      : tracing ? (tr >= TRACE_VERIFY ? ['threat', 'decoy'] : ['threat', 'decoy', 'exA', 'board'])
        : mode === 'flow' && path ? PATHS.find((p) => p.id === path)!.nodes
          : selected === 'route' ? ['threat', 'decoy'] : selected && isNode(selected) ? routeOf(selected)
          : view === 'net' ? ['receiver', 'registry', 'exA', 'exB']
            : null

  const onSelect = (id: NodeId | null) => {
    setSelected(id)
    if (id === 'decoy' || id === 'exA' || id === 'threat') panelRef.current?.animate([{ outline: '2px solid #FFC700' }, { outline: '2px solid transparent' }], { duration: 900 })
  }

  return (
    <>
      <section className="relative h-[max(800px,calc(100vh-64px-24px))] overflow-hidden border-b border-white/[0.06]">
        <div className="absolute inset-0"><HiveScene phase={phase} focus={focus} mode={view} selected={selected && isNode(selected) ? selected : null} picked={selected} onPick={setSelected} onSelect={onSelect} onRoute={() => setSelected('route')} replay={rs === null ? null : { step: rs, paused }} tags={ti ? ti.tags : tagsFor(step, el)} drag={drag} trace={tracing ? { paused, found: tr >= TRACE_VERIFY } : null} /></div>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-ink via-ink/60 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-ink to-transparent" />

        <div className="absolute top-5 left-6 right-[404px] z-30"><Kpis /></div>

        <div className="absolute top-[132px] left-6 z-30 pointer-events-none max-w-[620px]">
          <Label>Hive Kingdom · live security map</Label>
          <h1 className="mt-1.5 text-[26px] leading-tight font-semibold tracking-tight">Decoy hit at Exchange A.<br /><span className="text-honey">Vault controls tightened</span> before large-scale outflow.</h1>
          <div className="mt-4 pointer-events-auto inline-flex p-1 rounded-lg bg-ink/70 backdrop-blur border border-white/[0.06]">
            {VIEWS.map(([v, l]) => (
              <button key={v} onClick={() => (v === 'trace' ? startTrace() : (setView(v), setMode(null), setRs(null), setPaused(false)))}
                className={`h-8 px-3.5 rounded-md text-[12.5px] font-medium transition-colors ${view === v ? 'bg-honey text-ink' : 'text-dim hover:text-cream'}`}>{l}</button>
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-dim">
            {STATUS.map((s, i) => <li key={s} className="flex items-center gap-2.5">{i > 0 && <span className="text-honey/40">•</span>}<span className={i === 0 ? 'text-amber' : ''}>{i > 0 && <span className="text-honey mr-1">✓</span>}{s}</span></li>)}
          </ul>
        </div>

        {(view === 'arch' || view === 'net') && (
          <div className="absolute left-6 top-[330px] z-30 w-[300px] rounded-xl bg-ink/80 backdrop-blur border border-white/[0.06] p-4">
            <div className="text-[13px] font-semibold text-cream">{view === 'arch' ? 'System layers' : 'Propagation of #4,118'}</div>
            {view === 'arch' ? (
              <ol className="mt-2 space-y-2">{ARCH.map(([l, n, d]) => <li key={l} className="text-[12px]"><div className="text-mute">{l}</div><div className="text-cream">{n}</div><div className="text-dim">{d}</div></li>)}</ol>
            ) : (
              <ul className="mt-2 space-y-1.5">{PROP.map(([m, t]) => <li key={m} className="flex justify-between text-[12.5px]"><span className="text-cream">{m}</span><span className={`font-mono text-[11px] ${t.includes(':') ? 'text-dim' : 'text-amber'}`}>{t}</span></li>)}
                <li className="pt-2 text-[12px] text-dim">36 of 38 members enforcing · <Link to="/network" className="text-honey hover:text-flare">Network Members →</Link></li></ul>
            )}
          </div>
        )}

        {step !== null && (
          <div className="absolute left-1/2 -translate-x-[calc(50%+190px)] top-[300px] z-30 pointer-events-none flex flex-col items-center">
            <div key={step} className="tag-in flex items-center gap-3 px-4 h-10 bg-ink/80 backdrop-blur rounded-md">
              <span className="font-mono text-[11px] text-mute">{String(step + 1).padStart(2, '0')}/07</span>
              <span className={`text-[13px] font-semibold uppercase tracking-[0.14em] ${step === 1 ? 'text-flare' : step === 0 ? 'text-amber' : 'text-cream'}`}>{caption(step, el)}</span>
            </div>
            <div className="mt-2 w-[220px] h-[2px] bg-white/[0.06]"><div className="h-full bg-honey/70" style={{ width: `${Math.min(100, (el / REPLAY_DUR[step]) * 100)}%` }} /></div>
          </div>
        )}
        {ti && (
          <div className="absolute left-1/2 -translate-x-[calc(50%+190px)] top-[300px] z-30 pointer-events-none flex flex-col items-center">
            <div key={ti.caption} className="tag-in flex items-center gap-3 px-4 h-10 bg-ink/80 backdrop-blur rounded-md">
              <span className="font-mono text-[11px] text-mute">TRACE</span>
              <span className={`text-[13px] font-semibold uppercase tracking-[0.14em] ${tr >= TRACE_VERIFY ? 'text-honey' : 'text-cream'}`}>{ti.caption}</span>
            </div>
            <div className="mt-2 w-[220px] h-[2px] bg-white/[0.06]"><div className="h-full bg-honey/70" style={{ width: `${(tr / TRACE_DUR) * 100}%` }} /></div>
          </div>
        )}
        {rs === FINAL && (
          <div className="absolute left-1/2 -translate-x-[calc(50%+190px)] top-[250px] z-30 w-[420px] tag-in bg-ink/90 backdrop-blur rounded-xl px-7 py-6">
            <Label>Incident #QRM-78452 · replay complete</Label>
            <div className="mt-2 text-[24px] font-semibold tracking-tight">Threat contained in <span className="text-honey">24s</span></div>
            <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px]">
              {[['1', 'decoy triggered'], ['7/7', 'CRE nodes verified'], ['3', 'vault controls tightened'], ['36/38', 'members updated']].map(([v, l]) => (
                <li key={l} className="flex items-baseline gap-2"><span className="text-[17px] font-semibold text-cream tabular-nums">{v}</span><span className="text-dim">{l}</span></li>
              ))}
            </ul>
            <p className="mt-4 pt-3 border-t border-white/[0.06] text-[12.5px] text-dim">No large-scale outflow occurred. Hot and warm liquidity stayed partially available under tightened policy.</p>
            <div className="mt-4 flex gap-2"><Button variant="secondary" onClick={replay}><Icon name="replay" size={14} />Replay</Button><Button variant="ghost" onClick={reset}>Close</Button></div>
          </div>
        )}

        <div ref={panelRef} className="absolute top-5 right-6 bottom-6 w-[360px] z-30 rounded-[14px]">{selected ? <NodeDetail key={selected} id={selected} onClose={() => setSelected(null)} /> : <IncidentPanel phase={phase} onLayer={onStep} />}</div>

        <div className="absolute left-6 right-[404px] bottom-6 z-30 flex flex-col gap-3">
          {mode === 'flow' && (
            <div className="flex flex-wrap gap-2">
              {PATHS.map((p) => (
                <button key={p.id} onClick={() => setPath(path === p.id ? null : p.id)}
                  className={`flex items-center gap-2 h-8 px-3 rounded-md border text-[12px] backdrop-blur transition-colors ${path === p.id ? 'border-honey bg-honey/10 text-cream' : 'border-honey/20 bg-ink/70 text-dim hover:text-cream hover:border-honey/50'}`}>
                  <svg width="22" height="4">{LEGEND[p.id]}</svg>{p.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button variant={rs !== null ? 'primary' : 'secondary'} onClick={replay} className={rs !== null ? '' : 'bg-ink/70 backdrop-blur'}><Icon name="replay" size={15} />Replay incident</Button>
            <div className="flex items-center rounded-md bg-ink/70 backdrop-blur">
              <Ctl label={paused ? 'Resume' : 'Pause'} disabled={step === null && !(tracing && tr < TRACE_DUR)} onClick={() => setPaused(!paused)}>
                {paused ? <path d="M4 2.5v9l7.5-4.5z" fill="currentColor" /> : <path d="M4 2.5h2v9H4zM8 2.5h2v9H8z" fill="currentColor" />}
              </Ctl>
              <Ctl label="Step forward" disabled={rs === FINAL} onClick={forward}><path d="M3 2.5v9l6-4.5zM10 2.5h1.6v9H10z" fill="currentColor" /></Ctl>
              <Ctl label="Reset" disabled={rs === null && !tracing} onClick={() => { reset(); setView('live') }}><path d="M3 3h8v8H3z" fill="none" stroke="currentColor" strokeWidth="1.4" /></Ctl>
            </div>
            <Button variant={tracing ? 'primary' : 'secondary'} onClick={startTrace} className={tracing ? '' : 'bg-ink/70 backdrop-blur'}><Icon name="trap" size={15} />Trace origin</Button>
            <Button variant={mode === 'flow' ? 'primary' : 'secondary'} onClick={() => toggle('flow')} className={mode === 'flow' ? '' : 'bg-ink/70 backdrop-blur'}><Icon name="workflow" size={15} />Show system flow</Button>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-[11px] text-mute">Drag to {drag === 'pan' ? 'move' : 'rotate'} · scroll to zoom</span>
              <div className="flex rounded-md bg-ink/70 backdrop-blur p-0.5">
                {(['orbit', 'pan'] as const).map((d) => (
                  <button key={d} onClick={() => setDrag(d)} className={`h-7 px-3 rounded text-[12px] font-medium transition-colors ${drag === d ? 'bg-coal-3 text-cream' : 'text-dim hover:text-cream'}`}>{d === 'orbit' ? 'Rotate' : 'Move'}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-[1fr_400px] gap-4 p-6">
        <Timeline phase={phase} active={step} onStep={onStep} />
        <Events />
      </div>
      <div className="px-6 pb-8 -mt-2 text-right"><Link to="/cases/QRM-78452" className="text-[13px] text-honey hover:text-flare">Open full incident file →</Link></div>
    </>
  )
}

function Ctl({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className="h-9 w-9 grid place-items-center text-dim hover:text-cream disabled:opacity-30 disabled:hover:text-dim transition-colors">
      <svg width="14" height="14" viewBox="0 0 14 14">{children}</svg>
    </button>
  )
}

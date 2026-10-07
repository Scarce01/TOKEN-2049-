// Attack timeline: a left-side pop-out that follows the real attack on the fork (bridge /attack/status).
// One card per stage. Done stages read honey; stages not reached yet carry no colour. Clicking anywhere on the
// panel opens the incident page (/cases). When the attack completes the panel collapses to a small redirect tab
// with a 10s countdown, then hides. Every value comes from the bridge (source: testnet fork, measured); no decoy
// address is shown (CLAUDE.md rule 2). Mounted in Overview.tsx.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAttackFeed, type AttackStep } from '../live/attackFeed'

type Step = AttackStep

const STAGES = [
  { key: 'start', title: 'Backend compromised' },
  { key: 'scan', title: 'Hot wallets scanned' },
  { key: 'probe', title: 'Probe transfers sent' },
  { key: 'tripwire', title: 'Decoy tripwire touched' },
  { key: 'verify', title: 'CRE verifying' },
  { key: 'verified', title: 'Attack verified' },
  { key: 'report', title: 'Report accepted on chain' },
  { key: 'tighten', title: 'Defence tightened' },
  { key: 'done', title: 'Attacker contained' },
] as const
type Key = (typeof STAGES)[number]['key']

const keyOf = (s: Step): Key | null =>
  s.type === 'start' ? 'start' : s.type === 'done' ? 'done' : s.type === 'response' ? 'tighten' : ((s.phase as Key) ?? null)
const secs = (ms: number) => `+${(ms / 1000).toFixed(1)}s`

export default function AttackTimeline({ insetBottom = 96 }: { insetBottom?: number }) {
  const feed = useAttackFeed()
  const st = feed.status ?? { running: false, steps: [] as Step[] }
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<'timeline' | 'collapsed' | 'hidden'>('hidden')
  const [countdown, setCountdown] = useState(10)
  const lastStart = useRef<number | null>(null)
  const wasRunning = useRef(false)
  const nav = useNavigate()
  const goIncidents = () => nav('/cases')

  // The shared bridge poll feeds this panel. A new run opens it; containment collapses it.
  useEffect(() => {
    const start = st.steps.find((x) => x.type === 'start')?.at ?? null
    if (st.running) {
      if (start !== lastStart.current) { setOpen(true); setPhase('timeline'); setCountdown(10) }
      wasRunning.current = true
    } else if (wasRunning.current && st.steps.some((x) => x.type === 'done')) {
      wasRunning.current = false
      setPhase('collapsed'); setCountdown(10)
    }
    lastStart.current = start
  }, [st])

  // countdown while collapsed, then hide the tab entirely
  useEffect(() => {
    if (phase !== 'collapsed') return
    if (countdown <= 0) { setPhase('hidden'); return }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [phase, countdown])

  if (phase === 'hidden' || !st.steps.length) return null

  const t0 = st.steps.find((x) => x.type === 'start')?.at ?? st.steps[0]!.at
  const byKey = new Map<Key, Step[]>()
  for (const s of st.steps) { const k = keyOf(s); if (k) byKey.set(k, [...(byKey.get(k) ?? []), s]) }
  const err = st.steps.find((s) => s.type === 'error')
  const reached = STAGES.reduce((n, g, i) => (byKey.has(g.key) ? i : n), 0)
  const pct = Math.round((reached / (STAGES.length - 1)) * 100)
  // done = honey; verify-in-progress and anything not reached = no colour; an error marks the next stage red
  const state = (i: number, k: Key): 'done' | 'active' | 'pending' | 'error' =>
    !byKey.has(k) ? (err && i === reached + 1 ? 'error' : 'pending') : k === 'verify' && !byKey.has('verified') && !err ? 'active' : 'done'

  // collapsed: a small redirect tab with a 10s countdown bar
  if (phase === 'collapsed') {
    return (
      <button
        onClick={goIncidents}
        className="absolute left-0 top-28 z-30 flex flex-col gap-1.5 w-[190px] pl-3 pr-3 py-2.5 rounded-r-xl bg-[#0B0D10]/92 backdrop-blur border border-l-0 border-honey/40 text-left hover:border-honey/70 transition-colors"
      >
        <span className="flex items-center gap-2 text-[14px] font-semibold text-honey">
          Attack contained
          <span className="ml-auto text-[18px] leading-none">{'→'}</span>
        </span>
        <span className="text-[12px] text-cream">Open incident</span>
        <span className="mt-0.5 h-1 rounded-full bg-white/10 overflow-hidden">
          <span className="block h-full bg-honey transition-[width] duration-1000 ease-linear" style={{ width: `${(countdown / 10) * 100}%` }} />
        </span>
      </button>
    )
  }

  // timeline: full panel. Clicking the panel opens the incident page; the handle toggles it.
  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="absolute left-0 top-28 z-30 flex items-center gap-1.5 h-10 pl-2.5 pr-3.5 rounded-r-lg bg-[#0B0D10]/90 backdrop-blur border border-l-0 border-white/[0.08] text-[13px] font-mono uppercase tracking-[0.12em] text-cream hover:text-honey"
        style={{ transform: open ? 'translateX(340px)' : 'none', transition: 'transform .35s ease' }}
      >
        <span className={`h-2 w-2 rounded-full ${err ? 'bg-red-500' : st.running ? 'bg-honey animate-pulse' : 'bg-honey'}`} />
        {open ? 'Hide' : `Attack ${pct}%`}
      </button>

      <aside
        onClick={goIncidents}
        role="link"
        title="Open the incident"
        className="absolute left-0 top-20 z-30 w-[340px] flex flex-col bg-[#0B0D10]/92 backdrop-blur border-r border-white/[0.08] shadow-[8px_0_30px_rgba(0,0,0,.45)] cursor-pointer"
        style={{ bottom: insetBottom, transform: open ? 'none' : 'translateX(-100%)', transition: 'transform .35s ease, bottom .3s ease' }}
        aria-hidden={!open}
      >
        <header className="px-4 pt-4 pb-3 border-b border-white/[0.06]">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-semibold text-cream">Attack timeline</h2>
            <span className={`font-mono text-[11px] uppercase tracking-[0.12em] ${err ? 'text-red-400' : 'text-honey'}`}>
              {err ? 'Error' : st.running ? 'Live' : 'Complete'}
            </span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-honey transition-[width] duration-700" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 font-mono text-[11px] text-mute">
            {pct}% {'·'} Org {byKey.get('start')?.[0]?.org ?? 'A'} {'·'} source: testnet fork, measured
          </p>
        </header>

        <ol className="relative flex-1 overflow-y-auto px-4 py-4">
          {STAGES.map((g, i) => {
            const s = state(i, g.key)
            const steps = byKey.get(g.key) ?? []
            const first = steps[0]
            return (
              <li key={g.key} className="relative flex gap-3 pb-3 last:pb-0">
                {i < STAGES.length - 1 && (
                  <span className={`absolute left-[10.5px] top-[34px] -bottom-[12px] w-[3px] rounded transition-colors duration-700 ${i < reached ? 'bg-honey' : 'bg-white/10'}`} />
                )}
                <span className="relative z-10 mt-3 grid place-items-center h-6 w-6 shrink-0">
                  {s === 'active' && <span className="absolute inset-0 rounded-full border-2 border-honey animate-ping opacity-50" />}
                  <span className={`h-5 w-5 rounded-full border-[3px] ${s === 'done' ? 'border-honey bg-honey/25' : s === 'error' ? 'border-red-500 bg-red-500/20' : 'border-white/30 bg-[#0B0D10]'}`} />
                </span>
                <div className={`flex-1 rounded-lg border px-3 py-2.5 transition-colors ${s === 'done' ? 'border-honey/40 bg-honey/[0.05]' : s === 'error' ? 'border-red-500/60 bg-red-500/[0.08]' : 'border-white/[0.06] bg-white/[0.015]'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className={`text-[15px] font-semibold ${s === 'done' ? 'text-cream' : 'text-dim'}`}>{g.title}</h3>
                    {first && <span className="font-mono text-[11px] text-mute">{secs(first.at - t0)}</span>}
                  </div>

                  {s === 'error' && <p className="mt-1 text-[12.5px] text-red-300">{err?.message}</p>}

                  {g.key === 'verified' && first && (
                    <dl className="mt-2 grid grid-cols-[72px_1fr] gap-x-2 gap-y-0.5 font-mono text-[12px]">
                      <dt className="text-mute">CRE</dt>
                      <dd className="text-honey">{first.cre}</dd>
                      <dt className="text-mute">NOWNodes</dt>
                      <dd className="text-cream">{first.nownodes}</dd>
                      <dt className="text-mute">Verdict</dt>
                      <dd className="text-honey">{first.verdict}</dd>
                    </dl>
                  )}

                  {g.key === 'tighten' && steps.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {steps.map((x) => (
                        <li key={x.seq} className="flex items-center gap-2 text-[12.5px]">
                          <span className="text-honey">{'✓'}</span>
                          <span className="text-cream">{x.detail}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </aside>
    </>
  )
}

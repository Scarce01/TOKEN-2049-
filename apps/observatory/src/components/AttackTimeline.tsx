// Attack timeline: a left-side pop-out that follows the real attack on the fork (bridge /attack/status).
// One card per stage; the rail fills green up to the stage in progress. Every value comes from the bridge,
// which reads it from the fork's receipts and the CRE CLI log (source: testnet fork, measured).
// No decoy address is shown: the tripwire card carries only the probe transaction (CLAUDE.md rule 2).
import { useEffect, useRef, useState } from 'react'
import { BRIDGE } from '../live/bridge'

type Step = {
  seq: number
  at: number
  type: 'start' | 'step' | 'response' | 'done' | 'error'
  phase?: string
  org?: string
  detail?: string
  tx?: string
  block?: number
  cre?: string
  nownodes?: string
  verdict?: string
  event?: string
  message?: string
}
type Status = { running: boolean; startedAt?: number; steps: Step[] }

const STAGES = [
  { key: 'start', title: 'Backend compromised', wait: 'Attacker controls the exchange backend' },
  { key: 'scan', title: 'Hot wallets scanned', wait: 'Attacker ranks wallets by balance' },
  { key: 'probe', title: 'Probe transfers sent', wait: 'Attacker tests which wallets can move funds' },
  { key: 'tripwire', title: 'Decoy tripwire touched', wait: 'A probe has to touch a decoy' },
  { key: 'verify', title: 'CRE verifying', wait: 'Chainlink CRE checks the transfer on its own nodes' },
  { key: 'verified', title: 'Attack verified', wait: 'CRE receipt plus a second source' },
  { key: 'report', title: 'Report accepted on chain', wait: 'The receiver contract applies the report' },
  { key: 'tighten', title: 'Defence tightened', wait: 'Alert, quota, freeze, sweep, threat shared' },
  { key: 'done', title: 'Attacker contained', wait: 'Funds held, exchange stays protected' },
] as const
type Key = (typeof STAGES)[number]['key']

const keyOf = (s: Step): Key | null =>
  s.type === 'start' ? 'start' : s.type === 'done' ? 'done' : s.type === 'response' ? 'tighten' : ((s.phase as Key) ?? null)
const short = (h?: string) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : '')
const secs = (ms: number) => `+${(ms / 1000).toFixed(1)}s`

export default function AttackTimeline() {
  const [st, setSt] = useState<Status>({ running: false, steps: [] })
  const [open, setOpen] = useState(false)
  const lastStart = useRef<number | null>(null)

  // poll fast while an attack runs, slowly otherwise (the bridge keeps the last run until the next one)
  useEffect(() => {
    let stop = false
    let t: ReturnType<typeof setTimeout>
    const tick = async () => {
      const s = (await fetch(`${BRIDGE}/attack/status`).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as Status | null
      if (stop) return
      if (s) {
        setSt(s)
        const start = s.steps.find((x) => x.type === 'start')?.at ?? null
        if (s.running && start !== lastStart.current) setOpen(true) // a new attack pops the panel open
        lastStart.current = start
      }
      t = setTimeout(tick, s?.running ? 600 : 2000)
    }
    tick()
    return () => {
      stop = true
      clearTimeout(t)
    }
  }, [])

  if (!st.steps.length) return null

  const t0 = st.steps.find((x) => x.type === 'start')?.at ?? st.steps[0]!.at
  const byKey = new Map<Key, Step[]>()
  for (const s of st.steps) {
    const k = keyOf(s)
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), s])
  }
  const err = st.steps.find((s) => s.type === 'error')
  const reached = STAGES.reduce((n, g, i) => (byKey.has(g.key) ? i : n), 0)
  // "verify" is in progress until "verified" lands; everything else is done once its step exists
  const state = (i: number, k: Key) =>
    !byKey.has(k) ? (err && i === reached + 1 ? 'error' : 'pending') : k === 'verify' && !byKey.has('verified') && !err ? 'active' : i === reached && st.running ? 'active' : 'done'
  const pct = Math.round((reached / (STAGES.length - 1)) * 100)

  return (
    <>
      {/* handle: always on the left edge once there is a run to show */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="absolute left-0 top-28 z-30 flex items-center gap-1.5 h-9 pl-2 pr-3 rounded-r-lg bg-[#0B0D10]/90 backdrop-blur border border-l-0 border-white/[0.08] text-[11px] font-mono uppercase tracking-[0.12em] text-cream hover:text-honey"
        style={{ transform: open ? 'translateX(340px)' : 'none', transition: 'transform .35s ease' }}
      >
        <span className={`h-2 w-2 rounded-full ${err ? 'bg-red-500' : st.running ? 'bg-honey animate-pulse' : 'bg-emerald-400'}`} />
        {open ? 'Hide' : `Attack ${pct}%`}
      </button>

      <aside
        className="absolute left-0 top-20 bottom-24 z-30 w-[340px] flex flex-col bg-[#0B0D10]/92 backdrop-blur border-r border-white/[0.08] shadow-[8px_0_30px_rgba(0,0,0,.45)]"
        style={{ transform: open ? 'none' : 'translateX(-100%)', transition: 'transform .35s ease' }}
        aria-hidden={!open}
      >
        <header className="px-4 pt-4 pb-3 border-b border-white/[0.06]">
          <div className="flex items-center justify-between">
            <h2 className="text-[13.5px] font-semibold text-cream">Attack timeline</h2>
            <span className={`font-mono text-[10px] uppercase tracking-[0.12em] ${err ? 'text-red-400' : st.running ? 'text-honey' : 'text-emerald-400'}`}>
              {err ? 'Error' : st.running ? 'Live' : 'Complete'}
            </span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-violet-900/60 overflow-hidden">
            <div className="h-full bg-emerald-400 transition-[width] duration-700" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 font-mono text-[10px] text-mute">
            {pct}% · Org {byKey.get('start')?.[0]?.org ?? 'A'} · source: testnet fork, measured
          </p>
        </header>

        <ol className="relative flex-1 overflow-y-auto px-4 py-4">
          {STAGES.map((g, i) => {
            const s = state(i, g.key)
            const steps = byKey.get(g.key) ?? []
            const first = steps[0]
            return (
              <li key={g.key} className="relative flex gap-3 pb-3 last:pb-0">
                {/* rail segment to the next stage: green once it is reached, violet while still ahead */}
                {i < STAGES.length - 1 && (
                  <span className={`absolute left-[10.5px] top-[32px] -bottom-[14px] w-[3px] rounded transition-colors duration-700 ${i < reached ? 'bg-emerald-400' : 'bg-violet-700/70'}`} />
                )}
                <span className="relative z-10 mt-3 grid place-items-center h-6 w-6 shrink-0">
                  {s === 'active' && <span className="absolute inset-0 rounded-full border-2 border-honey animate-ping opacity-60" />}
                  <span
                    className={`h-5 w-5 rounded-full border-[3px] ${
                      s === 'done' ? 'border-emerald-400 bg-emerald-400/20' : s === 'active' ? 'border-honey bg-[#0B0D10]' : s === 'error' ? 'border-red-500 bg-red-500/20' : 'border-white/70 bg-[#0B0D10]'
                    }`}
                  />
                </span>
                <div
                  className={`flex-1 rounded-lg border px-3 py-2.5 transition-colors ${
                    s === 'active' ? 'border-honey/50 bg-honey/[0.06]' : s === 'done' ? 'border-white/[0.08] bg-white/[0.02]' : s === 'error' ? 'border-red-500/60 bg-red-500/[0.08]' : 'border-white/[0.04] opacity-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[12.5px] font-semibold text-cream">
                      {g.title}
                      {s === 'active' && g.key === 'verify' && <span className="text-honey">{'…'}</span>}
                    </h3>
                    {first && <span className="font-mono text-[10px] text-mute">{secs(first.at - t0)}</span>}
                  </div>
                  <p className={`mt-0.5 text-[11.5px] leading-snug ${s === 'error' ? 'text-red-300' : 'text-dim'}`}>
                    {s === 'error'
                      ? err?.message
                      : g.key === 'verify' && first && byKey.get('verified')?.[0]
                        ? `Checked on CRE nodes in ${((byKey.get('verified')![0]!.at - first.at) / 1000).toFixed(1)}s`
                        : g.key === 'tighten' && steps.length
                          ? `${steps.length} actions from one CRE report, no officer needed`
                          : (first?.detail ?? g.wait)}
                  </p>

                  {g.key === 'verified' && first && (
                    <dl className="mt-2 grid grid-cols-[70px_1fr] gap-x-2 gap-y-0.5 font-mono text-[10.5px]">
                      <dt className="text-mute">CRE</dt>
                      <dd className="text-emerald-400">{first.cre}</dd>
                      <dt className="text-mute">NOWNodes</dt>
                      <dd className="text-cream">{first.nownodes}</dd>
                      <dt className="text-mute">Verdict</dt>
                      <dd className="text-honey">{first.verdict}</dd>
                    </dl>
                  )}

                  {g.key === 'tighten' && steps.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {steps.map((x) => (
                        <li key={x.seq} className="tag-in flex items-center gap-2 text-[11px]">
                          <span className="text-emerald-400">{'✓'}</span>
                          <span className="text-cream">{x.detail}</span>
                          <span className="ml-auto font-mono text-[10px] text-mute">{x.event}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {first?.tx && (
                    <p className="mt-1.5 font-mono text-[10px] text-mute">
                      tx {short(first.tx)}
                      {first.block ? ` · blk ${first.block.toLocaleString('en-US')}` : ''}
                    </p>
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

import { useEffect, useRef, useState } from 'react'
import { useAttackFeed, type AttackLink, type AttackStep } from '../live/attackFeed'
import { presentStep } from '../live/creLog'

const LINK_TEXT: Record<AttackLink, string> = {
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
}
const LINK_TONE: Record<AttackLink, string> = {
  connected: 'text-[#72d7ac]',
  reconnecting: 'text-[#E2B52E]',
  disconnected: 'text-[#c46a66]',
}
const LINK_DOT: Record<AttackLink, string> = {
  connected: 'bg-[#5fd38d]',
  reconnecting: 'bg-[#E2B52E]',
  disconnected: 'bg-[#c46a66]',
}

/** Bottom CRE log. Stays mounted while exchange details cover it, so the bridge poll continues. */
export default function CreLiveConsole({ visible }: { visible: boolean }) {
  const feed = useAttackFeed()
  const { lines, fresh } = useLogBuffer(feed.status?.startedAt ?? 0, feed.status?.steps ?? [])
  const [auto, setAuto] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)
  const sticking = useRef(false)
  useEffect(() => {
    if (!auto || !visible) return
    const el = scroller.current
    if (!el) return
    sticking.current = true
    el.scrollTop = el.scrollHeight
    const frame = requestAnimationFrame(() => { sticking.current = false })
    return () => cancelAnimationFrame(frame)
  }, [lines, auto, visible])

  const source = feed.link === 'connected' ? 'Streaming from bridge' : feed.status ? 'Last events retained' : 'Waiting for bridge'

  return (
    <section
      aria-label="CRE live logs"
      aria-hidden={!visible}
      inert={!visible}
      className={`absolute left-5 right-5 bottom-4 z-20 flex h-[180px] flex-col overflow-hidden rounded-lg border border-white/[0.06] bg-[#0F1115]/90 shadow-[0_12px_40px_rgba(0,0,0,.35)] backdrop-blur transition-[opacity,transform] duration-200 ease-out ${visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'}`}
    >
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-white/[0.06] px-3">
        <span className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-cream">
          <span className={`h-1.5 w-1.5 rounded-full ${LINK_DOT[feed.link]}`} />
          CRE Live
        </span>
        <span className="font-mono text-[10px] text-mute">{source}</span>
        <span className="ml-auto flex items-center gap-3">
          <CreConnectionStatus link={feed.link} />
          <button
            type="button"
            aria-pressed={auto}
            onClick={() => setAuto((on) => !on)}
            className={`font-mono text-[10px] uppercase tracking-[0.12em] ${auto ? 'text-[#E2B52E]' : 'text-mute hover:text-cream'}`}
          >
            Auto scroll
          </button>
        </span>
      </header>
      <div
        ref={scroller}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        className="h-[140px] shrink-0 overflow-y-auto overscroll-contain"
        onScroll={(event) => {
          if (sticking.current) return
          const el = event.currentTarget
          setAuto(el.scrollHeight - el.scrollTop - el.clientHeight < 12)
        }}
      >
        {lines.length ? lines.map((line) => <CreLogRow key={line.id} line={line} animate={fresh.has(line.id)} />) : (
          <p className="px-3 py-5 font-mono text-[11px] leading-5 text-mute">
            No CRE runtime events yet.
            <span className="block">No example lines are substituted.</span>
          </p>
        )}
      </div>
    </section>
  )
}

export function CreConnectionStatus({ link }: { link: AttackLink }) {
  return (
    <span className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] ${LINK_TONE[link]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${LINK_DOT[link]} ${link === 'connected' ? 'cre-live' : ''}`} />
      {LINK_TEXT[link]}
    </span>
  )
}

export function CreLogRow({ line, animate }: { line: ReturnType<typeof presentStep>; animate: boolean }) {
  return (
    <div className={`grid h-7 grid-cols-[4.6rem_5.4rem_minmax(0,1fr)_auto] items-baseline gap-3 px-3 font-mono text-[11px] ${animate ? 'cre-log-in' : ''}`}>
      <span className="text-mute">{line.time}</span>
      <span className={`text-[10px] uppercase tracking-[0.08em] ${line.tone}`}>{line.label}</span>
      <span className="truncate text-cream/90">{line.message}</span>
      {line.meta && <span className="max-w-[16rem] truncate text-mute">{line.meta}</span>}
    </div>
  )
}

function useLogBuffer(startedAt: number, steps: AttackStep[]) {
  const buf = useRef(new Map<string, ReturnType<typeof presentStep>>())
  const primed = useRef(false)
  const fresh = useRef(new Set<string>())
  if (!primed.current) {
    if (steps.length || startedAt) {
      for (const step of steps) buf.current.set(presentStep(step, startedAt).id, presentStep(step, startedAt))
      primed.current = true
    }
  } else {
    for (const step of steps) {
      const line = presentStep(step, startedAt)
      if (!buf.current.has(line.id)) fresh.current.add(line.id)
      buf.current.set(line.id, line)
    }
  }
  while (buf.current.size > 200) {
    const oldest = buf.current.keys().next().value
    if (oldest === undefined) break
    buf.current.delete(oldest)
    fresh.current.delete(oldest)
  }
  useEffect(() => {
    if (fresh.current.size === 0) return
    const ids = fresh.current
    const timer = setTimeout(() => ids.clear(), 400)
    return () => clearTimeout(timer)
  }, [steps])
  return { lines: [...buf.current.values()].slice(-120), fresh: fresh.current }
}

import { useEffect, useRef, useState, type ReactNode } from 'react'

export type Status = 'idle' | 'active' | 'warning' | 'threat'

export function Panel({ children, className = '', title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`relative clip-hexcard ${className.includes("bg-") ? "" : "bg-coal-2"} ${className}`}>
      <div className="pointer-events-none absolute inset-0 clip-hexcard border border-white/[0.035]" />
      {title && (
        <header className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="text-[13.5px] font-semibold text-cream">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function Button({ children, variant = 'primary', onClick, className = '' }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost'; onClick?: () => void; className?: string }) {
  const v = {
    primary: 'bg-honey text-ink hover:bg-flare',
    secondary: 'border border-white/10 text-cream hover:border-honey/50 hover:text-honey',
    ghost: 'text-dim hover:text-cream',
  }[variant]
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-2 h-9 px-4 text-[13px] font-semibold rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-honey ${v} ${className}`}>
      {children}
    </button>
  )
}

const badgeStyle: Record<Status, string> = {
  idle: 'border-white/10 text-dim',
  active: 'border-honey/60 text-honey bg-honey/5',
  warning: 'border-amber border-dashed text-amber',
  threat: 'border-flare bg-flare text-ink',
}

export function Badge({ status, children }: { status: Status; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 h-6 px-2 border rounded text-[11.5px] font-medium ${badgeStyle[status]}`}>
      <HexDot status={status} size={8} />
      {children}
    </span>
  )
}

/** Small hex status pip — shape + fill encodes state */
export function HexDot({ status, size = 10 }: { status: Status; size?: number }) {
  const fill = status === 'threat' ? 'currentColor' : status === 'active' ? 'currentColor' : 'none'
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" className={status === 'threat' ? 'blink' : ''}>
      <polygon points="2.5,0.7 7.5,0.7 9.6,5 7.5,9.3 2.5,9.3 0.4,5" fill={fill} stroke="currentColor" strokeWidth="1.2" strokeDasharray={status === 'warning' ? '2 1.4' : undefined} />
    </svg>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly T[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-white/[0.06] px-5">
      {tabs.map((t) => (
        <button key={t} role="tab" aria-selected={value === t} onClick={() => onChange(t)}
          className={`relative h-10 px-3 text-[13px] font-medium transition-colors ${value === t ? 'text-honey' : 'text-dim hover:text-cream'}`}>
          {t}
          {value === t && <span className="absolute inset-x-2 -bottom-px h-0.5 bg-honey" />}
        </button>
      ))}
    </div>
  )
}

export function Row({ k, children, mono }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-3 py-2 border-b border-white/[0.04] last:border-0">
      <dt className="text-[12px] text-mute">{k}</dt>
      <dd className={`text-[13px] text-cream ${mono ? 'font-mono' : ''}`}>{children}</dd>
    </div>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="text-[12px] font-medium text-dim">{children}</span>
}

/* Geometric line icons */
const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const icons: Record<string, ReactNode> = {
  overview: <><polygon {...p} points="12,3 20,7.5 20,16.5 12,21 4,16.5 4,7.5" /><polygon {...p} points="12,8 16,10.3 16,14.7 12,17 8,14.7 8,10.3" /></>,
  monitor: <><path {...p} d="M3 12h4l2-6 4 12 2-6h6" /></>,
  trap: <><polygon {...p} points="12,3 20,7.5 20,16.5 12,21 4,16.5 4,7.5" /><circle {...p} cx="12" cy="12" r="2.5" /></>,
  incident: <><path {...p} d="M12 3l9 16H3z" /><path {...p} d="M12 10v4M12 17v.5" /></>,
  vault: <><rect {...p} x="3" y="5" width="18" height="14" rx="1.5" /><circle {...p} cx="12" cy="12" r="3" /><path {...p} d="M12 9v-1M15 12h1" /></>,
  network: <><circle {...p} cx="12" cy="5" r="2" /><circle {...p} cx="5" cy="18" r="2" /><circle {...p} cx="19" cy="18" r="2" /><path {...p} d="M11 7l-5 9M13 7l5 9M7 18h10" /></>,
  cases: <><path {...p} d="M4 7h16v12H4zM9 7V4h6v3" /></>,
  reports: <><path {...p} d="M6 3h9l4 4v14H6z" /><path {...p} d="M9 12h7M9 16h5" /></>,
  settings: <><circle {...p} cx="12" cy="12" r="3" /><path {...p} d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></>,
  search: <><circle {...p} cx="11" cy="11" r="6" /><path {...p} d="M20 20l-4.5-4.5" /></>,
  bell: <><path {...p} d="M6 16V11a6 6 0 1112 0v5l2 2H4z" /><path {...p} d="M10 20a2 2 0 004 0" /></>,
  shield: <><path {...p} d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></>,
  lock: <><rect {...p} x="5" y="11" width="14" height="9" rx="1.5" /><path {...p} d="M8 11V8a4 4 0 018 0v3" /></>,
  clock: <><circle {...p} cx="12" cy="12" r="8" /><path {...p} d="M12 8v4l3 2" /></>,
  arrow: <><path {...p} d="M5 12h14M14 7l5 5-5 5" /></>,
  request: <><rect {...p} x="4" y="3" width="16" height="18" rx="1.5" /><path {...p} d="M8 8h8M8 12h8M8 16h5" /></>,
  workflow: <><circle {...p} cx="6" cy="6" r="2.5" /><circle {...p} cx="18" cy="12" r="2.5" /><circle {...p} cx="6" cy="18" r="2.5" /><path {...p} d="M8.5 6h3a3 3 0 013 3v0M8.5 18h3a3 3 0 003-3v0" /></>,
  registry: <><path {...p} d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z" /><path {...p} d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  config: <><path {...p} d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle {...p} cx="16" cy="7" r="2" /><circle {...p} cx="10" cy="17" r="2" /></>,
  grid: <><polygon {...p} points="7,3 11,5.3 11,9.7 7,12 3,9.7 3,5.3" /><polygon {...p} points="17,3 21,5.3 21,9.7 17,12 13,9.7 13,5.3" /><polygon {...p} points="12,12 16,14.3 16,18.7 12,21 8,18.7 8,14.3" /></>,
  close: <><path {...p} d="M6 6l12 12M18 6L6 18" /></>,
  chevron: <><path {...p} d="M9 6l6 6-6 6" /></>,
  download: <><path {...p} d="M12 4v11M7 10l5 5 5-5M5 20h14" /></>,
  external: <><path {...p} d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" /></>,
  plus: <><path {...p} d="M12 5v14M5 12h14" /></>,
  filter: <><path {...p} d="M4 5h16l-6 8v6l-4-2v-4z" /></>,
  replay: <><path {...p} d="M4 12a8 8 0 108-8H8M8 1v6h6" transform="translate(0 1)" /></>,
}
export function Icon({ name, size = 18, className = '' }: { name: keyof typeof icons | string; size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>{icons[name]}</svg>
}

/* ---------------- Page-level building blocks ---------------- */

export function PageHeader({ eyebrow, title, desc, actions }: { eyebrow: string; title: ReactNode; desc?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-6 mb-6">
      <div className="max-w-[760px]">
        <Label>{eyebrow}</Label>
        <h1 className="mt-1.5 text-[28px] leading-tight font-semibold tracking-tight text-cream">{title}</h1>
        {desc && <p className="mt-2 text-[14px] leading-relaxed text-dim">{desc}</p>}
      </div>
      {actions && <div className="flex gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

export function Metric({ label, value, sub, status, className = '' }: { label: string; value: ReactNode; sub?: ReactNode; status?: Status; className?: string }) {
  const hot = status === 'threat'
  return (
    <Panel className={`px-5 py-4 ${hot ? 'bg-[#1c1a12]' : ''} ${className}`}>
      <div className="flex items-center justify-between gap-2"><Label>{label}</Label>{status && <span className={hot ? 'text-wax' : status === 'warning' ? 'text-amber' : status === 'active' ? 'text-honey' : 'text-mute'}><HexDot status={status} /></span>}</div>
      <div className={`mt-2 text-[26px] font-semibold tabular-nums tracking-tight ${hot ? 'text-wax' : 'text-cream'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-dim">{sub}</div>}
    </Panel>
  )
}

/** Maps domain states onto the four intensity levels — no extra hues */
const STATE: Record<string, Status> = {
  approved: 'active', executed: 'active', contained: 'active', resolved: 'idle', investigating: 'warning', verified: 'active', consumed: 'active', armed: 'active', healthy: 'active', applied: 'active', running: 'active', synced: 'active', normal: 'idle',
  pending: 'warning', held: 'warning', escalated: 'warning', queued: 'warning', restricted: 'warning', delayed: 'warning', rotating: 'warning', partial: 'warning', tightened: 'warning', review: 'warning', degraded: 'warning',
  blocked: 'threat', active: 'threat', triggered: 'threat', confirmed: 'threat', frozen: 'threat', critical: 'threat', rejected: 'threat',
  retired: 'idle', idle: 'idle', draft: 'idle', expired: 'idle', standby: 'idle', received: 'idle',
}
export function StateBadge({ state }: { state: string }) {
  return <Badge status={STATE[state.toLowerCase()] ?? 'idle'}>{state}</Badge>
}

export function NodeChip({ name, kind, status = 'idle', onClick, selected }: { name: string; kind?: string; status?: Status; onClick?: () => void; selected?: boolean }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-2 h-8 pl-2 pr-3 rounded-md border text-[12.5px] transition-colors ${selected ? 'border-honey bg-honey/10 text-cream' : 'border-honey/15 bg-coal-3/60 text-cream hover:border-honey/50'}`}>
      <span className={status === 'threat' ? 'text-wax' : status === 'warning' ? 'text-amber' : status === 'active' ? 'text-honey' : 'text-mute'}><HexDot status={status} /></span>
      <span className="font-medium">{name}</span>
      {kind && <span className="font-mono text-[10.5px] text-mute uppercase tracking-wider">{kind}</span>}
    </button>
  )
}

export function IncidentChip({ id, label, level = 'threat' }: { id: string; label: string; level?: Status }) {
  return (
    <span className={`inline-flex items-center gap-2 h-7 pl-1 pr-2.5 rounded-full border text-[12px] ${level === 'threat' ? 'border-wax/60 bg-wax/[0.08]' : 'border-honey/20'}`}>
      <span className={`clip-hex w-5 h-5 grid place-items-center text-[9px] font-bold ${level === 'threat' ? 'bg-wax text-ink' : 'bg-coal-3 text-honey'}`}>!</span>
      <span className="font-mono text-honey">{id}</span><span className="text-cream">{label}</span>
    </span>
  )
}

export type Col<T> = { key: string; label: string; render: (row: T) => ReactNode; className?: string; align?: 'right' }
export function DataTable<T>({ cols, rows, rowKey, selected, onSelect, dense }: { cols: Col<T>[]; rows: T[]; rowKey: (r: T) => string; selected?: string | null; onSelect?: (r: T) => void; dense?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-y border-white/[0.06]">
            {cols.map((c) => <th key={c.key} className={`px-4 h-9 text-[11.5px] font-medium text-mute whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = rowKey(r), sel = selected === k
            return (
              <tr key={k} onClick={() => onSelect?.(r)} aria-selected={sel}
                className={`border-b border-white/[0.04] transition-colors ${onSelect ? 'cursor-pointer' : ''} ${sel ? 'bg-honey/[0.06] shadow-[inset_2px_0_0_#FFC700]' : 'hover:bg-white/[0.025]'}`}>
                {cols.map((c) => <td key={c.key} className={`px-4 ${dense ? 'py-2' : 'py-3'} ${c.align === 'right' ? 'text-right' : ''} ${c.className ?? ''}`}>{c.render(r)}</td>)}
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 && <EmptyState title="Nothing matches this filter" desc="Try clearing filters or widening the time range." />}
    </div>
  )
}

export function Accordion({ items, defaultOpen = 0 }: { items: { title: ReactNode; meta?: ReactNode; body: ReactNode }[]; defaultOpen?: number }) {
  const [open, setOpen] = useState<number | null>(defaultOpen)
  return (
    <div className="divide-y divide-white/[0.05]">
      {items.map((it, i) => (
        <div key={i}>
          <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-honey/[0.03]">
            <Icon name="chevron" size={14} className={`text-dim transition-transform ${open === i ? 'rotate-90' : ''}`} />
            <span className="flex-1 text-[14px] font-medium text-cream">{it.title}</span>
            {it.meta}
          </button>
          {open === i && <div className="px-5 pb-4 pl-12 text-[13px] text-dim">{it.body}</div>}
        </div>
      ))}
    </div>
  )
}

export function VTimeline({ items }: { items: { t: string; title: ReactNode; body?: ReactNode; level?: Status; actor?: string }[] }) {
  return (
    <ol className="relative">
      {items.map((it, i) => (
        <li key={i} className="relative grid grid-cols-[76px_20px_1fr] gap-3 pb-5 last:pb-0">
          <span className="font-mono text-[11.5px] text-dim pt-0.5 text-right">{it.t}</span>
          <span className="relative flex justify-center">
            {i < items.length - 1 && <span className="absolute top-4 -bottom-5 w-px bg-honey/20" />}
            <span className={`relative mt-0.5 ${it.level === 'threat' ? 'text-wax' : it.level === 'warning' ? 'text-amber' : it.level === 'idle' ? 'text-mute' : 'text-honey'}`}><HexDot status={it.level ?? 'active'} size={13} /></span>
          </span>
          <div>
            <div className="text-[13.5px] font-medium text-cream">{it.title}{it.actor && <span className="ml-2 font-mono text-[10.5px] text-mute uppercase tracking-wider">{it.actor}</span>}</div>
            {it.body && <div className="mt-0.5 text-[12.5px] text-dim">{it.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function Drawer({ open, onClose, title, eyebrow, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; eyebrow?: string; children: ReactNode; footer?: ReactNode }) {
  useEsc(open, onClose)
  return (
    <div className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div onClick={onClose} className={`absolute inset-0 bg-ink/70 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} />
      <aside role="dialog" className={`absolute right-0 top-0 h-full w-[460px] bg-coal-2 border-l border-honey/20 flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <header className="flex items-start justify-between px-6 py-5 border-b border-white/[0.06]">
          <div>{eyebrow && <Label>{eyebrow}</Label>}<h2 className="mt-1 text-[18px] font-semibold text-cream">{title}</h2></div>
          <button onClick={onClose} aria-label="Close" className="text-dim hover:text-cream"><Icon name="close" /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && <footer className="px-6 py-4 border-t border-white/[0.06] flex gap-2 justify-end">{footer}</footer>}
      </aside>
    </div>
  )
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEsc(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center">
      <div onClick={onClose} className="absolute inset-0 bg-ink/80" />
      <div role="dialog" className="relative w-[520px] bg-coal-2 border border-honey/25 clip-hexcard">
        <header className="flex items-center justify-between px-6 pt-5 pb-3"><h2 className="text-[17px] font-semibold text-cream">{title}</h2><button onClick={onClose} aria-label="Close" className="text-dim hover:text-cream"><Icon name="close" /></button></header>
        <div className="px-6 pb-5 text-[13.5px] text-dim">{children}</div>
        {footer && <footer className="px-6 py-4 border-t border-white/[0.06] flex justify-end gap-2">{footer}</footer>}
      </div>
    </div>
  )
}
function useEsc(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
}

export function EmptyState({ title, desc, action }: { title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-6 honeycomb">
      <svg width="56" height="56" viewBox="0 0 56 56" className="text-honey/40"><polygon points="28,4 49,16 49,40 28,52 7,40 7,16" fill="none" stroke="currentColor" strokeDasharray="4 4" /><polygon points="28,18 37,23 37,33 28,38 19,33 19,23" fill="none" stroke="currentColor" /></svg>
      <div className="mt-3 text-[14px] font-medium text-cream">{title}</div>
      {desc && <div className="mt-1 text-[12.5px] text-dim max-w-[320px]">{desc}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex p-0.5 rounded-md border border-honey/15 bg-coal-2">
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} className={`h-8 px-3 rounded text-[12.5px] font-medium transition-colors ${value === o ? 'bg-honey text-ink' : 'text-dim hover:text-cream'}`}>{o}</button>
      ))}
    </div>
  )
}

export function Meter({ value, label, tone = 'honey' }: { value: number; label?: ReactNode; tone?: 'honey' | 'amber' }) {
  return (
    <div>
      {label && <div className="flex justify-between text-[12px] mb-1.5"><span className="text-dim">{label}</span><span className="font-mono text-cream">{Math.round(value * 100)}%</span></div>}
      <div className="h-1.5 bg-coal-3 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all duration-700 ${tone === 'amber' ? 'bg-amber' : 'bg-honey'}`} style={{ width: `${value * 100}%` }} /></div>
    </div>
  )
}

export const Mono = ({ children }: { children: ReactNode }) => <span className="font-mono text-[12.5px] text-cream">{children}</span>

/** Deep-link focus: scrolls the returned ref into view and flags it briefly when `active` turns on. */
export function useDeepFocus<T extends HTMLElement = HTMLDivElement>(active: boolean, key?: string) {
  const ref = useRef<T>(null)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!active) { setFlash(false); return }
    const id = setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    setFlash(true)
    return () => clearTimeout(id)
  }, [active, key])
  return { ref, ring: flash ? 'ring-1 ring-honey/70 shadow-[0_0_24px_rgba(255,199,0,0.18)]' : '' }
}

export const RED = '#E5484D'

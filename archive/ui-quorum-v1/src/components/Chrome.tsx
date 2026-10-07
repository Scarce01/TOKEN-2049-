import { useState } from 'react'
import { NavLink } from 'react-router'
import { Icon } from './ui'
import { useLive, readLive } from '../live/chain'

const NAV: { group: string; items: [string, string, string, number?][] }[] = [
  { group: 'Command center', items: [['overview', 'Overview', '/'], ['incident', 'Incidents', '/cases', 1]] },
  { group: 'Request & trigger', items: [['request', 'RequestBoard', '/requests'], ['trap', 'Traps & Decoys', '/traps']] },
  { group: 'Verification', items: [['workflow', 'CRE Workflows', '/workflows']] },
  { group: 'Execution', items: [['shield', 'Execution Center', '/execution'], ['lock', 'Approvals', '/approvals', 1], ['vault', 'Vaults & Controls', '/vaults']] },
  { group: 'Network intelligence', items: [['registry', 'ThreatRegistry', '/registry'], ['network', 'Network Members', '/network']] },
  { group: 'Red team', items: [['trap', 'Attack & Trace', '/attack']] },
  { group: 'Governance', items: [['config', 'Config & Timelock', '/config'], ['reports', 'Reports & Audit', '/reports']] },
]

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden>
        <polygon points="15,1 27,8 27,22 15,29 3,22 3,8" fill="none" stroke="#FFC700" strokeWidth="1.6" />
        <polygon points="15,8 21,11.5 21,18.5 15,22 9,18.5 9,11.5" fill="#FFC700" />
        <path d="M15 22v7" stroke="#FFC700" strokeWidth="1.6" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight text-cream">Quorum</span>
    </div>
  )
}

export function Sidebar() {
  return (
    <aside className="w-[232px] shrink-0 border-r border-line bg-coal flex flex-col px-3 py-5 overflow-y-auto">
      <div className="px-2 mb-6"><Logo /><LiveBadge /></div>
      <nav className="flex flex-col gap-3.5">
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="px-3 mb-1 text-[11px] font-medium text-mute">{g.group}</div>
            {g.items.map(([icon, label, to, count]) => (
              <NavLink key={to} to={to} end={to === '/'}
                className={({ isActive }) => `relative flex items-center gap-3 h-9 px-3 rounded-md text-[13.5px] transition-colors ${isActive ? 'bg-honey/10 text-honey' : 'text-dim hover:text-cream hover:bg-white/[0.03]'}`}>
                {({ isActive }) => (<>
                  {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-honey" />}
                  <Icon name={icon} size={17} />{label}
                  {count && <span className="ml-auto font-mono text-[11px] px-1.5 rounded bg-wax text-ink font-semibold">{count}</span>}
                </>)}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="mt-auto pt-5"><CreDock /></div>
    </aside>
  )
}

function LiveBadge() {
  const live = useLive(readLive, 6000)
  const ok = !!live.data
  const o = live.data?.orgs?.[0]
  return (
    <div className="mt-2 px-2 flex items-center gap-2 text-[10.5px] font-mono">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-400' : live.error ? 'bg-red-400' : 'bg-amber-400'}`} />
      <span className="text-mute">{ok ? `backend live · block ${live.data!.block}` : live.error ? 'backend offline (mock)' : 'connecting…'}</span>
      {ok && o ? <span className="ml-auto text-dim">{o.mode}</span> : null}
    </div>
  )
}

const WF = [['Trap', 'Active', '14:02:19'], ['Cosign', 'Running', '14:02:41'], ['Patrol', 'Healthy', '14:02:30']]

/** Compact CRE status dock: collapsed by default so it never competes with navigation */
function CreDock() {
  const [open, setOpen] = useState(false)
  return (
    <div className="mx-1 rounded-md bg-white/[0.02]">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
        <span className="text-honey"><Icon name="workflow" size={14} /></span>
        <span className="text-[12px] text-cream font-medium">CRE</span>
        <span className="font-mono text-[11px] text-dim">7/7</span>
        <Icon name="chevron" size={12} className={`ml-auto text-mute transition-transform ${open ? '-rotate-90' : 'rotate-90'}`} />
      </button>
      {!open && <div className="px-3 pb-2.5 -mt-1 text-[11.5px] text-mute"><span className="text-flare">●</span> Trap active · Patrol healthy</div>}
      {open && (
        <ul className="px-3 pb-3 space-y-1.5">
          {WF.map(([w, s, t]) => (
            <li key={w} className="grid grid-cols-[1fr_auto] text-[12px]">
              <span className="text-cream">{w} <span className={s === 'Active' ? 'text-flare' : 'text-dim'}>· {s}</span></span>
              <span className="font-mono text-[10.5px] text-mute">{t}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Header() {
  return (
    <header className="h-16 shrink-0 border-b border-line bg-coal flex items-center gap-6 px-6">
      <label className="flex items-center gap-2.5 h-10 w-[460px] px-3 rounded-md bg-coal-2 border border-line focus-within:border-honey/50 transition-colors">
        <Icon name="search" size={16} className="text-dim" />
        <input placeholder="Search addresses, transactions, exchanges, or threat signals…" className="flex-1 bg-transparent text-[13px] text-cream placeholder:text-mute outline-none" />
        <kbd className="font-mono text-[10px] text-mute border border-honey/15 rounded px-1.5">⌘K</kbd>
      </label>
      <div className="ml-auto flex items-center gap-5 text-[12px]">
        <span className="flex items-center gap-2 text-dim"><span className="text-mute">⬢</span>Quorum Network <b className="text-cream font-medium">38 members</b></span>
        <span className="flex items-center gap-2 text-dim"><span className="text-mute">⬡</span>CRE DON <b className="text-cream font-medium">7/7 nodes</b></span>
        <span className="flex items-center gap-2 h-7 px-2.5 rounded border border-flare/60 font-mono text-[11px] text-flare"><span className="w-1.5 h-1.5 rounded-full bg-flare blink" />LIVE</span>
        <button className="relative text-dim hover:text-cream" aria-label="Notifications"><Icon name="bell" size={20} /><span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-flare rounded-full" /></button>
        <div className="flex items-center gap-2.5 pl-5 border-l border-white/[0.06]">
          <div className="w-8 h-8 clip-hex bg-honey text-ink grid place-items-center text-[12px] font-bold">MK</div>
          <div className="leading-tight"><div className="text-[13px] text-cream">Mira Kovač</div><div className="text-[11px] text-mute">Security Analyst</div></div>
        </div>
      </div>
    </header>
  )
}

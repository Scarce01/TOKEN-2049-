import { useEffect, useState } from "react"
import { NavLink, useLocation } from "react-router"
import { Icon } from "./ui"
import { useReplay } from "./replay"
import { readLive, useLive } from "../live/chain"

/** Four destinations — everything else is reached by interacting with the world */
const NAV: {
  group: string
  items: [icon: string, label: string, to: string, match: string[], count?: number][]
}[] = [
  {
    group: "Command",
    items: [
      ["overview", "Overview", "/", ["/"]],
      ["incident", "Incidents", "/cases", ["/cases"], 1],
    ],
  },
  {
    group: "Network",
    items: [["network", "Network", "/network", ["/network"]]],
  },
  {
    group: "Controls",
    items: [
      [
        "shield",
        "Controls",
        "/controls",
        [
          "/controls",
          "/vaults",
          "/approvals",
          "/config",
          "/workflows",
          "/execution",
          "/traps",
          "/requests",
          "/registry",
          "/reports",
        ],
      ],
    ],
  },
]

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg
        width="26"
        height="26"
        viewBox="0 0 30 30"
        aria-hidden
        className="shrink-0"
      >
        <polygon
          points="15,1 27,8 27,22 15,29 3,22 3,8"
          fill="none"
          stroke="#D6A61F"
          strokeWidth="1.6"
        />
        <polygon
          points="15,8 21,11.5 21,18.5 15,22 9,18.5 9,11.5"
          fill="#D6A61F"
        />
        <path d="M15 22v7" stroke="#D6A61F" strokeWidth="1.6" />
      </svg>
      {!compact && (
        <span className="text-[16px] font-semibold tracking-tight text-cream">
          Quorum
        </span>
      )}
    </div>
  )
}

export function Sidebar() {
  const [open, setOpen] = useState(
    () => localStorage.getItem("q.nav") === "open",
  )
  useEffect(() => localStorage.setItem("q.nav", open ? "open" : "min"), [open])
  const { pathname } = useLocation()
  return (
    <aside
      className={`${
        open ? "w-[208px]" : "w-[60px]"
      } shrink-0 border-r border-white/[0.05] bg-[#0F1115] flex flex-col py-4 transition-[width] duration-200 ease-out`}
    >
      <div
        className={`h-8 mb-6 flex items-center ${
          open ? "px-4" : "justify-center"
        }`}
      >
        <Logo compact={!open} />
      </div>
      <nav className={`flex flex-col gap-4 ${open ? "px-2.5" : "px-2"}`}>
        {NAV.map((g) => (
          <div key={g.group}>
            {open ? (
              <div className="px-2.5 mb-1 font-mono text-[9.5px] tracking-[0.16em] uppercase text-mute">
                {g.group}
              </div>
            ) : (
              <div className="mx-auto mb-1.5 w-4 h-px bg-white/[0.06]" />
            )}
            {g.items.map(([icon, label, to, match, count]) => {
              const active =
                to === "/"
                  ? pathname === "/"
                  : match.some((m) => pathname.startsWith(m))
              return (
                <NavLink
                  key={to}
                  to={to}
                  aria-label={label}
                  className={`group relative flex items-center gap-3 h-9 rounded-md text-[13px] transition-colors ${
                    open ? "px-2.5" : "justify-center"
                  } ${
                    active
                      ? "bg-[#D6A61F]/10 text-[#E2B52E]"
                      : "text-dim hover:text-cream hover:bg-white/[0.03]"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-[#D6A61F] rounded" />
                  )}
                  <Icon name={icon} size={17} solid />
                  {open && <span>{label}</span>}
                  {count &&
                    (open ? (
                      <span className="ml-auto font-mono text-[10.5px] px-1.5 rounded bg-[#E5484D]/15 text-[#ff8a8d]">
                        {count}
                      </span>
                    ) : (
                      <span className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-[#E5484D]" />
                    ))}
                  {!open && (
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute left-full ml-3 px-2 py-1 rounded bg-[#191B20] border border-white/[0.08] text-[12px] text-cream whitespace-nowrap opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all z-50"
                    >
                      {label}
                    </span>
                  )}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>
      <button
        onClick={() => setOpen(!open)}
        aria-label={open ? "Collapse navigation" : "Expand navigation"}
        aria-expanded={open}
        className={`mt-auto mx-2 h-9 flex items-center gap-2.5 rounded-md text-mute hover:text-cream hover:bg-white/[0.03] ${
          open ? "px-2.5" : "justify-center"
        }`}
      >
        <Icon
          name="chevron"
          size={15}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
        {open && <span className="text-[12px]">Collapse</span>}
      </button>
    </aside>
  )
}

const RS = {
  live: ["LIVE", "border-white/10 text-cream", "bg-[#D6A61F]"],
  replay: ["REPLAY", "border-[#D6A61F]/40 text-[#E2B52E]", "bg-[#E2B52E]"],
  paused: ["REPLAY · PAUSED", "border-white/10 text-dim", "bg-[#6a665e]"],
  trace: ["TRACE", "border-[#D6A61F]/40 text-[#E2B52E]", "bg-[#E2B52E]"],
} as const

/** Live backend chip: reads public chain state from the fork (block, SIM/PROD mode, alert). Officer-only
 * decoy/trap data is never read here (CLAUDE.md rule 2). Falls back to "offline" so the demo still renders. */
function LiveStatus() {
  const { data, error } = useLive(readLive, 6000)
  const ok = !!data && !error
  const org = data?.orgs[0]
  const blk = data ? `${(data.block / 1e6).toFixed(2)}M` : "--"
  return (
    <span className="flex items-center gap-2 text-mute" title={ok ? `Base Sepolia fork · block ${data!.block} · ${org?.mode}` : "Backend unreachable"}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-[#5fd08a]" : "bg-[#6a665e]"}`} />
      {ok ? <>Backend <b className="font-medium text-cream">{org?.mode}</b> · blk {blk}</> : "Backend offline"}
    </span>
  )
}

export function Header() {
  const controls = useLocation().pathname === "/controls"
  const { state } = useReplay()
  const [label, cls, dot] = RS[state]
  return (
    <header className="h-12 shrink-0 border-b border-white/[0.05] bg-[#0F1115] flex items-center gap-5 px-4">
      <label className="flex items-center gap-2 h-8 w-[320px] px-2.5 rounded-md bg-white/[0.03] border border-white/[0.05] focus-within:border-[#D6A61F]/40 transition-colors">
        <Icon name="search" size={14} className="text-mute" />
        <input
          placeholder="Search address, tx, member…"
          className="flex-1 bg-transparent text-[12.5px] text-cream placeholder:text-mute outline-none"
        />
        <kbd className="font-mono text-[9.5px] text-mute">⌘K</kbd>
      </label>
      <div className="ml-auto flex items-center gap-5 font-mono text-[10.5px] uppercase tracking-[0.1em]">
        {!controls && (
          <span className="flex items-center gap-2 text-mute">
            <span className="w-1.5 h-1.5 clip-hex bg-[#D6A61F]" />
            Network <b className="font-medium text-cream">38</b>
          </span>
        )}
        {!controls && <LiveStatus />}
        <span className="flex items-center gap-2 text-mute">
          CRE DON{" "}
          <b className="font-medium text-cream">
            {controls ? "Unavailable" : "7/7"}
          </b>
        </span>
        <span
          className={`flex items-center gap-1.5 h-6 px-2 rounded border ${cls}`}
        >
          {!controls && (
            <span
              className={`w-1.5 h-1.5 rounded-full ${dot} ${
                state === "live" ? "blink" : ""
              }`}
            />
          )}
          {controls ? "DEMO" : label}
        </span>
        <button
          className="relative text-dim hover:text-cream"
          aria-label="Notifications"
        >
          <Icon name="bell" size={17} />
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-[#E5484D] rounded-full" />
        </button>
        <div
          className="w-7 h-7 clip-hex bg-[#D6A61F] text-ink grid place-items-center font-sans text-[10.5px] font-bold normal-case tracking-normal"
          title="Mira Kovač · Security Analyst"
        >
          MK
        </div>
      </div>
    </header>
  )
}

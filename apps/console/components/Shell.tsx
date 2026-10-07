'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useContext } from 'react'
import {
  countdown,
  isOfficer,
  pub,
  RecordingCtx,
  supabase,
  useChain,
  useDeployment,
  useNow,
  useSession,
} from '@/lib/client'
import { ALERT_LABEL, controlStatus } from '@/lib/reads'

const NAV = [
  ['/', 'Overview'],
  ['/control', 'Control status'],
  ['/cases', 'Cases'],
  ['/traps', 'Traps'],
  ['/network', 'Network'],
  ['/timeline', 'Timeline'],
  ['/evaluation', 'Evaluation'],
] as const

function StatusBar() {
  const d = useDeployment()
  const now = useNow()
  const { data } = useChain(['control'], (b) => controlStatus(pub(d), d, b))
  const rec = useContext(RecordingCtx)
  const sim = d.mode === 'SIM'
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-line px-4 py-2 text-xs">
      <span className="font-semibold">Qu3ee</span>
      <span className="text-muted">{d.chainId === 84532 ? 'Base Sepolia' : `chain ${d.chainId}`}</span>
      <span className={sim ? 'badge lv-2' : 'badge lv-0'}>{sim ? 'CRE simulation mode' : 'PROD (DON)'}</span>
      {data?.orgs.map((o) => (
        <span key={o.key} className="flex items-center gap-1">
          <span className="text-muted">Exchange {o.key.toUpperCase()}</span>
          <span className={`badge lv-${o.alert}`}>{ALERT_LABEL[o.alert]}</span>
          {o.alert > 0 ? <span className="text-muted">{countdown(o.alertExpiresAt, now)}</span> : null}
          {Number(o.warmFrozenUntil) > now ? (
            <span className="badge lv-4">warm frozen {countdown(o.warmFrozenUntil, now)}</span>
          ) : null}
        </span>
      ))}
      <span className="ml-auto flex items-center gap-2">
        <button type="button" className={`btn ${rec.on ? 'btn-primary' : ''}`} onClick={rec.toggle}>
          Recording mode {rec.on ? 'on' : 'off'}
        </button>
      </span>
    </div>
  )
}

export function Shell({ children }: { children: React.ReactNode }) {
  const s = useSession()
  const path = usePathname()
  if (s === undefined) return <div className="p-6 text-muted">Loading</div>
  if (!isOfficer(s) && path !== '/login') {
    return (
      <div className="p-6">
        <p className="mb-3">{s ? 'This account is not an officer.' : 'Officer login required.'}</p>
        <Link className="btn btn-primary" href="/login">
          Go to login
        </Link>
        {s ? (
          <button type="button" className="btn ml-2" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        ) : null}
      </div>
    )
  }
  if (path === '/login') return <>{children}</>
  return (
    <div className="min-h-screen">
      <StatusBar />
      <div className="flex">
        <nav className="w-44 shrink-0 border-r border-line p-3">
          {NAV.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={`block rounded px-2 py-1.5 ${path === href ? 'bg-panel font-semibold' : 'text-muted'}`}
            >
              {label}
            </Link>
          ))}
          <div className="mt-6 text-xs text-muted">{s?.user.email}</div>
          <button type="button" className="btn mt-2 text-xs" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </nav>
        <main className="min-w-0 flex-1 p-4">{children}</main>
      </div>
    </div>
  )
}

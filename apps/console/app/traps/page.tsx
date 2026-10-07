'use client'
// Traps: are all decoys still armed? Registry from quorum_index (trap-sync), balances from the chain.
import Link from 'next/link'
import type { Address } from 'viem'
import { displayCaseOf, explorerTx, pub, short, useApi, useChain, useDeployment, useMask } from '@/lib/client'
import { fmt, nativeBalances } from '@/lib/reads'

type Trap = {
  id: number
  org_id: string
  label: string
  kind: string
  ref: string
  status: string
  last_checked: string | null
  tripped_tx: string | null
  case_id: string | null
}

export default function Traps() {
  const d = useDeployment()
  const mask = useMask()
  const traps = useApi<Trap[]>('/api/traps', 15_000)
  const wallets = (traps.data ?? []).filter((t) => t.kind === 'wallet_native').map((t) => t.ref as Address)
  const bals = useChain(['trap-bals', wallets.join(',')], (b) => nativeBalances(pub(d), wallets, b))
  const balOf = (ref: string) => {
    const i = wallets.findIndex((w) => w.toLowerCase() === ref.toLowerCase())
    return i >= 0 && bals.data ? `${fmt(bals.data[i]!, 18, 4)} ETH` : ''
  }
  const orgName = (id: string) => (id.toLowerCase() === d.orgA.orgId.toLowerCase() ? 'A' : 'B')
  return (
    <div className="card">
      <div className="label mb-2">Decoys</div>
      <table className="grid">
        <thead>
          <tr>
            <th>Org</th>
            <th>Label</th>
            <th>Type</th>
            <th>Ref</th>
            <th>Balance</th>
            <th>Last checked</th>
            <th>Status</th>
            <th>Tripping tx</th>
            <th>Case</th>
          </tr>
        </thead>
        <tbody>
          {(traps.data ?? []).map((t) => (
            <tr key={t.id}>
              <td>{orgName(t.org_id)}</td>
              <td>{mask(t.label)}</td>
              <td>{t.kind}</td>
              <td className="mono">
                {mask(t.ref) !== t.ref ? '[masked]' : t.ref.startsWith('0x') ? short(t.ref) : t.ref}
              </td>
              <td className="tabular-nums">{t.kind === 'wallet_native' ? balOf(t.ref) : ''}</td>
              <td className="text-muted">{t.last_checked ? new Date(t.last_checked).toLocaleTimeString() : 'never'}</td>
              <td>
                {['threshold', 'credential'].includes(t.kind) ? (
                  'n/a'
                ) : (
                  <span className={t.status === 'tripped' ? 'badge lv-4' : 'badge lv-0'}>{t.status}</span>
                )}
              </td>
              <td className="mono">
                {t.tripped_tx ? (
                  <a className="text-accent" href={explorerTx(d, t.tripped_tx)} target="_blank" rel="noreferrer">
                    {short(t.tripped_tx)}
                  </a>
                ) : null}
              </td>
              <td>
                {t.case_id ? (
                  <Link className="text-accent" href={`/cases/${t.case_id}`}>
                    {displayCaseOf(t.case_id)}
                  </Link>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

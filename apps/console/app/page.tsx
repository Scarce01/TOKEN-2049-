'use client'
// Overview: do I need to act now?
import { OfficerDeskAbi, OfficerKind } from '@quorum/shared'
import Link from 'next/link'
import { useState } from 'react'
import type { Address, Hex } from 'viem'
import { Metric } from '@/components/Metric'
import {
  countdown,
  displayCaseOf,
  explorerTx,
  pub,
  short,
  useApi,
  useChain,
  useDeployment,
  useMask,
  useNow,
} from '@/lib/client'
import { ALERT_LABEL, controlStatus } from '@/lib/reads'
import { signAndStore, wallet } from '@/lib/wallet'

type Ev = {
  block_number: string
  block_time: string
  tx_hash: string
  contract: string
  contract_name: string
  event: string
  case_id: string | null
  args: Record<string, string>
}
type Trap = {
  id: number
  label: string
  kind: string
  status: string
  tripped_tx: string | null
  case_id: string | null
  tripped_at: string | null
}
type MetricRow = {
  name: string
  value: number
  unit: string | null
  source: 'testnet_measured' | 'public_onchain' | 'assumed'
}

function Queued() {
  const d = useDeployment()
  const now = useNow()
  const ev = useApi<Ev[]>('/api/events?since=0', 5000)
  const [msg, setMsg] = useState('')
  const done = new Set(
    (ev.data ?? []).filter((e) => e.event === 'ManualExecuted' || e.event === 'QueuedCancelled').map((e) => e.args.id),
  )
  const queued = (ev.data ?? []).filter((e) => e.event === 'ManualQueued' && !done.has(e.args.id))
  const execute = async (e: Ev) => {
    const { w, account } = await wallet(d)
    const receiver = e.contract as Address
    const fn = Number(e.args.kind) === OfficerKind.LOWER_ALERT ? 'executeLowerAlert' : 'executeManual'
    return w.writeContract({
      account,
      address: receiver,
      abi: OfficerDeskAbi,
      functionName: fn,
      args: [e.args.id as Hex],
    })
  }
  return (
    <div className="card">
      <div className="label mb-2">Queued officer actions</div>
      {queued.length === 0 ? <div className="text-muted">Nothing queued.</div> : null}
      <table className="grid">
        <tbody>
          {queued.map((e) => (
            <tr key={e.args.id}>
              <td>{Number(e.args.kind) === OfficerKind.LOWER_ALERT ? 'Lower alert' : 'Manual approve'}</td>
              <td className="mono">{short(e.args.subject)}</td>
              <td>{Number(e.args.readyAt) > now ? `ready in ${countdown(Number(e.args.readyAt), now)}` : 'ready'}</td>
              <td className="flex gap-2">
                <button
                  type="button"
                  className="btn"
                  disabled={Number(e.args.readyAt) > now}
                  onClick={() => execute(e).catch((x) => setMsg(x.message))}
                >
                  Execute
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    signAndStore(d, {
                      target: e.contract as Address,
                      kind: OfficerKind.CANCEL_QUEUED,
                      subject: e.args.id as Hex,
                      value: 0n,
                      nonce: BigInt(Date.now()),
                      deadline: BigInt(now + 3600),
                    })
                      .then(() => setMsg('Cancel signed; submit it from any case page (one signature is enough).'))
                      .catch((x) => setMsg(x.message))
                  }
                >
                  Cancel (1 officer)
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {msg ? <div className="mt-2 text-xs text-muted">{msg}</div> : null}
    </div>
  )
}

export default function Overview() {
  const d = useDeployment()
  const now = useNow()
  const mask = useMask()
  const status = useChain(['control'], (b) => controlStatus(pub(d), d, b))
  const traps = useApi<Trap[]>('/api/traps')
  const metrics = useApi<MetricRow[]>('/api/metrics', 30_000)
  const events = useApi<Ev[]>('/api/events?since=0', 5000)
  const t2f = metrics.data?.find((m) => m.name === 'trap_to_freeze_seconds')
  const tripped = (traps.data ?? []).filter((t) => t.status === 'tripped')
  const dayAgo = now - 86400
  const cases24h = new Set(
    (events.data ?? []).filter((e) => Number(e.block_time) > dayAgo && e.case_id).map((e) => e.case_id),
  ).size

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {status.data?.orgs.map((o) => (
          <div key={o.key} className="card">
            <div className="label">Exchange {o.key.toUpperCase()} alert</div>
            <div className={`mt-1 text-2xl font-semibold lv-${o.alert}`}>{ALERT_LABEL[o.alert]}</div>
            <div className="text-xs text-muted">
              {o.alert > 0 ? `expires in ${countdown(o.alertExpiresAt, now)}` : 'no active alert'} ·{' '}
              <span className="src">chain state</span>
            </div>
          </div>
        ))}
        <Metric label="Cases, last 24h" value={cases24h} source="chain_state" hint="indexed events" />
        <Metric
          label="Trap to freeze"
          value={t2f ? t2f.value.toFixed(1) : 'n/a'}
          unit={t2f ? 's' : undefined}
          source={t2f?.source ?? 'testnet_measured'}
          hint={t2f ? 'median' : 'not measured yet'}
        />
      </div>

      <div className="card">
        <div className="label mb-2">Tripped traps</div>
        {tripped.length === 0 ? <div className="text-muted">All traps armed.</div> : null}
        <table className="grid">
          <tbody>
            {tripped.map((t) => (
              <tr key={t.id}>
                <td>{mask(t.label)}</td>
                <td>{t.kind}</td>
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
                  ) : (
                    'pending'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Queued />

      <div className="card">
        <div className="label mb-2">Recent on-chain events</div>
        <table className="grid">
          <tbody>
            {(events.data ?? []).slice(0, 15).map((e) => (
              <tr key={`${e.tx_hash}-${e.event}-${e.block_number}`}>
                <td className="mono text-muted">#{e.block_number}</td>
                <td>{e.event}</td>
                <td className="text-muted">{e.contract_name}</td>
                <td>
                  {e.case_id ? (
                    <Link className="text-accent" href={`/cases/${e.case_id}`}>
                      {displayCaseOf(e.case_id)}
                    </Link>
                  ) : null}
                </td>
                <td className="mono">
                  <a className="text-accent" href={explorerTx(d, e.tx_hash)} target="_blank" rel="noreferrer">
                    {short(e.tx_hash)}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

'use client'
// Control status: everything read straight from the chain, one multicall per block (D47, D59).
import { countdown, pub, useBlock, useChain, useDeployment, useNow } from '@/lib/client'
import { ALERT_LABEL, controlStatus, fmt } from '@/lib/reads'

export default function Control() {
  const d = useDeployment()
  const now = useNow()
  const block = useBlock()
  const { data } = useChain(['control'], (b) => controlStatus(pub(d), d, b))
  return (
    <div className="space-y-4">
      <div className="text-xs text-muted">
        All values read from the chain at block {block?.toString() ?? '...'} (not from the database). Receiver mode:{' '}
        {data?.orgs[0]?.mode === 1 ? 'SIM (CRE simulation, tx.origin guard)' : 'PROD (Forwarder + workflow whitelist)'}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data?.orgs.map((o) => (
          <div key={o.key} className="card space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-semibold">Exchange {o.key.toUpperCase()}</div>
              <span className={`badge lv-${o.alert}`}>{ALERT_LABEL[o.alert]}</span>
            </div>
            <table className="grid">
              <tbody>
                <tr>
                  <td className="text-muted">Alert expires</td>
                  <td>{o.alert > 0 ? countdown(o.alertExpiresAt, now) : 'n/a'}</td>
                </tr>
                <tr>
                  <td className="text-muted">Warm vault freeze</td>
                  <td className={Number(o.warmFrozenUntil) > now ? 'text-bad' : ''}>
                    {Number(o.warmFrozenUntil) > now
                      ? `frozen, ${countdown(o.warmFrozenUntil, now)} left`
                      : 'not frozen'}
                  </td>
                </tr>
                <tr>
                  <td className="text-muted">Hot vault freeze</td>
                  <td>
                    {Number(o.hotFrozenUntil) > now ? `frozen, ${countdown(o.hotFrozenUntil, now)} left` : 'not frozen'}
                  </td>
                </tr>
                <tr>
                  <td className="text-muted">Hot quota</td>
                  <td className="tabular-nums">
                    {fmt(o.hotQuota.qUSD, 6)} qUSD · {fmt(o.hotQuota.qETH, 18, 3)} qETH
                  </td>
                </tr>
                <tr>
                  <td className="text-muted">Hot balance</td>
                  <td className="tabular-nums">
                    {fmt(o.hotBal.qUSD, 6)} qUSD · {fmt(o.hotBal.qETH, 18, 3)} qETH
                  </td>
                </tr>
                <tr>
                  <td className="text-muted">Warm balance</td>
                  <td className="tabular-nums">
                    {fmt(o.warmBal.qUSD, 6)} qUSD · {fmt(o.warmBal.qETH, 18, 3)} qETH
                  </td>
                </tr>
                <tr>
                  <td className="text-muted">Cold delay</td>
                  <td>{(Number(o.coldDelay) / 3600).toFixed(0)} h</td>
                </tr>
                <tr>
                  <td className="text-muted">Last PING</td>
                  <td className="mono">{o.lastPing ? BigInt(o.lastPing).toString() : 'none'}</td>
                </tr>
                <tr>
                  <td className="text-muted">Receiver</td>
                  <td className="mono">{o.org.receiver}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <div className="card text-sm">
        Active confirmed entries on the shared list: <b>{data?.activeConfirmed.toString() ?? '...'}</b>{' '}
        <span className="text-muted">(network follow level contributes at most L1)</span>
      </div>
    </div>
  )
}

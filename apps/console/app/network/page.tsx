'use client'
// Network: shared-list entries (from ThreatAdded events) and both exchanges side by side. Phase 4 fills this out.
import { explorerTx, short, useApi, useDeployment, useMask } from '@/lib/client'

type Ev = { block_time: string; tx_hash: string; event: string; args: Record<string, string> }

export default function Network() {
  const d = useDeployment()
  const mask = useMask()
  const ev = useApi<Ev[]>('/api/events?since=0', 10_000)
  const threats = (ev.data ?? []).filter((e) => e.event === 'ThreatAdded')
  const orgName = (o: string) => (o?.toLowerCase() === d.orgA.orgId.toLowerCase() ? 'Exchange A' : 'Exchange B')
  return (
    <div className="card">
      <div className="label mb-2">Shared list (mark only, never blocks; entries expire)</div>
      <table className="grid">
        <thead>
          <tr>
            <th>Suspect</th>
            <th>Reported by</th>
            <th>Evidence</th>
            <th>Fingerprint</th>
            <th>Count</th>
            <th>Expires</th>
          </tr>
        </thead>
        <tbody>
          {threats.map((t) => (
            <tr key={t.tx_hash + t.args.evidenceHash}>
              <td className="mono">{mask(t.args.suspect)}</td>
              <td>{orgName(t.args.reporterOrg!)}</td>
              <td className="mono">
                <a className="text-accent" href={explorerTx(d, t.tx_hash)} target="_blank" rel="noreferrer">
                  {short(t.tx_hash)}
                </a>
              </td>
              <td className="mono">{short(t.args.fingerprintHash)}</td>
              <td>{t.args.count}</td>
              <td>{new Date(Number(t.args.expiresAt) * 1000).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

'use client'
import Link from 'next/link'
import { displayCaseOf, useApi } from '@/lib/client'

type Row = {
  case_id: string
  org_id: string | null
  kind: string
  decision: number | null
  public_reason: number | null
  updated_at: string
}
const DEC = ['', 'APPROVE', 'REJECT', 'PENDING']

export default function Cases() {
  const cases = useApi<Row[]>('/api/cases', 5000)
  return (
    <div className="card">
      <div className="label mb-2">Cases</div>
      <table className="grid">
        <thead>
          <tr>
            <th>Case</th>
            <th>Type</th>
            <th>Decision</th>
            <th>Public reason</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {(cases.data ?? []).map((c) => (
            <tr key={c.case_id}>
              <td>
                <Link className="text-accent mono" href={`/cases/${c.case_id}`}>
                  {displayCaseOf(c.case_id as `0x${string}`)}
                </Link>
              </td>
              <td>{c.kind}</td>
              <td className={c.decision === 2 ? 'text-bad' : c.decision === 3 ? 'text-warn' : ''}>
                {c.decision ? DEC[c.decision] : 'n/a'}
              </td>
              <td>{c.public_reason || ''}</td>
              <td className="text-muted">{new Date(Number(c.updated_at) * 1000).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

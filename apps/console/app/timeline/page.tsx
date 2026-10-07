'use client'
// Timeline: replay one attacker across both exchanges; the first point is the trap's test transfer (D43).
import { useState } from 'react'
import { displayCaseOf, explorerTx, short, useApi, useDeployment, useMask } from '@/lib/client'

type Point = { at: number; kind: string; tx: string; caseId: string | null; label: string }

export default function Timeline() {
  const d = useDeployment()
  const mask = useMask()
  const [input, setInput] = useState('')
  const [suspect, setSuspect] = useState<string | null>(null)
  const t = useApi<{ points: Point[] }>(suspect ? `/api/timeline?suspect=${suspect}` : null, 10_000)
  const pts = t.data?.points ?? []
  const t0 = pts[0]?.at ?? 0
  return (
    <div className="space-y-3">
      <div className="card flex gap-2">
        <input
          className="mono w-[28rem]"
          placeholder="attacker address"
          value={input}
          onChange={(e) => setInput(e.target.value.trim())}
        />
        <button type="button" className="btn btn-primary" onClick={() => setSuspect(input)}>
          Replay
        </button>
      </div>
      <div className="card">
        <table className="grid">
          <tbody>
            {pts.map((p, i) => (
              <tr key={`${p.tx}-${p.kind}-${i}`}>
                <td className="text-muted tabular-nums">+{p.at - t0}s</td>
                <td className={i === 0 ? 'font-semibold' : ''}>{p.kind}</td>
                <td className="text-muted">{mask(p.label)}</td>
                <td>{p.caseId ? displayCaseOf(p.caseId) : ''}</td>
                <td className="mono">
                  <a className="text-accent" href={explorerTx(d, p.tx)} target="_blank" rel="noreferrer">
                    {short(p.tx)}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {suspect && pts.length === 0 ? <div className="text-muted">No events for this address.</div> : null}
      </div>
    </div>
  )
}

'use client'
// Evaluation: every number with its source type (D32).
import { Metric } from '@/components/Metric'
import { useApi } from '@/lib/client'

type M = {
  name: string
  value: number
  unit: string | null
  source: 'testnet_measured' | 'public_onchain' | 'assumed'
  notes: string | null
}

export default function Evaluation() {
  const m = useApi<M[]>('/api/metrics', 30_000)
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {(m.data ?? []).map((x) => (
        <Metric
          key={x.name}
          label={x.name}
          value={Number(x.value.toFixed(3))}
          unit={x.unit ?? undefined}
          source={x.source}
          hint={x.notes ?? undefined}
        />
      ))}
      {m.data?.length === 0 ? <div className="text-muted">No metrics recorded yet.</div> : null}
    </div>
  )
}

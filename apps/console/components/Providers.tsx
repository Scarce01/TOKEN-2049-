'use client'
import type { Deployment } from '@quorum/shared/deployments'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { api, DeploymentCtx, isOfficer, RecordingCtx, useSession } from '@/lib/client'

function Recording({ children }: { children: React.ReactNode }) {
  const s = useSession()
  const [on, setOn] = useState(false)
  const [refs, setRefs] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!isOfficer(s)) return
    api<{ ref: string }[]>('/api/traps')
      .then((rows) => setRefs(new Set(rows.map((r) => r.ref.toLowerCase()))))
      .catch(() => {})
  }, [s])
  const value = useMemo(() => ({ on, refs, toggle: () => setOn((x) => !x) }), [on, refs])
  return <RecordingCtx.Provider value={value}>{children}</RecordingCtx.Provider>
}

export function Providers({ deployment, children }: { deployment: Deployment; children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }))
  return (
    <QueryClientProvider client={qc}>
      <DeploymentCtx.Provider value={deployment}>
        <Recording>{children}</Recording>
      </DeploymentCtx.Provider>
    </QueryClientProvider>
  )
}

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export type ReplayState = 'live' | 'replay' | 'paused' | 'trace'
const Ctx = createContext<{ state: ReplayState; set: (s: ReplayState) => void }>({ state: 'live', set: () => {} })

export function ReplayProvider({ children }: { children: ReactNode }) {
  const [state, set] = useState<ReplayState>('live')
  const v = useMemo(() => ({ state, set }), [state])
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>
}
export const useReplay = () => useContext(Ctx)

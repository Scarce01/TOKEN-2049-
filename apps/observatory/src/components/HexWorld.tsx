import { useEffect, useRef, useState } from 'react'
import hexmapHtml from '@hexmap/hexmap.html?raw'
import { DECOYS, T } from './worldData'
import type { ViewCmd } from './World'

// The 3D map is hexmap.html (the design source), embedded as-is. This app owns the chrome and the clock;
// the iframe only renders. Messages: we send {type:'time'|'view'}, it sends {type:'ready'|'pick'}.

/** Console incident clock -> hexmap clock (hit at 1s, vault restricted at 4s, network synced at 8s, cash-out held at 10s, end 18s). */
function toHexTime(t: number) {
  if (t < 0) return 0
  const k: [number, number][] = [[0, 0], [T.trigger, 1], [T.toLocal, 4], [T.dispatch, 8], [T.end, 18]]
  for (let i = 1; i < k.length; i++) {
    const [a, x] = k[i - 1], [b, y] = k[i]
    if (t <= b) return x + ((t - a) / (b - a)) * (y - x)
  }
  return 18
}

const AGENCY: Record<string, string> = { A: 'ag-a', B: 'ag-b', D: 'ag-d', F: 'ag-f' }
// hexmap decoy order: 4:5 (A), 29:7 (B), 9:12 (A, the one that is touched)
const DECOY_IDS = [DECOYS[1].id, DECOYS[2].id, DECOYS[0].id]

type Pick = { kind: 'terrain' | 'vault' | 'decoy' | 'account' | 'none'; exchange: string; decoy: number }
/** null = the click hit no cell (empty space) */
function pickId(p: Pick): string | null {
  if (p.kind === 'none') return null
  const ag = AGENCY[p.exchange] ?? 'ag-a'
  if (p.kind === 'decoy') return `decoy:${DECOY_IDS[p.decoy] ?? DECOYS[p.decoy % DECOYS.length].id}`
  if (p.kind === 'vault' && ag !== 'ag-f') return `vault:${ag}`
  return `area:${ag}`
}

export default function HexWorld({ t, view, onSelect }: { t: number; view: ViewCmd; onSelect: (id: string | null) => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const post = (m: object) => frame.current?.contentWindow?.postMessage(m, '*')

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      if (e.data?.type === 'ready') setReady(true)
      else if (e.data?.type === 'pick') onSelect(pickId(e.data as Pick))
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [onSelect])

  // live panel -> map (patrol bees, real quota label); see live/bridge.ts toMap
  useEffect(() => {
    if (!ready) return
    const fwd = (e: Event) => post((e as CustomEvent).detail)
    window.addEventListener('hexmap', fwd)
    return () => window.removeEventListener('hexmap', fwd)
  }, [ready])

  useEffect(() => { if (ready) post({ type: 'time', t: toHexTime(t) }) }, [t, ready])
  useEffect(() => { if (ready && view.n > 0) post({ type: 'view', kind: view.kind }) }, [view, ready])

  return <iframe ref={frame} title="Network map" srcDoc={hexmapHtml} className="block w-full h-full border-0" />
}

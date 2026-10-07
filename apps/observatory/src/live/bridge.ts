// Read-only client for the fork bridge (packages/offchain/scripts/fork-demo/bridge.ts in this repo), which
// schedules the real Patrol workflow on its own (sim-runner cadence). The UI only shows its status.
export const BRIDGE = (import.meta.env.VITE_BRIDGE_URL as string) ?? (typeof location !== 'undefined' ? location.origin + '/bridge' : 'http://127.0.0.1:8790')

export const HANDLERS = ['ping', 'decoys', 'epoch', 'quota', 'reconcile'] as const
export type Handler = (typeof HANDLERS)[number]
/** org = deployment letter (A, B, ...) of the receiver that processed the report */
export type PatrolReport = { org: string; tx: string; block: number; ok: boolean; events: Record<string, number> }
export type HandlerState = {
  handler: Handler
  status: 'idle' | 'run' | 'ok' | 'fail'
  result?: string
  reports?: PatrolReport[]
  startedAt?: number
  finishedAt?: number
  ms?: number
}
export type PatrolStatus = {
  tick: number
  tickEverySec: number
  auto: boolean
  nextTickAt: number
  running: Handler | null
  handlers: Record<Handler, HandlerState>
  history: HandlerState[]
  /** bridge clock, to turn its timestamps into "ago" without trusting the browser clock */
  now: number
}

export async function readPatrol(): Promise<PatrolStatus> {
  const r = await fetch(`${BRIDGE}/patrol/status`)
  if (!r.ok) throw new Error(`bridge http ${r.status}`)
  return r.json()
}

export type AttackEvent =
  | { type: 'start'; org: string; block: number }
  | { type: 'step'; phase: string; org: string; detail: string; tx?: string; block?: number; cre?: string; nownodes?: string; verdict?: string }
  | { type: 'response'; phase: 'tighten'; event: string; org: string; detail: string; tx: string; block: number }
  | { type: 'done'; org: string; block: number }
  | { type: 'error'; message: string }

/** Starts the real attack demo on the fork, then polls its status, emitting each new step in order.
 * Polling (not a long-lived stream) because streamed responses are unreliable through the preview proxy. */
export async function runAttack(on: (e: AttackEvent) => void): Promise<void> {
  const r = await fetch(`${BRIDGE}/attack`, { method: 'POST' })
  if (!r.ok) {
    const b = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(b.error ?? `bridge http ${r.status}`)
  }
  // CRE verify waits for the running Patrol simulate, then compiles and runs the trap workflow: about 2 min on
  // the fork, so poll until the bridge says the run ended (10 min ceiling, then report instead of hanging busy)
  let seen = 0
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 600))
    const s = (await fetch(`${BRIDGE}/attack/status`).then((x) => x.json()).catch(() => null)) as { running: boolean; steps: AttackEvent[] } | null
    if (!s) continue
    for (; seen < s.steps.length; seen++) on(s.steps[seen])
    if (!s.running && seen >= s.steps.length) return
  }
  throw new Error('attack still running on the bridge after 10 min')
}

/** Messages for the hexmap iframe; HexWorld forwards them (window event 'hexmap'). */
export function toMap(msg: object) {
  window.dispatchEvent(new CustomEvent('hexmap', { detail: msg }))
}

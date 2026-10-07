// Patrol cadence, same as services/sim-runner (mode B): every tick decoys, reconcile, quota;
// epoch every 60 ticks (hourly at 1-minute ticks), ping every 10 ticks. Trigger indices are fixed in
// workflows/patrol/workflow.ts: 0 ping, 1 decoys, 2 epoch, 3 quota, 4 reconcile.

export const HANDLERS = ['ping', 'decoys', 'epoch', 'quota', 'reconcile'] as const
export type Handler = (typeof HANDLERS)[number]

/** Handlers due on tick n (1-based), in sim-runner's enqueue order. */
export function dueHandlers(tick: number, enableDecoys: boolean): Handler[] {
  const due: Handler[] = []
  if (enableDecoys) due.push('decoys')
  due.push('reconcile', 'quota')
  if (tick % 60 === 1) due.push('epoch')
  if (tick % 10 === 1) due.push('ping')
  return due
}

export const indexOf = (h: Handler) => HANDLERS.indexOf(h)

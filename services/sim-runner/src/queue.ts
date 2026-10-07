// Mode B: one broadcast key (simOperator), so one simulate at a time. Priority Trap > Patrol > Cosign.
// A job's dedupe key is marked done only after its report landed; failures are retried.

export type JobKind = 'trap' | 'patrol' | 'cosign'
export type Job = {
  kind: JobKind
  key: string
  triggerIndex: number
  txHash?: string
  logIndex?: number
  enqueuedAt: number
  attempts: number
}

const PRIORITY: Record<JobKind, number> = { trap: 0, patrol: 1, cosign: 2 }
export const MAX_ATTEMPTS = 5

export class JobQueue {
  private jobs: Job[] = []
  private done = new Set<string>()
  private queued = new Set<string>()

  push(j: Omit<Job, 'attempts'>): boolean {
    if (this.done.has(j.key) || this.queued.has(j.key)) return false
    this.jobs.push({ ...j, attempts: 0 })
    this.queued.add(j.key)
    return true
  }

  /** Highest priority first, then oldest. */
  next(): Job | undefined {
    if (this.jobs.length === 0) return undefined
    this.jobs.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.enqueuedAt - b.enqueuedAt)
    const j = this.jobs.shift()!
    this.queued.delete(j.key)
    return j
  }

  succeed(j: Job): void {
    this.done.add(j.key)
  }

  fail(j: Job): void {
    if (j.attempts + 1 >= MAX_ATTEMPTS) return
    this.jobs.push({ ...j, attempts: j.attempts + 1 })
    this.queued.add(j.key)
  }

  get size(): number {
    return this.jobs.length
  }
}

/** Builds the simulate arguments. Production limits stay on (no --limits flag; D30). */
export function simulateArgs(j: Job, wasm?: string): string[] {
  const args = ['workflow', 'simulate', j.kind, '-T', 'staging-settings', '--non-interactive', '--broadcast']
  if (wasm) args.push('--wasm', wasm)
  args.push('--trigger-index', String(j.triggerIndex))
  if (j.kind !== 'patrol') args.push('--evm-tx-hash', j.txHash!, '--evm-event-index', String(j.logIndex!))
  return args
}

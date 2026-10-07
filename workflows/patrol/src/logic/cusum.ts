// CUSUM over the hot vault's per-minute outflow (36_phase6.md 6.3). Fixed 168-slot baseline from
// config (no online learning), integer log2 x 1000, checkpoint + recompute == per-minute (D58).
import { ringAt, ringCovers } from '../../../../packages/shared/src/index'

export type Baseline = { mu: bigint; sigma: bigint } // log2 units x 1000
export type CusumParams = { baseline: Baseline[]; k: bigint; h: bigint; sigmaFloor: bigint } // k, h x 1000
export type PlannedOp = { windowStart: bigint; windowEnd: bigint; registeredMinute: bigint; perMinute: bigint }
export type CusumState = { minute: bigint; S: bigint; alarm: boolean; gap: boolean }

export const DEFAULT_CUSUM = (baseline: Baseline[]): CusumParams => ({ baseline, k: 500n, h: 5000n, sigmaFloor: 50n })

/** floor(log2(x + 1) * 1000) with linear interpolation inside each power of two; exact integers only. */
export function log2milli(x: bigint): bigint {
  const v = x + 1n
  let msb = -1n
  for (let t = v; t > 0n; t >>= 1n) msb++
  const base = 1n << msb
  return msb * 1000n + ((v - base) * 1000n) / base
}

/** Minute's outflow after discounting planned ops active in that minute (never below 0). */
export function discounted(x: bigint, minute: bigint, ops: PlannedOp[]): bigint {
  let out = x
  for (const op of ops) {
    const from = op.windowStart / 60n > op.registeredMinute ? op.windowStart / 60n : op.registeredMinute
    if (minute >= from && minute < op.windowEnd / 60n) out -= op.perMinute
  }
  return out > 0n ? out : 0n
}

export function step(p: CusumParams, S: bigint, x: bigint, minute: bigint): { S: bigint; alarm: boolean } {
  const b = p.baseline[Number((minute / 60n) % 168n)] ?? { mu: 0n, sigma: 1000n }
  const sigma = b.sigma > p.sigmaFloor ? b.sigma : p.sigmaFloor
  const z = ((log2milli(x) - b.mu) * 1000n) / sigma
  let next = S + z - p.k
  if (next < 0n) next = 0n
  return { S: next, alarm: next > p.h }
}

/**
 * Recompute from the checkpoint's next minute up to lastMinute (inclusive) using the outRing read at
 * the anchor. Minutes the ring no longer covers are skipped and flagged as a gap.
 */
export function recompute(
  p: CusumParams,
  cp: CusumState,
  ring: readonly bigint[],
  lastMinute: bigint,
  ops: PlannedOp[],
): CusumState {
  let S = cp.S
  let alarm = cp.alarm
  let gap = false
  const start = cp.minute === 0n ? lastMinute : cp.minute + 1n
  for (let m = start; m <= lastMinute; m++) {
    if (!ringCovers(ring, m)) {
      gap = true
      continue
    }
    const r = step(p, S, discounted(ringAt(ring, m), m, ops), m)
    S = r.S
    alarm = r.alarm
  }
  return { minute: lastMinute > cp.minute ? lastMinute : cp.minute, S, alarm, gap }
}

/** Write a checkpoint every `every` minutes, or at once when the alarm flips. */
export function shouldWrite(prev: CusumState, next: CusumState, every = 10n): boolean {
  if (next.minute <= prev.minute) return false
  return next.alarm !== prev.alarm || next.minute - prev.minute >= every || prev.minute === 0n
}

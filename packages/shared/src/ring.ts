/** 32-slot minute ring words: minute (high 32 bits) | value (low 224 bits). Mirrors contracts/src/lib/MinuteRing.sol. */
const MASK = (1n << 224n) - 1n

export function ringMinute(w: bigint): bigint {
  return w >> 224n
}

export function ringValue(w: bigint): bigint {
  return w & MASK
}

/** Value recorded for `minute`, or 0 when the slot holds another minute. */
export function ringAt(ring: readonly bigint[], minute: bigint): bigint {
  const w = ring[Number(minute % 32n)] ?? 0n
  return w !== 0n && ringMinute(w) === minute ? ringValue(w) : 0n
}

/** True when the ring still covers `minute` (the slot was not overwritten by a newer minute). */
export function ringCovers(ring: readonly bigint[], minute: bigint): boolean {
  const w = ring[Number(minute % 32n)] ?? 0n
  return w === 0n || ringMinute(w) <= minute
}

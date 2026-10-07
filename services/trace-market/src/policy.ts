// Investigator spend policy. Amounts are in the asset's smallest unit (1 tADA = 1,000,000 lovelace).
// Up to 1: pay automatically. Up to 10: automatically only for a CONFIRMED case. Above 10: a human approves.
// BEHAVIOR never starts a paid investigation (only CONFIRMED or LINKED cases do).
export type Classification = 'CONFIRMED' | 'LINKED' | 'BEHAVIOR'
export type Decision = 'auto' | 'human' | 'refuse'

export const UNIT = 1_000_000n

export function decide(amount: bigint, c: Classification): Decision {
  if (c === 'BEHAVIOR') return 'refuse'
  if (amount <= UNIT) return 'auto'
  if (amount <= 10n * UNIT && c === 'CONFIRMED') return 'auto'
  return 'human'
}

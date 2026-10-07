// Pure native-coin decoy check (32_phase2.md 2.5). Decoys only ever receive, so their balance
// must never drop below the funding floor, and never fall inside the window.
import type { Address, Hex } from 'viem'
import { type Action, caseIdNative, confirmedPack } from '../../../../packages/shared/src/index'

export type PatrolDecoy = { address: Address; orgId: Hex; floor: bigint }

export type DecoyFacts = {
  chainId: bigint
  anchorBlock: bigint
  anchorTime: bigint
  decoys: PatrolDecoy[]
  balAnchor: bigint[] // native balance at anchor, same order as decoys
  balPrev: bigint[] | null // at anchor - N; null when old state is unreadable (floor check only)
  orgs: { orgId: Hex; hot: Address; warm: Address }[]
  tokens: Address[]
  freezeDuration: bigint
  alertTtl: bigint
  coldDelay: bigint
  threatTtl: bigint
}

export type DecoyTrip = { orgId: Hex; caseId: Hex; reason: 'floor' | 'window'; actions: Action[] }

export function checkDecoys(f: DecoyFacts): DecoyTrip[] {
  const out: DecoyTrip[] = []
  f.decoys.forEach((d, i) => {
    const now = f.balAnchor[i] ?? 0n
    let reason: 'floor' | 'window' | null = null
    if (now < d.floor) reason = 'floor'
    else if (f.balPrev && now < (f.balPrev[i] ?? 0n)) reason = 'window'
    if (!reason) return
    const org = f.orgs.find((o) => o.orgId.toLowerCase() === d.orgId.toLowerCase())
    if (!org) return
    const caseId = caseIdNative(d.orgId, f.chainId, d.address, f.anchorBlock)
    out.push({
      orgId: d.orgId,
      caseId,
      reason,
      actions: confirmedPack({
        warmVault: org.warm,
        hotVault: org.hot,
        tokens: f.tokens,
        blockTime: f.anchorTime,
        freezeDuration: f.freezeDuration,
        alertTtl: f.alertTtl,
        coldDelay: f.coldDelay,
        // Without scanning transactions the destination is unknown: suspect 0 (THREAT skipped).
        threat: {
          suspect: '0x0000000000000000000000000000000000000000',
          chainId: f.chainId,
          evidenceHash: caseId,
          fingerprintHash: `0x${'0'.repeat(64)}`,
          expiresAt: f.anchorTime + f.threatTtl,
          parentEvidence: `0x${'0'.repeat(64)}`,
          proof: '0x',
        },
      }),
    })
  })
  return out
}

/** PATROL_DECOYS secret: JSON [{ "a": address, "o": orgId, "f": floor wei as string }]. */
export function parsePatrolDecoys(json: string): PatrolDecoy[] {
  const raw = JSON.parse(json) as { a: string; o: string; f: string }[]
  return raw.map((x) => ({ address: x.a as Address, orgId: x.o as Hex, floor: BigInt(x.f) }))
}

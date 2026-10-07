// Pure matching of chain facts to trap rows (32_phase2.md 2.9). Display only: tightening never depends on it.
import { caseIdNative, caseIdTrap, caseIdWithdrawal } from '@quorum/shared'
import type { Hex } from 'viem'

export type Trap = { id: number; org_id: Hex; kind: string; ref: string; status: string }
export type TransferLog = { from: Hex; txHash: Hex; logIndex: number; block: bigint }
export type RequestLog = { orgId: Hex; requestId: Hex; userIdHash: Hex; to: Hex; txHash: Hex; block: bigint }
export type TightenedLog = { caseId: Hex; block: bigint }
export type Trip = { id: number; trippedTx: Hex; caseId: Hex | null; block: bigint }

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function matchTrips(
  traps: Trap[],
  chainId: number,
  transfers: TransferLog[],
  requests: RequestLog[],
  tightened: TightenedLog[],
  nativeDrops: { address: Hex; block: bigint; txHash: Hex | null }[],
): Trip[] {
  const out: Trip[] = []
  const tightenedIds = new Set(tightened.map((t) => t.caseId.toLowerCase()))
  for (const t of traps) {
    if (t.status === 'tripped') continue
    if (t.kind === 'wallet_erc20') {
      const tr = transfers.find((x) => eq(x.from, t.ref))
      if (tr)
        out.push({
          id: t.id,
          trippedTx: tr.txHash,
          caseId: caseIdTrap(t.org_id, chainId, tr.txHash, tr.logIndex),
          block: tr.block,
        })
    } else if (t.kind === 'wallet_native') {
      const drop = nativeDrops.find((x) => eq(x.address, t.ref))
      if (drop) {
        // Patrol keys the case by the block where it *noticed* the drop, which trap-sync cannot know:
        // look for a Tightened case within 200 blocks after the drop.
        let caseId: Hex | null = null
        for (let b = drop.block; b <= drop.block + 200n && !caseId; b++) {
          const c = caseIdNative(t.org_id, chainId, t.ref as Hex, b)
          if (tightenedIds.has(c.toLowerCase())) caseId = c
        }
        out.push({ id: t.id, trippedTx: drop.txHash ?? ('0x' as Hex), caseId, block: drop.block })
      }
    } else if (t.kind === 'account') {
      const r = requests.find((x) => eq(x.userIdHash, t.ref))
      if (r) out.push({ id: t.id, trippedTx: r.txHash, caseId: caseIdWithdrawal(r.orgId, r.requestId), block: r.block })
    } else if (t.kind === 'address') {
      for (const r of requests.filter((x) => eq(x.to, t.ref))) {
        const c = caseIdWithdrawal(r.orgId, r.requestId)
        if (tightenedIds.has(c.toLowerCase())) {
          out.push({ id: t.id, trippedTx: r.txHash, caseId: c, block: r.block })
          break
        }
      }
    }
  }
  return out
}

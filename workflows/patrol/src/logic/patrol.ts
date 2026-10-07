// Patrol phase 6 decisions (36_phase6.md 6.1, 6.2; 10_interfaces.md 3.1 backlog). Pure functions over views.
import type { Address, Hex } from 'viem'
import { encodeAbiParameters, keccak256, parseAbiParameters } from 'viem'
import { type Action, act, confirmedPack, ringMinute, ringValue } from '../../../../packages/shared/src/index'

export type VaultView = {
  vault: Address
  frozenUntil: bigint
  configHash: Hex
  balances: readonly bigint[]
  quotas: readonly bigint[]
  caps: readonly bigint[]
  lastEpochs: readonly bigint[]
  extOutTotals: readonly bigint[]
  fundedTotals: readonly bigint[]
}

export type OrgView = {
  orgId: Hex
  alert: number
  deployedMinute: bigint
  tokens: readonly Address[]
  reqRing: readonly bigint[]
  verdictRing: readonly bigint[]
  hot: VaultView
  warm: VaultView
  hotOutRings: readonly (readonly bigint[])[]
  assets: readonly { safeBlock: bigint; set: boolean; value: bigint }[]
  hotCheckpoints: readonly { minute: bigint; alarm: boolean; gap: boolean; S: bigint }[]
}

/** V = hot + warm balances + external outflow - funded inflow. Constant under every legitimate path. */
export function assetValue(o: OrgView, ti: number): bigint {
  return (
    (o.hot.balances[ti] ?? 0n) +
    (o.warm.balances[ti] ?? 0n) +
    (o.hot.extOutTotals[ti] ?? 0n) +
    (o.warm.extOutTotals[ti] ?? 0n) -
    (o.hot.fundedTotals[ti] ?? 0n) -
    (o.warm.fundedTotals[ti] ?? 0n)
  )
}

export type Params = {
  chainId: bigint
  freezeDuration: bigint
  alertTtlConfirmed: bigint
  alertTtlL2: bigint
  coldDelayTight: bigint
  threatTtl: bigint
  backlogAge: bigint // seconds
  backlogMax: bigint
  backlogAlertTtl: bigint
}

// ---------- reconcile (6.1): tightening only, never reads logs (D61) ----------
export function reconcile(
  p: Params,
  anchor: OrgView,
  safe: OrgView,
  safeBlock: bigint,
  anchorTime: bigint,
  expectedConfigHash: Record<string, Hex>,
): { caseId: Hex; actions: Action[] }[] {
  const out: { caseId: Hex; actions: Action[] }[] = []
  anchor.tokens.forEach((token, ti) => {
    const cp = anchor.assets[ti]
    if (!cp?.set) return // first run after a (re)deploy: checkpoint only, no comparison
    const vAnchor = assetValue(anchor, ti)
    const vSafe = assetValue(safe, ti)
    if (vAnchor >= cp.value) return
    const caseId = keccak256(
      encodeAbiParameters(parseAbiParameters('string, bytes32, address, uint64, uint64'), [
        'conservation',
        anchor.orgId,
        token,
        cp.safeBlock,
        safeBlock,
      ]),
    )
    if (vSafe < cp.value) {
      // SAFE also sees the shortfall: confirmed (evidence: org, token, checkpoint block, SAFE block, amount)
      out.push({
        caseId,
        actions: confirmedPack({
          warmVault: anchor.warm.vault,
          hotVault: anchor.hot.vault,
          tokens: [...anchor.tokens],
          blockTime: anchorTime,
          freezeDuration: p.freezeDuration,
          alertTtl: p.alertTtlConfirmed,
          coldDelay: p.coldDelayTight,
          threat: {
            suspect: '0x0000000000000000000000000000000000000000',
            chainId: p.chainId,
            evidenceHash: caseId,
            fingerprintHash: `0x${'0'.repeat(64)}`,
            expiresAt: anchorTime + p.threatTtl,
            parentEvidence: `0x${'0'.repeat(64)}`,
            proof: '0x',
          },
        }),
      })
    } else {
      // only the anchor sees it (could be a reorged top-up): soft tightening, no freeze
      out.push({
        caseId,
        actions: [act.quotaZero(anchor.hot.vault, [...anchor.tokens]), act.alert(2, anchorTime + p.alertTtlL2)],
      })
    }
  })
  // configuration drift -> FREEZE that vault (D37)
  for (const v of [anchor.hot, anchor.warm]) {
    const exp = expectedConfigHash[v.vault.toLowerCase()]
    if (exp && exp.toLowerCase() !== v.configHash.toLowerCase()) {
      const caseId = keccak256(
        encodeAbiParameters(parseAbiParameters('string, address, bytes32'), ['drift', v.vault, v.configHash]),
      )
      out.push({ caseId, actions: [act.freeze(v.vault, anchorTime + p.freezeDuration)] })
    }
  }
  return out
}

/** Native balance drop of a real ops EOA beyond its gas budget -> L2 (it is a real wallet, not a decoy). */
export function opsEoaCheck(
  prev: bigint,
  now: bigint,
  gasBudget: bigint,
  anchorTime: bigint,
  alertTtl: bigint,
): Action[] {
  return prev > now && prev - now > gasBudget ? [act.alert(2, anchorTime + alertTtl)] : []
}

// ---------- backlog (3.1) ----------
/** Requests minus verdicts in minutes older than BACKLOG_AGE (and after the Receiver deploy minute). */
export function backlog(o: OrgView, anchorMinute: bigint, backlogAgeMin: bigint): bigint {
  let total = 0n
  for (const w of o.reqRing) {
    if (w === 0n) continue
    const m = ringMinute(w)
    if (m < o.deployedMinute || m > anchorMinute - backlogAgeMin) continue
    const v = o.verdictRing.find((x) => x !== 0n && ringMinute(x) === m)
    const diff = ringValue(w) - (v ? ringValue(v) : 0n)
    if (diff > 0n) total += diff
  }
  return total
}

// ---------- quota (6.2): loosen only when both LATEST and FINALIZED are clean (D10) ----------
export function isClean(o: OrgView, at: bigint, backlogN: bigint, backlogMax: bigint): boolean {
  if (o.alert >= 4) return false
  if (o.hot.frozenUntil > at || o.warm.frozenUntil > at) return false
  if (backlogN > backlogMax) return false
  for (let ti = 0; ti < o.tokens.length; ti++) {
    const cp = o.assets[ti]
    if (cp?.set && assetValue(o, ti) < cp.value) return false
  }
  return true
}

export function refillActions(
  o: OrgView,
  anchorTime: bigint,
  quotaPeriod: bigint,
  rMax: readonly bigint[],
  halve: readonly boolean[],
): Action[] {
  const epoch = anchorTime / quotaPeriod
  const out: Action[] = []
  o.tokens.forEach((token, ti) => {
    const last = o.hot.lastEpochs[ti] ?? 0n
    if (epoch <= last) return
    let amt = (rMax[ti] ?? 0n) * (epoch - last)
    if (halve[ti]) amt /= 2n // CUSUM alarm: slower refill, never a block (D25)
    const room = (o.hot.caps[ti] ?? 0n) - (o.hot.quotas[ti] ?? 0n)
    if (room <= 0n) return
    if (amt > room) amt = room
    if (amt > 0n) out.push(act.quotaRefill(o.hot.vault, token, epoch, amt))
  })
  return out
}

export function topUpActions(o: OrgView, targets: readonly bigint[]): Action[] {
  return o.tokens.flatMap((token, ti) =>
    (o.hot.balances[ti] ?? 0n) < (targets[ti] ?? 0n) ? [act.topUp(o.warm.vault, o.hot.vault, token, targets[ti]!)] : [],
  )
}

/** ASSET_CHECKPOINT at the SAFE block, every run, only when the contract will accept it (high-water). */
export function checkpointActions(safe: OrgView, safeBlock: bigint): Action[] {
  return safe.tokens.flatMap((token, ti) => {
    const v = assetValue(safe, ti)
    const cp = safe.assets[ti]
    if (cp?.set && (safeBlock <= cp.safeBlock || v < cp.value)) return []
    return [act.assetCheckpoint(safe.orgId, token, safeBlock, v)]
  })
}

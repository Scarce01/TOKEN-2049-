// Pure Trap decision (no CRE calls). Input: the verified Transfer log plus config facts.
import type { Address, Hex } from 'viem'
import {
  type Action,
  amountBucket,
  caseIdTrap,
  confirmedPack,
  evidenceHash,
  FpAction,
  fingerprintHash,
} from '../../../../packages/shared/src/index'

export type DecoyRef = { address: Address; orgId: Hex }

export type TrapFacts = {
  chainId: bigint
  token: Address
  from: Address
  to: Address
  amount: bigint
  txHash: Hex
  logIndex: bigint
  blockTime: bigint
  tokenDecimals: number
  decoyWallets: DecoyRef[]
  decoyAddresses: DecoyRef[]
  vaults: { orgId: Hex; hot: Address; warm: Address }[]
  protectedAddrs: Address[]
  tokens: Address[]
  freezeDuration: bigint
  alertTtl: bigint
  coldDelay: bigint
  threatTtl: bigint
  /** Phase 5: abi.encode(ident, salt, path) proving the decoy wallet was committed in advance. */
  proof?: Hex
}

export type TrapDecision = { kind: 'A' | 'B'; orgId: Hex; caseId: Hex; suspect: Address; actions: Action[] }

const ZERO = '0x0000000000000000000000000000000000000000' as Address
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function decideTrap(f: TrapFacts): TrapDecision | null {
  // transferFrom(anyone, anyone, 0) succeeds without allowance on ERC-20, so a 0 Transfer proves nothing.
  if (f.amount <= 0n) return null
  let kind: 'A' | 'B'
  let orgId: Hex
  let suspect: Address = ZERO

  const wallet = f.decoyWallets.find((d) => eq(d.address, f.from))
  if (wallet) {
    // A: anything leaving a decoy wallet is the attacker (decoys only ever receive).
    kind = 'A'
    orgId = wallet.orgId
    const ours = f.protectedAddrs.some((p) => eq(p, f.to))
    suspect = eq(f.to, ZERO) || ours ? ZERO : f.to
  } else {
    // B: our vault paid a decoy recipient address (someone used the whitelist).
    const dest = f.decoyAddresses.find((d) => eq(d.address, f.to))
    const vault = f.vaults.find((v) => eq(v.hot, f.from) || eq(v.warm, f.from))
    if (!dest || !vault) return null // stranger paying a decoy address: never tighten (D06)
    kind = 'B'
    orgId = vault.orgId
  }

  const v = f.vaults.find((x) => x.orgId.toLowerCase() === orgId.toLowerCase())
  if (!v) return null
  const caseId = caseIdTrap(orgId, f.chainId, f.txHash, f.logIndex)
  const fp = fingerprintHash(f.chainId, f.token, amountBucket(f.amount, f.tokenDecimals), FpAction.PROBE)
  const actions = confirmedPack({
    warmVault: v.warm,
    hotVault: v.hot,
    tokens: f.tokens,
    blockTime: f.blockTime,
    freezeDuration: f.freezeDuration,
    alertTtl: f.alertTtl,
    coldDelay: f.coldDelay,
    threat: {
      suspect,
      chainId: f.chainId,
      evidenceHash: evidenceHash(f.chainId, f.txHash, f.logIndex),
      fingerprintHash: fp,
      expiresAt: f.blockTime + f.threatTtl,
      parentEvidence: `0x${'0'.repeat(64)}`,
      proof: f.proof ?? '0x',
    },
  })
  return { kind, orgId, caseId, suspect, actions }
}

/** The receipt must contain the exact triggering log; otherwise do nothing (D48). */
export function receiptHasLog(
  receiptLogs: { address: Hex; topics: Hex[]; data: Hex; index: number }[],
  log: { address: Hex; topics: Hex[]; data: Hex; index: number },
): boolean {
  return receiptLogs.some(
    (r) =>
      r.index === log.index &&
      eq(r.address, log.address) &&
      r.data.toLowerCase() === log.data.toLowerCase() &&
      r.topics.length === log.topics.length &&
      r.topics.every((t, i) => eq(t, log.topics[i] ?? '')),
  )
}

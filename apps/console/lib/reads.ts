'use client'
// Current state comes from the chain, never the database (D47). One multicall per block (D59).
import { ColdVaultAbi, QuorumReceiverAbi, QuorumVaultAbi, ThreatRegistryAbi } from '@quorum/shared'
import type { Deployment, OrgDeployment } from '@quorum/shared/deployments'
import type { Address, PublicClient } from 'viem'

export type OrgStatus = {
  key: 'a' | 'b'
  org: OrgDeployment
  alert: number
  alertExpiresAt: bigint
  warmFrozenUntil: bigint
  hotFrozenUntil: bigint
  hotQuota: { qUSD: bigint; qETH: bigint }
  hotBal: { qUSD: bigint; qETH: bigint }
  warmBal: { qUSD: bigint; qETH: bigint }
  coldDelay: bigint
  mode: number
  lastPing: string
}

export async function controlStatus(
  c: PublicClient,
  d: Deployment,
  block: bigint,
): Promise<{ orgs: OrgStatus[]; activeConfirmed: bigint }> {
  const orgs = [
    ['a', d.orgA],
    ['b', d.orgB],
  ] as const
  const calls = orgs.flatMap(([, o]) => [
    { address: o.receiver, abi: QuorumReceiverAbi, functionName: 'alert' },
    { address: o.receiver, abi: QuorumReceiverAbi, functionName: 'alertExpiresAt' },
    { address: o.receiver, abi: QuorumReceiverAbi, functionName: 'frozenUntil', args: [o.warmVault] },
    { address: o.receiver, abi: QuorumReceiverAbi, functionName: 'frozenUntil', args: [o.hotVault] },
    { address: o.hotVault, abi: QuorumVaultAbi, functionName: 'quota', args: [d.qUSD] },
    { address: o.hotVault, abi: QuorumVaultAbi, functionName: 'quota', args: [d.qETH] },
    { address: o.hotVault, abi: QuorumVaultAbi, functionName: 'balanceOf', args: [d.qUSD] },
    { address: o.hotVault, abi: QuorumVaultAbi, functionName: 'balanceOf', args: [d.qETH] },
    { address: o.warmVault, abi: QuorumVaultAbi, functionName: 'balanceOf', args: [d.qUSD] },
    { address: o.warmVault, abi: QuorumVaultAbi, functionName: 'balanceOf', args: [d.qETH] },
    { address: o.coldVault, abi: ColdVaultAbi, functionName: 'delay' },
    { address: o.receiver, abi: QuorumReceiverAbi, functionName: 'mode' },
    { address: o.receiver, abi: QuorumReceiverAbi, functionName: 'lastPing' },
  ])
  calls.push({ address: d.threatRegistry, abi: ThreatRegistryAbi, functionName: 'activeConfirmedCount' } as never)
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous multicall
  const r = (await c.multicall({ contracts: calls as any, blockNumber: block, allowFailure: true })).map((x) =>
    x.status === 'success' ? x.result : undefined,
  ) as unknown[]
  const per = 13
  const out = orgs.map(([key, org], i) => {
    const v = r.slice(i * per, (i + 1) * per) as [
      number,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      number,
      string,
    ]
    return {
      key,
      org,
      alert: Number(v[0] ?? 0),
      alertExpiresAt: v[1] ?? 0n,
      warmFrozenUntil: v[2] ?? 0n,
      hotFrozenUntil: v[3] ?? 0n,
      hotQuota: { qUSD: v[4] ?? 0n, qETH: v[5] ?? 0n },
      hotBal: { qUSD: v[6] ?? 0n, qETH: v[7] ?? 0n },
      warmBal: { qUSD: v[8] ?? 0n, qETH: v[9] ?? 0n },
      coldDelay: v[10] ?? 0n,
      mode: Number(v[11] ?? 1),
      lastPing: v[12] ?? '',
    } satisfies OrgStatus
  })
  return { orgs: out, activeConfirmed: (r[r.length - 1] as bigint) ?? 0n }
}

export async function nativeBalances(c: PublicClient, addrs: Address[], block: bigint) {
  return Promise.all(addrs.map((a) => c.getBalance({ address: a, blockNumber: block })))
}

export const ALERT_LABEL = ['Normal', 'L1', 'L2', 'L3', 'CONFIRMED'] as const

export function fmt(v: bigint, decimals: number, digits = 2): string {
  const neg = v < 0n
  const a = neg ? -v : v
  const base = 10n ** BigInt(decimals)
  const whole = a / base
  const frac = (a % base).toString().padStart(decimals, '0').slice(0, digits)
  return `${neg ? '-' : ''}${whole.toLocaleString('en-US')}${digits > 0 ? `.${frac}` : ''}`
}

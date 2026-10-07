'use client'
// Officer wallet: injected provider through viem (sign OfficerAction, submit the queued tx).
import { OfficerActionTypes, officerDomain, sortSigs } from '@quorum/shared'
import type { Deployment } from '@quorum/shared/deployments'
import { type Address, createWalletClient, custom, type Hex } from 'viem'
import { baseSepolia, foundry } from 'viem/chains'
import { api } from './client'

declare global {
  interface Window {
    ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }
  }
}

export async function wallet(d: Deployment) {
  if (!window.ethereum) throw new Error('No injected wallet found')
  const chain = d.chainId === 31337 ? foundry : baseSepolia
  const w = createWalletClient({ chain, transport: custom(window.ethereum) })
  const [account] = await w.requestAddresses()
  if (!account) throw new Error('No account')
  return { w, account, chain }
}

export type Proposal = { target: Address; kind: number; subject: Hex; value: bigint; nonce: bigint; deadline: bigint }

export async function signAndStore(d: Deployment, p: Proposal) {
  const { w, account } = await wallet(d)
  const sig = await w.signTypedData({
    account,
    domain: officerDomain(d.chainId, p.target),
    types: OfficerActionTypes,
    primaryType: 'OfficerAction',
    message: { kind: p.kind, subject: p.subject, value: p.value, nonce: p.nonce, deadline: p.deadline },
  })
  await api('/api/signatures', {
    method: 'POST',
    body: JSON.stringify({
      ...p,
      value: p.value.toString(),
      nonce: p.nonce.toString(),
      deadline: p.deadline.toString(),
      officer: account,
      sig,
    }),
  })
  return sig
}

export type SigRow = {
  target_contract: string
  action_kind: number
  subject: string
  value: string
  nonce: string
  deadline: string
  officer: string
  sig: Hex
}

/** Groups stored signatures by the exact action they sign. */
export function groupProposals(rows: SigRow[]) {
  const m = new Map<string, { p: Proposal; sigs: { signer: Address; sig: Hex }[] }>()
  for (const r of rows) {
    const k = [r.target_contract, r.action_kind, r.subject, r.value, r.nonce, r.deadline].join('|').toLowerCase()
    if (!m.has(k)) {
      m.set(k, {
        p: {
          target: r.target_contract as Address,
          kind: r.action_kind,
          subject: r.subject as Hex,
          value: BigInt(r.value),
          nonce: BigInt(r.nonce),
          deadline: BigInt(r.deadline),
        },
        sigs: [],
      })
    }
    const g = m.get(k)!
    if (!g.sigs.some((s) => s.signer.toLowerCase() === r.officer.toLowerCase()))
      g.sigs.push({ signer: r.officer as Address, sig: r.sig })
  }
  return [...m.values()].map((g) => ({ ...g, sorted: sortSigs(g.sigs) }))
}

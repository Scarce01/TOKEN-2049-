// Fields a stolen admin token can see. Keys stay on this server.
export const ATTACKER_HOT_WALLET_FIELDS = ['label', 'chain', 'address', 'kind', 'status', 'balance'] as const

export type AttackerHotWallet = {
  label: string
  chain: string
  address: string
  kind: string
  status: string
  balance: string
}

/** One probe is 1 qUSD (6 decimals). The signing route refuses anything else. */
export const PROBE_AMOUNT = 1_000_000n

export function parseProbeBody(body: unknown): { address: string; to: string; amount: bigint } {
  if (!body || typeof body !== 'object') throw new Error('body')
  const rec = body as Record<string, unknown>
  const address = rec.address
  const to = rec.to
  const amount = rec.amount
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('address')
  if (typeof to !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error('to')
  if (amount !== PROBE_AMOUNT.toString()) throw new Error('amount')
  return { address, to, amount: PROBE_AMOUNT }
}

/** Copies only the attacker-visible fields, in a fixed order. */
export function toAttackerHotWallet(row: AttackerHotWallet): AttackerHotWallet {
  return {
    label: row.label,
    chain: row.chain,
    address: row.address,
    kind: row.kind,
    status: row.status,
    balance: row.balance,
  }
}

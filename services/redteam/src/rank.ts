// Deterministic ranking from attacker-visible fields only. No model.

export type VisibleWallet = {
  label: string
  chain: string
  address: string
  kind: string
  status: string
  balance: string
}

export type RankedWallet = {
  rank: number
  address: string
  label: string
  kind: string
  balance: string
  reason: string
}

/** 1 qUSD in 6-decimal base units. EOAs below this are ignored. */
export const MIN_QUSD_BASE = 1_000_000n

const REASON = 'eoa with qUSD balance at or above 1, highest balance first'

export function rankWallets(wallets: readonly VisibleWallet[]): RankedWallet[] {
  const eligible = wallets.filter((w) => w.kind === 'eoa' && BigInt(w.balance) >= MIN_QUSD_BASE)
  const sorted = [...eligible].sort((a, b) => {
    const diff = BigInt(b.balance) - BigInt(a.balance)
    if (diff > 0n) return 1
    if (diff < 0n) return -1
    const aa = a.address.toLowerCase()
    const bb = b.address.toLowerCase()
    if (aa < bb) return -1
    if (aa > bb) return 1
    return 0
  })
  return sorted.map((w, i) => ({
    rank: i + 1,
    address: w.address,
    label: w.label,
    kind: w.kind,
    balance: w.balance,
    reason: REASON,
  }))
}

/** The wallet the attacker spends. This is rank 1, not a caller-supplied address. */
export function selectTarget(wallets: readonly VisibleWallet[]): VisibleWallet {
  const top = rankWallets(wallets)[0]
  if (!top) throw new Error('no eligible eoa')
  const wallet = wallets.find((w) => w.address.toLowerCase() === top.address.toLowerCase())
  if (!wallet) throw new Error('selected wallet missing from the list')
  return wallet
}

export function formatRanking(ranked: readonly RankedWallet[], limit = 5): string {
  const lines = ['Attacker targets:', '']
  for (const row of ranked.slice(0, limit)) {
    lines.push(`#${row.rank} ${row.address} kind=${row.kind} balance=${row.balance} reason=${row.reason}`)
  }
  if (ranked.length === 0) lines.push('(none)')
  return lines.join('\n')
}

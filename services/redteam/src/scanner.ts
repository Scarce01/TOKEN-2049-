// Reads the compromised exchange API and ranks wallets. Nothing else.

import { assertLocalExchange } from './guard'
import { formatRanking, rankWallets, selectTarget, type VisibleWallet } from './rank'

export const VISIBLE_FIELDS = ['label', 'chain', 'address', 'kind', 'status', 'balance'] as const

const FIELD_SET = new Set<string>(VISIBLE_FIELDS)

export function parseVisibleWallet(row: unknown): VisibleWallet {
  if (!row || typeof row !== 'object') throw new Error('wallet row is not an object')
  const rec = row as Record<string, unknown>
  for (const key of Object.keys(rec)) {
    if (!FIELD_SET.has(key)) throw new Error(`unexpected wallet field ${key}`)
  }
  const label = needString(rec.label, 'label')
  const chain = needString(rec.chain, 'chain')
  const address = needString(rec.address, 'address')
  const kind = needString(rec.kind, 'kind')
  const status = needString(rec.status, 'status')
  const balance = needString(rec.balance, 'balance')
  if (!/^\d+$/.test(balance)) throw new Error('balance is not a base-unit integer')
  return { label, chain, address, kind, status, balance }
}

function needString(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`${name} is missing`)
  return v
}

export async function fetchHotWallets(baseUrl: string, adminToken: string): Promise<VisibleWallet[]> {
  const url = assertLocalExchange(baseUrl)
  const res = await fetch(new URL('/admin/hot-wallets', url), {
    headers: { authorization: `Bearer ${adminToken}` },
  })
  if (!res.ok) throw new Error(`hot-wallets http ${res.status}`)
  const body: unknown = await res.json()
  if (!Array.isArray(body)) throw new Error('hot-wallets response is not a list')
  return body.map(parseVisibleWallet)
}

export async function scan(baseUrl: string, adminToken: string): Promise<string> {
  const { ranked, wallets } = await loadRanked(baseUrl, adminToken)
  const header = [
    `wallets=${wallets.length}`,
    `fields=${VISIBLE_FIELDS.join(',')}`,
    `eligible=${ranked.length}`,
    '',
  ].join('\n')
  return header + formatRanking(ranked)
}

/** Rank 1 from the exchange list. Callers do not pass an address. */
export async function select(baseUrl: string, adminToken: string): Promise<VisibleWallet> {
  return (await loadRanked(baseUrl, adminToken)).target
}

async function loadRanked(baseUrl: string, adminToken: string) {
  const wallets = await fetchHotWallets(baseUrl, adminToken)
  const ranked = rankWallets(wallets)
  return { wallets, ranked, target: selectTarget(wallets) }
}

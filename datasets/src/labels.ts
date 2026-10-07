// One label generator for real and decoy rows alike, so a label never says which is which (rule 2).
// Which rows are decoys lives only in secrets/decoys.local.json and quorum_index.traps.
import { randomInt } from 'node:crypto'

export const HOT_PREFIXES = ['hot-legacy', 'hot-reserve', 'ops-sweeper'] as const
export const WHITELIST_PREFIXES = ['settlement-partner', 'otc-desk', 'market-maker', 'treasury-rebalance'] as const

/** `prefix-NN` from a random prefix, not in `taken` (mutated). */
export function randomLabel(prefixes: readonly string[], taken: Set<string>): string {
  for (;;) {
    const l = `${prefixes[randomInt(prefixes.length)]}-${String(randomInt(1, 100)).padStart(2, '0')}`
    if (!taken.has(l)) {
      taken.add(l)
      return l
    }
  }
}

/** Fisher-Yates with a CSPRNG: insert order (identity ids) must not group decoys. */
export function shuffle<T>(xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

type Sql = ReturnType<typeof import('@quorum/offchain').db>

export async function takenLabels(sql: Sql, schema: string): Promise<Set<string>> {
  const hw = await sql`select label from ${sql(`${schema}.hot_wallets`)}`
  const wl = await sql`select label from ${sql(`${schema}.whitelist_addresses`)}`
  return new Set([...hw, ...wl].map((r) => r.label as string))
}

/**
 * Adds rows to whitelist_addresses and rewrites the whole table in shuffled order, so identity ids
 * (and physical order) never put decoys after the real rows. Nothing references whitelist ids.
 */
export async function rewriteWhitelist(sql: Sql, schema: string, add: { label: string; address: string }[]) {
  const t = sql(`${schema}.whitelist_addresses`)
  await sql.begin(async (tx) => {
    const cur = await tx`select label, address, chain from ${t}`
    const have = new Set(cur.map((r) => (r.address as string).toLowerCase()))
    const rows = [
      ...cur.map((r) => ({ label: r.label as string, address: r.address as string, chain: r.chain as string })),
      ...add.filter((a) => !have.has(a.address.toLowerCase())).map((a) => ({ ...a, chain: 'base-sepolia' })),
    ]
    await tx`delete from ${t}`
    for (const r of shuffle(rows))
      await tx`insert into ${t} (label, address, chain) values (${r.label}, ${r.address}, ${r.chain})`
  })
}

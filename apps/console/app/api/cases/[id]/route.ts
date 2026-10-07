import { json, requireOfficer, sql } from '@/lib/server'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const o = await requireOfficer(req)
  if (o instanceof Response) return o
  const { id } = await ctx.params
  const [c] = await sql()`select * from ponder_quorum.cases where case_id = ${id}`
  const events = await sql()`select block_number, block_time, tx_hash, log_index, contract, contract_name, event, args
                             from ponder_quorum.chain_events where case_id = ${id} order by block_number, log_index`
  const trap = await sql()`select label, kind, tripped_tx, tripped_at from quorum_index.traps where case_id = ${id}`
  return json({ case: c ?? null, events, trap: trap[0] ?? null })
}

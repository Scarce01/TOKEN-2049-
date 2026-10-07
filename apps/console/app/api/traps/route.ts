import { json, requireOfficer, sql } from '@/lib/server'

export async function GET(req: Request) {
  const o = await requireOfficer(req)
  if (o instanceof Response) return o
  return json(
    await sql()`select id, org_id, label, kind, chain, ref, status, last_checked, tripped_at, tripped_tx, case_id
                         from quorum_index.traps order by org_id, kind, label`,
  )
}

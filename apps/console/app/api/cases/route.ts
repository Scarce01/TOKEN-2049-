import { json, requireOfficer, sql } from '@/lib/server'

export async function GET(req: Request) {
  const o = await requireOfficer(req)
  if (o instanceof Response) return o
  return json(
    await sql()`select case_id, org_id, kind, request_id, tx_hash, decision, public_reason, first_seen, updated_at
                         from ponder_quorum.cases order by updated_at desc limit 200`,
  )
}

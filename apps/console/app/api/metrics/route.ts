import { json, requireOfficer, sql } from '@/lib/server'

export async function GET(req: Request) {
  const o = await requireOfficer(req)
  if (o instanceof Response) return o
  return json(
    await sql()`select distinct on (name) name, value, unit, source, notes, run_id, created_at
                         from quorum_index.metrics order by name, created_at desc`,
  )
}

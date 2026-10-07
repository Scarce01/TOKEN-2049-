import { json, requireOfficer, sql } from '@/lib/server'

/** Recent events of interest (Tightened, ThreatAdded, verdicts, queued officer actions). */
export async function GET(req: Request) {
  const o = await requireOfficer(req)
  if (o instanceof Response) return o
  const since = new URL(req.url).searchParams.get('since') ?? '0'
  return json(
    await sql()`select block_number, block_time, tx_hash, log_index, contract, contract_name, event, case_id, args
                         from ponder_quorum.chain_events
                         where block_number > ${since}
                           and event in ('Tightened','ThreatAdded','VerdictRecorded','VerdictDowngraded','ManualQueued',
                                         'ManualExecuted','QueuedCancelled','KeyRegistrationQueued','ConfigQueued','FreezeSet','AlertSet','Ping','ActionFailed')
                         order by block_number desc, log_index desc limit 100`,
  )
}

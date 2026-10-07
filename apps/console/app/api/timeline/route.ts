import { json, requireOfficer, sql } from '@/lib/server'

/**
 * Timeline for one suspect address (D43). First point: the trap's tripped_tx (the attacker's test
 * transfer, marked here). Then every indexed event of the cases that touched this suspect, in order.
 */
export async function GET(req: Request) {
  const o = await requireOfficer(req)
  if (o instanceof Response) return o
  const suspect = (new URL(req.url).searchParams.get('suspect') ?? '').toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(suspect)) return json({ error: 'suspect address required' }, 400)
  const db = sql()
  const threat = await db`select case_id, block_time from ponder_quorum.chain_events
                          where event = 'ThreatAdded' and lower(args->>'suspect') = ${suspect} order by block_number`
  const reqs = await db`select case_id from ponder_quorum.chain_events
                        where event = 'WithdrawalRequested' and lower(args->'request'->>'to') = ${suspect}`
  const tightenedCases = threat.map((t) => t.case_id).filter(Boolean)
  // the ThreatAdded row itself has no case id; take the case of the Tightened events in the same tx
  const sameTx = await db`select distinct e2.case_id from ponder_quorum.chain_events e1
                          join ponder_quorum.chain_events e2 on e2.tx_hash = e1.tx_hash and e2.case_id is not null
                          where e1.event = 'ThreatAdded' and lower(e1.args->>'suspect') = ${suspect}`
  const caseIds = [...new Set([...tightenedCases, ...sameTx.map((r) => r.case_id), ...reqs.map((r) => r.case_id)])]
  const trap = caseIds.length
    ? await db`select label, kind, tripped_tx, tripped_at, case_id from quorum_index.traps where case_id = any(${caseIds}) order by tripped_at`
    : []
  const events = caseIds.length
    ? await db`select block_number, block_time, tx_hash, contract_name, event, case_id, args
               from ponder_quorum.chain_events where case_id = any(${caseIds}) order by block_number, log_index`
    : []
  const points = [
    ...trap.map((t) => ({
      at: t.tripped_at ? Math.floor(new Date(t.tripped_at).getTime() / 1000) : 0,
      kind: 'test transfer (marked here)',
      tx: t.tripped_tx,
      caseId: t.case_id,
      label: t.label,
    })),
    ...events.map((e) => ({
      at: Number(e.block_time),
      kind: e.event,
      tx: e.tx_hash,
      caseId: e.case_id,
      label: e.contract_name,
    })),
  ]
  return json({ suspect, points })
}

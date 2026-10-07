import { requireOfficer, sql } from '@/lib/server'

/** Server-sent events: one push per new indexed block (no Supabase Realtime on chain tables). */
export async function GET(req: Request) {
  const o = await requireOfficer(req)
  if (o instanceof Response) return o
  let last = BigInt(
    (await sql()`select coalesce(max(block_number), 0) as b from ponder_quorum.chain_events`)[0]?.b ?? 0,
  )
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(ctrl) {
      const timer = setInterval(async () => {
        try {
          const rows =
            await sql()`select block_number, block_time, tx_hash, log_index, contract_name, event, case_id, args
                                   from ponder_quorum.chain_events where block_number > ${last.toString()} order by block_number, log_index`
          if (rows.length) {
            last = BigInt(rows[rows.length - 1]!.block_number)
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify(rows)}\n\n`))
          }
        } catch {}
      }, 2000)
      req.signal.addEventListener('abort', () => {
        clearInterval(timer)
        ctrl.close()
      })
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
}

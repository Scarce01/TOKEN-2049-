// Outbox workers: submit -> wait for verdict -> execute. Cosign decides; this only forwards.
import { caseIdWithdrawal, Decision, displayCase, NATIVE } from '@quorum/shared'
import type { Address, Hex } from 'viem'
import { abis, pub, revertName, writeAndWait, wsPub } from './chain'
import { sql, T } from './db'
import { deployment, ORG_ID, org } from './env'

type Row = {
  id: string
  user_id: string
  user_id_hash: string
  token: string
  to_address: string
  amount: string
  nonce: string
  deadline: string
  request_id: string
  tx_hash: string
  vault: string
  status: string
  intent: Record<string, string>
  user_sig: string
  last_sent_at: Date | null
}

const ZERO_SAFE = { to: NATIVE, value: 0n, data: '0x' as Hex, operation: 0 }

export function toRequest(r: Row, kind = 0, safeTx = ZERO_SAFE) {
  return {
    requestId: r.request_id as Hex,
    orgId: ORG_ID,
    userIdHash: r.user_id_hash as Hex,
    kind,
    vault: r.vault as Address,
    token: r.token as Address,
    to: r.to_address as Address,
    amount: BigInt(r.amount),
    nonce: BigInt(r.nonce),
    deadline: BigInt(r.deadline),
    txHash: r.tx_hash as Hex,
    safeTx,
  }
}

export function toIntent(r: Row) {
  const i = r.intent
  return {
    orgId: i.orgId as Hex,
    userIdHash: i.userIdHash as Hex,
    vault: i.vault as Address,
    token: i.token as Address,
    to: i.to as Address,
    amount: BigInt(i.amount!),
    nonce: BigInt(i.nonce!),
    deadline: BigInt(i.deadline!),
  }
}

function backoff(attempts: number): string {
  return `${Math.min(60, 2 ** attempts)} seconds`
}

/** Claims one created row whose user has nothing in flight (one request per user at a time). */
async function claimNext(): Promise<Row | undefined> {
  return sql.begin(async (tx) => {
    const rows = await tx<Row[]>`
      select * from ${T('withdrawals')} w
      where w.status = 'created' and w.next_attempt_at <= now()
        and not exists (select 1 from ${T('withdrawals')} o where o.user_id_hash = w.user_id_hash and o.status = 'submitted')
      order by w.created_at limit 1 for update skip locked`
    return rows[0]
  })
}

export async function submitOnce(): Promise<boolean> {
  const r = await claimNext()
  if (!r) return false
  try {
    const hash = await writeAndWait({
      address: deployment.requestBoard,
      abi: abis.RequestBoardAbi,
      functionName: 'submit',
      args: [toRequest(r), toIntent(r), r.user_sig as Hex],
    })
    await sql`update ${T('withdrawals')} set status = 'submitted', submit_tx = ${hash}, last_sent_at = now(), updated_at = now() where id = ${r.id}`
  } catch (e) {
    const name = revertName(e)
    if (name === 'RequestIdUsed') {
      await sql`update ${T('withdrawals')} set status = 'submitted', last_sent_at = now() where id = ${r.id}`
    } else {
      // SubmitRateLimited and transient errors: exponential backoff.
      await sql`update ${T('withdrawals')} set attempts = attempts + 1, last_error = ${name ?? String(e).slice(0, 200)},
                next_attempt_at = now() + ${backoff(1)}::interval where id = ${r.id}`
    }
  }
  return true
}

type ChainVerdict = { decision: number; used: boolean; expiresAt: bigint }

async function readVerdict(txHash: Hex): Promise<ChainVerdict> {
  return (await pub.readContract({
    address: org.receiver,
    abi: abis.QuorumReceiverAbi,
    functionName: 'verdictOf',
    args: [txHash],
  })) as unknown as ChainVerdict
}

export async function applyVerdict(r: Row): Promise<void> {
  const v = await readVerdict(r.tx_hash as Hex)
  if (v.decision === Decision.NONE) return
  const caseDisplay = displayCase(caseIdWithdrawal(ORG_ID, r.request_id as Hex))
  if (v.decision === Decision.REJECT) {
    await sql`update ${T('withdrawals')} set status = 'rejected', case_display = ${caseDisplay}, updated_at = now() where id = ${r.id}`
    return
  }
  if (v.decision === Decision.PENDING) {
    await sql`update ${T('withdrawals')} set status = 'pending', case_display = ${caseDisplay}, updated_at = now() where id = ${r.id}`
    return
  }
  await sql`update ${T('withdrawals')} set status = 'approved', case_display = ${caseDisplay}, updated_at = now() where id = ${r.id}`
  await executeRow(r)
}

export async function executeRow(r: Row): Promise<void> {
  try {
    const hash = await writeAndWait({
      address: r.vault as Address,
      abi: abis.QuorumVaultAbi,
      functionName: 'execute',
      args: [
        {
          requestId: r.request_id as Hex,
          userIdHash: r.user_id_hash as Hex,
          token: r.token as Address,
          to: r.to_address as Address,
          amount: BigInt(r.amount),
          nonce: BigInt(r.nonce),
          deadline: BigInt(r.deadline),
        },
      ],
    })
    await sql`update ${T('withdrawals')} set status = 'executed', execute_tx = ${hash}, updated_at = now() where id = ${r.id}`
  } catch (e) {
    const name = revertName(e)
    const err = name ?? String(e).slice(0, 200)
    if (name && WAIT.has(name)) {
      // not yet payable (delay, hold, budget, freeze): stay approved and try again; the Quorum keeper may pay first
      await sql`update ${T('withdrawals')} set last_error = ${err}, next_attempt_at = now() + interval '60 seconds', updated_at = now() where id = ${r.id}`
    } else if (name === 'AlreadyPaid') {
      await sql`update ${T('withdrawals')} set status = 'executed', last_error = 'paid by keeper', updated_at = now() where id = ${r.id}`
    } else {
      await sql`update ${T('withdrawals')} set status = 'failed', last_error = ${err}, updated_at = now() where id = ${r.id}`
    }
  }
}

/** Reverts that mean "not yet", not "never" (docs/47 3.1). Delayed approvals used to end as failed here. */
const WAIT = new Set(['NotYetValid', 'Held', 'QuotaExceeded', 'WindowExceeded', 'Frozen', 'AlertConfirmed'])

export async function retryApproved(): Promise<void> {
  const rows = await sql<Row[]>`
    select * from ${T('withdrawals')} where status = 'approved' and next_attempt_at <= now() order by created_at limit 50`
  for (const r of rows) await executeRow(r)
}

/** Subscribe to VerdictRecorded (no polling); a sweep catches anything missed while disconnected. */
export function watchVerdicts(): () => void {
  return wsPub.watchContractEvent({
    address: org.receiver,
    abi: abis.QuorumReceiverAbi,
    eventName: 'VerdictRecorded',
    onLogs: async (logs) => {
      for (const l of logs) {
        const txHash = (l as unknown as { args: { txHash: Hex } }).args.txHash
        const rows = await sql<
          Row[]
        >`select * from ${T('withdrawals')} where tx_hash = ${txHash} and status = 'submitted'`
        for (const r of rows) await applyVerdict(r)
      }
    },
  })
}

export async function sweepSubmitted(): Promise<void> {
  const rows = await sql<
    Row[]
  >`select * from ${T('withdrawals')} where status = 'submitted' order by created_at limit 50`
  for (const r of rows) await applyVerdict(r)
}

/** No verdict after RESUBMIT_AFTER (dropped event or ScoreConflict): resend the same content. */
export async function resubmitStale(resubmitAfterSec = 120): Promise<void> {
  const rows = await sql<Row[]>`
    select * from ${T('withdrawals')}
    where status = 'submitted' and last_sent_at < now() - make_interval(secs => ${resubmitAfterSec})`
  for (const r of rows) {
    const v = await readVerdict(r.tx_hash as Hex)
    if (v.decision !== Decision.NONE) {
      await applyVerdict(r)
      continue
    }
    try {
      await writeAndWait({
        address: deployment.requestBoard,
        abi: abis.RequestBoardAbi,
        functionName: 'resubmit',
        args: [toRequest(r), toIntent(r), r.user_sig as Hex],
      })
      await sql`update ${T('withdrawals')} set last_sent_at = now() where id = ${r.id}`
    } catch (e) {
      await sql`update ${T('withdrawals')} set last_error = ${revertName(e) ?? String(e).slice(0, 200)} where id = ${r.id}`
    }
  }
}

export function startWorkers(): void {
  const loop = async () => {
    while (true) {
      const did = await submitOnce().catch((e) => {
        console.error('submit worker', e)
        return false
      })
      if (!did) await Bun.sleep(1000)
    }
  }
  void loop()
  watchVerdicts()
  setInterval(() => void sweepSubmitted().catch((e) => console.error('sweep', e)), 15_000)
  setInterval(() => void resubmitStale().catch((e) => console.error('resubmit', e)), 60_000)
  setInterval(() => void retryApproved().catch((e) => console.error('retry', e)), 30_000)
}

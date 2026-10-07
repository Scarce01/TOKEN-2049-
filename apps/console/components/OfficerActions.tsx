'use client'
// Propose / co-sign / submit officer actions. Two signatures for everything except CANCEL_QUEUED (one).
import { OfficerDeskAbi, OfficerKind } from '@quorum/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { type Address, type Hex, pad } from 'viem'
import { useApi, useDeployment } from '@/lib/client'
import { groupProposals, type Proposal, type SigRow, signAndStore, wallet } from '@/lib/wallet'

const NAME: Record<number, string> = {
  1: 'Extend freeze',
  2: 'Manual approve',
  3: 'Lower alert',
  4: 'Cold queue',
  5: 'Lower cold delay',
  6: 'Cancel queued',
  7: 'Config change',
  8: 'Planned op',
  9: 'Reset asset checkpoint',
  10: 'Hold withdrawal',
  11: 'Cancel withdrawal',
}

/** Submits the on-chain call for a proposal that has enough signatures. */
async function submit(d: ReturnType<typeof useDeployment>, desk: Address, p: Proposal, sigs: Hex[]) {
  const { w, account } = await wallet(d)
  const common = { account, address: desk, abi: OfficerDeskAbi } as const
  if (p.kind === OfficerKind.EXTEND_FREEZE) {
    const vault = `0x${p.subject.slice(26)}` as Address
    return w.writeContract({
      ...common,
      functionName: 'extendFreeze',
      args: [vault, p.value, p.nonce, p.deadline, sigs],
    })
  }
  if (p.kind === OfficerKind.MANUAL_APPROVE) {
    return w.writeContract({ ...common, functionName: 'queueManual', args: [p.subject, p.nonce, p.deadline, sigs] })
  }
  if (p.kind === OfficerKind.LOWER_ALERT) {
    return w.writeContract({
      ...common,
      functionName: 'queueLowerAlert',
      args: [Number(p.value), p.nonce, p.deadline, sigs],
    })
  }
  if (p.kind === OfficerKind.CANCEL_QUEUED) {
    return w.writeContract({ ...common, functionName: 'cancelQueued', args: [p.subject, p.nonce, p.deadline, sigs] })
  }
  throw new Error('submit for this kind is done from its own page')
}

export function OfficerActions(props: { desk: Address; warmVault: Address; txHash?: Hex; orgId: Hex }) {
  const d = useDeployment()
  const qc = useQueryClient()
  const sigs = useApi<SigRow[]>('/api/signatures', 5000)
  const [msg, setMsg] = useState('')
  const now = BigInt(Math.floor(Date.now() / 1000))

  const propose = async (kind: number, subject: Hex, value: bigint) => {
    setMsg('')
    try {
      await signAndStore(d, {
        target: props.desk,
        kind,
        subject,
        value,
        nonce: BigInt(Date.now()),
        deadline: now + 3600n,
      })
      await qc.invalidateQueries({ queryKey: ['api', '/api/signatures'] })
      setMsg('Signature stored. A second officer must co-sign.')
    } catch (e) {
      setMsg(String((e as Error).message))
    }
  }

  const mine = groupProposals(
    (sigs.data ?? []).filter((r) => r.target_contract.toLowerCase() === props.desk.toLowerCase()),
  )
  return (
    <div className="card">
      <div className="label mb-2">Officer actions</div>
      <div className="flex flex-wrap gap-2">
        {props.txHash ? (
          <button type="button" className="btn" onClick={() => propose(OfficerKind.MANUAL_APPROVE, props.txHash!, 0n)}>
            Approve manually (2 of 3, then {Math.round(600 / 60)} min queue)
          </button>
        ) : null}
        <button
          type="button"
          className="btn"
          onClick={() => propose(OfficerKind.EXTEND_FREEZE, pad(props.warmVault, { size: 32 }), now + 6n * 3600n)}
        >
          Extend warm freeze +6h (2 of 3)
        </button>
        <button type="button" className="btn" onClick={() => propose(OfficerKind.LOWER_ALERT, props.orgId, 0n)}>
          Lower alert to normal (2 of 3, queued)
        </button>
      </div>
      {msg ? <div className="mt-2 text-xs text-muted">{msg}</div> : null}
      <table className="grid mt-3">
        <thead>
          <tr>
            <th>Action</th>
            <th>Subject</th>
            <th>Signatures</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {mine.map((g) => {
            const need = g.p.kind === OfficerKind.CANCEL_QUEUED ? 1 : 2
            return (
              <tr key={`${g.p.kind}-${g.p.subject}-${g.p.nonce}`}>
                <td>{NAME[g.p.kind]}</td>
                <td className="mono">{g.p.subject.slice(0, 14)}</td>
                <td>
                  {g.sigs.length}/{need}
                </td>
                <td className="flex gap-2">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => signAndStore(d, g.p).then(() => qc.invalidateQueries())}
                  >
                    Co-sign
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={g.sigs.length < need}
                    onClick={() =>
                      submit(d, props.desk, g.p, g.sorted)
                        .then((h) => setMsg(`submitted ${h}`))
                        .catch((e) => setMsg(String(e.message)))
                    }
                  >
                    Submit
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

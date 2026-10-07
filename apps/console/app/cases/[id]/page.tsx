'use client'
// Incident / case page: what happened, what the system already did (read from state), what to sign.
import {
  DepositVaultAbi,
  decodeReason,
  KeyRegistryAbi,
  Kind,
  QuorumReceiverAbi,
  ThreatRegistryAbi,
  unseal,
} from '@quorum/shared'
import { use, useState } from 'react'
import type { Address, Hex } from 'viem'
import { OfficerActions } from '@/components/OfficerActions'
import { displayCaseOf, explorerTx, pub, short, useApi, useChain, useDeployment, useMask } from '@/lib/client'

type Ev = {
  block_number: string
  block_time: string
  tx_hash: string
  contract: string
  contract_name: string
  event: string
  args: Record<string, unknown>
}
type Detail = {
  case: {
    case_id: string
    kind: string
    decision: number | null
    sealed_reason: string | null
    tx_hash: string | null
    request_id: string | null
  } | null
  events: Ev[]
  trap: { label: string; kind: string; tripped_tx: string; tripped_at: string } | null
}
type Req = {
  requestId: Hex
  orgId: Hex
  userIdHash: Hex
  kind: number
  vault: Address
  token: Address
  to: Address
  amount: string
  nonce: string
  deadline: string
  txHash: Hex
  safeTx: { operation: number }
}
type Intent = Omit<Req, 'requestId' | 'kind' | 'txHash' | 'safeTx'>

const KIND_NAME: Record<number, string> = {
  [Kind.FREEZE]: 'Warm vault frozen',
  [Kind.QUOTA_ZERO]: 'Hot quota zeroed',
  [Kind.SWEEP]: 'Hot balance swept to cold',
  [Kind.ALERT]: 'Alert raised',
  [Kind.COLD_DELAY]: 'Cold timelock extended',
  [Kind.THREAT]: 'Suspect added to shared list',
}
const REASON: Record<number, string> = {
  11: 'Gate 1: txHash mismatch',
  21: 'Gate 2: Safe transaction or unsupported operation',
  22: 'Gate 2: token not allowed',
  23: 'Gate 2: vault not in this org',
  31: 'Gate 3: signer is not the registered key',
  32: 'Gate 3: fields differ from the signed intent',
  33: 'Gate 3: expired',
  41: 'Gate 4: decoy account',
  42: 'Gate 4: recipient on shared list',
  43: 'Gate 4: recipient is a decoy address',
  44: 'Gate 4: network fingerprint (signal only)',
  51: 'Gate 5: over deposit',
  61: 'Gate 6: data sources disagree',
  62: 'Gate 6: stale price',
  71: 'Gate 7: over hidden cap',
  72: 'Gate 7: hugging the fake threshold',
}

function Row(props: { label: string; backend?: string; user?: string; chain?: string }) {
  const diff = (a?: string, b?: string) => a !== undefined && b !== undefined && a.toLowerCase() !== b.toLowerCase()
  const bad = diff(props.backend, props.user) || diff(props.user, props.chain)
  return (
    <tr>
      <td className="text-muted">{props.label}</td>
      <td className={`mono ${bad ? 'diff' : ''}`}>{props.backend ?? ''}</td>
      <td className={`mono ${bad ? 'diff' : ''}`}>{props.user ?? ''}</td>
      <td className={`mono ${bad ? 'diff' : ''}`}>{props.chain ?? ''}</td>
    </tr>
  )
}

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const d = useDeployment()
  const mask = useMask()
  const detail = useApi<Detail>(`/api/cases/${id}`, 5000)
  const [sealKey, setSealKey] = useState('')
  const [sealIdx, setSealIdx] = useState(0)

  const evs = detail.data?.events ?? []
  const reqEv = evs.find((e) => e.event === 'WithdrawalRequested')
  const verdictEv = evs.find((e) => e.event === 'VerdictRecorded')
  const downgrade = evs.find((e) => e.event === 'VerdictDowngraded')
  const tightened = evs.filter((e) => e.event === 'Tightened')
  const req = reqEv?.args.request as Req | undefined
  const intent = reqEv?.args.intent as Intent | undefined
  const signer = reqEv?.args.signer as string | undefined
  const receiver = (verdictEv?.contract ?? tightened[0]?.contract) as Address | undefined
  const org = req && req.orgId.toLowerCase() === d.orgB.orgId.toLowerCase() ? d.orgB : d.orgA

  // Chain facts at the request block (not the backend's word)
  const facts = useChain(['facts', id, reqEv?.block_number], async () => {
    if (!req || !reqEv) return null
    const c = pub(d)
    const at = BigInt(reqEv.block_number)
    const [key, deposited, approved, suspect] = await Promise.all([
      c.readContract({
        address: d.keyRegistry,
        abi: KeyRegistryAbi,
        functionName: 'keyOf',
        args: [req.userIdHash],
        blockNumber: at,
      }),
      c.readContract({
        address: d.depositVault,
        abi: DepositVaultAbi,
        functionName: 'depositedOf',
        args: [req.userIdHash, req.token],
        blockNumber: at,
      }),
      c.readContract({
        address: org.receiver,
        abi: QuorumReceiverAbi,
        functionName: 'approvedOf',
        args: [req.userIdHash, req.token],
        blockNumber: at,
      }),
      c.readContract({
        address: d.threatRegistry,
        abi: ThreatRegistryAbi,
        functionName: 'isSuspect',
        args: [req.to],
        blockNumber: at,
      }),
    ])
    return {
      key: key as string,
      deposited: (deposited as bigint).toString(),
      approved: (approved as bigint).toString(),
      suspect: suspect as boolean,
    }
  })

  let unsealed = ''
  const sealed = verdictEv?.args.sealedReason as Hex | undefined
  if (sealed && sealKey.length === 66) {
    try {
      const r = decodeReason(unseal(sealed, sealIdx, sealKey as Hex))
      unsealed =
        r.codes.map((c) => REASON[c] ?? String(c)).join('; ') +
        (r.lambda ? ` | lambda ${JSON.stringify(r.lambda)}` : '')
    } catch {
      unsealed = 'cannot unseal with this key / index'
    }
  }

  const DEC = ['', 'APPROVE', 'REJECT', 'PENDING']
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="text-xl font-semibold mono">{displayCaseOf(id as Hex)}</div>
        <span className="text-muted">{detail.data?.case?.kind}</span>
        {verdictEv ? <span className="badge">{DEC[Number(verdictEv.args.decision)]}</span> : null}
        {downgrade ? <span className="badge lv-2">contract downgraded ({String(downgrade.args.reason)})</span> : null}
      </div>

      {detail.data?.trap ? (
        <div className="card">
          <div className="label">Evidence</div>
          <div>
            Trap <b>{mask(detail.data.trap.label)}</b> ({detail.data.trap.kind}) touched by{' '}
            <a
              className="mono text-accent"
              href={explorerTx(d, detail.data.trap.tripped_tx)}
              target="_blank"
              rel="noreferrer"
            >
              {short(detail.data.trap.tripped_tx)}
            </a>
          </div>
        </div>
      ) : null}

      {tightened.length ? (
        <div className="card">
          <div className="label mb-1">Done automatically on-chain (no backend involved)</div>
          <ul>
            {tightened.map((t) => (
              <li key={`${t.tx_hash}-${String(t.args.kind)}`}>
                ✓ {KIND_NAME[Number(t.args.kind)] ?? `kind ${String(t.args.kind)}`}{' '}
                <a className="mono text-accent" href={explorerTx(d, t.tx_hash)} target="_blank" rel="noreferrer">
                  {short(t.tx_hash)}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-1 text-xs text-muted">
            Current freeze, quota and alert values are on Control status (read from the chain).
          </div>
        </div>
      ) : null}

      {req && intent ? (
        <div className="card">
          <div className="label mb-2">Three-way comparison</div>
          <table className="grid">
            <thead>
              <tr>
                <th>Field</th>
                <th>Backend says</th>
                <th>User signed</th>
                <th>Chain facts</th>
              </tr>
            </thead>
            <tbody>
              <Row label="Org" backend={req.orgId} user={intent.orgId} />
              <Row label="User" backend={req.userIdHash} user={intent.userIdHash} />
              <Row label="Vault" backend={req.vault} user={intent.vault} />
              <Row label="Token" backend={req.token} user={intent.token} />
              <Row
                label="To"
                backend={req.to}
                user={intent.to}
                chain={facts.data ? (facts.data.suspect ? `${req.to} (on shared list)` : req.to) : undefined}
              />
              <Row label="Amount" backend={String(req.amount)} user={String(intent.amount)} />
              <Row label="Nonce" backend={String(req.nonce)} user={String(intent.nonce)} />
              <Row label="Deadline" backend={String(req.deadline)} user={String(intent.deadline)} />
              <Row label="Signer / key" user={signer} chain={facts.data?.key} />
              <Row
                label="Operation"
                backend={
                  req.kind === 1
                    ? `Safe tx, operation ${req.safeTx.operation === 1 ? 'DELEGATECALL' : 'CALL'}`
                    : 'vault transfer'
                }
              />
              <Row
                label="Deposited / approved"
                chain={facts.data ? `${facts.data.deposited} / ${facts.data.approved}` : undefined}
              />
            </tbody>
          </table>
        </div>
      ) : null}

      {sealed ? (
        <div className="card">
          <div className="label mb-1">Gate results (sealed)</div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input
              type="password"
              className="mono w-96"
              placeholder="your seal private key (kept in memory only)"
              value={sealKey}
              onChange={(e) => setSealKey(e.target.value.trim())}
            />
            <select value={sealIdx} onChange={(e) => setSealIdx(Number(e.target.value))}>
              <option value={0}>officer 1</option>
              <option value={1}>officer 2</option>
              <option value={2}>officer 3</option>
            </select>
          </div>
          <div className="mt-2">
            {unsealed || <span className="text-muted">Import your seal key to read the reason.</span>}
          </div>
        </div>
      ) : null}

      {receiver ? (
        <OfficerActions desk={org.desk} warmVault={org.warmVault} txHash={req?.txHash} orgId={org.orgId} />
      ) : null}

      <div className="card">
        <div className="label mb-2">Timeline</div>
        <table className="grid">
          <tbody>
            {evs.map((e) => (
              <tr key={`${e.tx_hash}-${e.event}-${JSON.stringify(e.args).length}`}>
                <td className="text-muted">{new Date(Number(e.block_time) * 1000).toLocaleTimeString()}</td>
                <td>{e.event}</td>
                <td className="text-muted">{e.contract_name}</td>
                <td className="mono">
                  <a className="text-accent" href={explorerTx(d, e.tx_hash)} target="_blank" rel="noreferrer">
                    {short(e.tx_hash)}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

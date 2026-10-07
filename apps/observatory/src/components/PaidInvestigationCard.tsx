// Paid investigation over x402 on Cardano preprod (services/trace-market). Reads the evidence the Investigator
// writes (data/cardano_x402.json) and renders nothing until a run exists for this case. The payment is LIVE
// TESTNET; the trace it bought is REPLAY data (public on-chain transfers).
import { Panel, Row } from './ui'

type Linked = { address: string; from: string; depth: number; taintPct: number; tainted: number; evidenceTx: string }
type Evidence = {
  label: string
  caseId: string
  classification: string
  provider: string
  route: string
  network: string
  status: string
  price: { amount: string; asset: string }
  payer: string
  payee: string
  paymentTx?: string
  explorer?: string
  seconds?: number
  result?: { traceCase: string; unit: string; totalLinked: number; resultHash: string; linked: Linked[] }
}

const runs = Object.values(import.meta.glob<{ default: Evidence }>('../data/cardano_x402.json', { eager: true })).map((m) => m.default)
const short = (s: string, a = 10, b = 6) => (s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : s)
const ETHERSCAN = 'https://etherscan.io/tx/'

export default function PaidInvestigationCard({ caseId }: { caseId: string }) {
  const e = runs.find((r) => r.caseId === caseId)
  if (!e) return null
  const price = e.price.asset === 'lovelace' ? `${Number(e.price.amount) / 1e6} tADA` : `${e.price.amount} ${e.price.asset}`
  const settled = e.status === 'DELIVERED'
  return (
    <Panel
      title="Forensic investigation"
      className="mb-5"
      action={<span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-mute">Live testnet payment · replay trace</span>}
    >
      <div className="grid grid-cols-2 gap-6 px-5 pb-5">
        <dl>
          <Row k="Provider">{e.provider}</Row>
          <Row k="Commerce">Cardano x402</Row>
          <Row k="Network">Preprod</Row>
          <Row k="Price">{price}</Row>
          <Row k="Case">{e.caseId} · {e.classification}</Row>
          <Row k="Payment">
            <span className={settled ? 'text-honey' : 'text-wax'}>{settled ? 'SETTLED' : e.status.replace(/_/g, ' ')}</span>
            {e.seconds != null && <span className="text-mute"> · 402 to 200 in {e.seconds}s</span>}
          </Row>
          {e.paymentTx && (
            <Row k="Payment tx" mono>
              <a href={e.explorer} target="_blank" rel="noreferrer" className="text-honey hover:underline">{short(e.paymentTx)}</a>
            </Row>
          )}
          <Row k="Payer" mono>{short(e.payer, 14)}</Row>
          <Row k="Payee" mono>{short(e.payee, 14)}</Row>
        </dl>
        {e.result && (
          <div>
            <div className="text-[12px] text-mute">Trace result</div>
            <div className="mt-1 text-[22px] font-semibold text-cream">{e.result.totalLinked} linked addresses</div>
            <p className="mt-1 text-[12px] text-dim">Received tainted funds downstream of the seed. Linked is a lead for an analyst, not a confirmed attacker.</p>
            <ul className="mt-3 space-y-1.5">
              {e.result.linked.map((l) => (
                <li key={l.address} className="grid grid-cols-[1fr_auto_auto] gap-3 font-mono text-[12px]">
                  <span className="text-cream">{short(l.address)}</span>
                  <span className="text-dim">hop {l.depth} · {l.taintPct}%</span>
                  <a href={ETHERSCAN + l.evidenceTx} target="_blank" rel="noreferrer" className="text-honey hover:underline">evidence</a>
                </li>
              ))}
            </ul>
            <div className="mt-3 font-mono text-[11px] text-mute">result {short(e.result.resultHash, 12)}</div>
          </div>
        )}
      </div>
    </Panel>
  )
}

import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ACCOUNTS, REQUESTS, acctKey, type Req } from '../components/mock'
import { Button, DataTable, Drawer, HexDot, Icon, RED, Label, Metric, Mono, PageHeader, Panel, Row, Segmented, StateBadge, type Status } from '../components/ui'

const FILTERS = ['All', 'Pending', 'Held', 'Escalated', 'Rejected', 'Approved', 'Invalid'] as const
const GATES = ['Intent signature', 'RequestBoard match', 'ThreatRegistry', 'Destination age', 'Velocity', 'Quota bucket', 'Patrol reconciliation']
const VERDICT_S: Record<string, string> = { 'RB-310944': '2.1s', 'RB-310943': '2.7s', 'RB-310938': '1.9s', 'RB-310930': '2.3s', 'RB-310927': '2.0s', 'RB-310919': '2.6s', 'RB-310902': '2.4s', 'RB-310947': '0.8s', 'RB-310948': '0.7s', 'RB-310949': '1.1s' }
const hash = (id: string) => '0x' + id.slice(3).split('').reverse().join('') + 'c4…' + id.slice(-2) + 'e1'
const linked = (r: Req) => r.note.includes('QRM') || r.to.startsWith('0x3a4f')

function GateStrip({ r }: { r: Req }) {
  const stop = r.gate ?? (r.state === 'Approved' ? 8 : 0)
  return (
    <div>
      <div className="flex gap-1">
        {GATES.map((g, i) => {
          const n = i + 1, passed = n < stop, here = n === stop
          return <div key={g} title={`${n} · ${g}`} className={`flex-1 h-7 rounded grid place-items-center font-mono text-[11px] ${passed ? 'bg-honey text-ink' : here ? (r.invalid ? 'border' : 'border border-amber text-amber bg-amber/10') : 'bg-coal-3 text-mute'}`} style={here && r.invalid ? { borderColor: RED, color: RED, background: RED + '1a' } : undefined}>{n}</div>
        })}
      </div>
      <div className="mt-1.5 text-[11.5px] text-dim">{stop >= 1 && stop <= 7 ? <>Stopped at gate {stop} · <span className={r.invalid ? '' : 'text-amber'} style={r.invalid ? { color: RED } : undefined}>{GATES[stop - 1]}</span>{r.reason && <span className="font-mono text-mute"> · {r.reason}</span>}</> : stop === 8 ? 'All 7 gates passed' : 'No gate evaluated'}</div>
    </div>
  )
}

function useCountdown(ts: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
  const s = Math.max(0, Math.floor((ts - now) / 1000))
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':')
}

function AccountBody({ k }: { k: string }) {
  const a = ACCOUNTS[k]
  const cd = useCountdown(a?.notBeforeTs ?? 0)
  if (!a) return <p className="text-[13px] text-dim">No KeyRegistry record for this account.</p>
  return (
    <div className="space-y-4">
      {a.delay && <div className="p-3 rounded-md border border-amber/40 bg-amber/[0.06]"><Label>Key activates in</Label><div className="mt-1 font-mono text-[26px] text-amber tabular-nums">{cd}</div><div className="text-[12px] text-dim">Withdrawals signed by the new key are held until notBefore.</div></div>}
      <dl>
        <Row k="Key status"><span className={a.delay ? 'text-amber' : 'text-cream'}>{a.status}</span></Row>
        <Row k="KeyRegistry notBefore" mono>{a.notBefore}</Row>
        <Row k="Last key change">{a.lastChange}</Row>
        <Row k="Deposit / funding" mono>{a.deposit}</Row>
        <Row k="Funding proof" mono>{a.proof}</Row>
      </dl>
    </div>
  )
}

/** Where a request is in the pipeline. Money only moves at the final stage. */
function stages(r: Req): { name: string; who: string; s: Status; note: string }[] {
  const blocked = r.state === 'Rejected', held = r.state === 'Pending' || r.state === 'Held' || r.state === 'Escalated'
  return [
    { name: 'Backend', who: r.source + ' · untrusted', s: 'idle', note: 'Untrusted origin: can request, not authorize' },
    { name: 'RequestBoard', who: 'recorded', s: 'active', note: `Entry ${r.id} · ${r.t} UTC` },
    { name: 'Cosign', who: 'CRE workflow', s: blocked ? 'threat' : held ? 'warning' : 'active', note: !r.cosign ? 'Below review band: quota check only' : blocked ? 'REJECT · ' + r.constraint : held ? 'PENDING · ' + r.constraint : 'APPROVE · ' + r.constraint },
    { name: 'QuorumReceiver', who: 'permit', s: blocked || held ? 'idle' : 'active', note: blocked ? 'No execution permit issued' : held ? 'Awaiting verdict' : 'Execution permit relayed' },
    { name: 'QuorumVault', who: 'funds move', s: r.id === 'RB-310938' ? 'active' : 'idle', note: r.id === 'RB-310938' ? 'Transfer executed within quota' : r.state === 'Approved' ? 'Queued · vault constraints apply' : 'Not executed' },
  ]
}

type Exec = 'Not Executed' | 'Permit Issued' | 'Executed' | 'Rejected' | 'Blocked by Vault' | 'Held by Timelock'
function exec(r: Req): Exec {
  if (r.state === 'Rejected') return 'Rejected'
  if (r.state === 'Held') return 'Held by Timelock'
  if (r.state === 'Escalated') return 'Blocked by Vault'
  if (r.state === 'Approved') return r.id === 'RB-310938' ? 'Executed' : 'Permit Issued'
  return 'Not Executed'
}
const EXEC_STYLE: Record<Exec, string> = {
  'Not Executed': 'text-mute', 'Permit Issued': 'text-cream', Executed: 'text-honey',
  Rejected: 'text-cream', 'Blocked by Vault': 'text-amber', 'Held by Timelock': 'text-amber',
}
const AGE: Record<string, string> = { 'RB-310944': '—', 'RB-310943': '4m 02s', 'RB-310941': '4m 20s', 'RB-310938': '—', 'RB-310930': '—', 'RB-310927': '—', 'RB-310919': '—', 'RB-310902': '17m 30s', 'RB-310947': '—', 'RB-310948': '—', 'RB-310949': '—' }

/** index of the step the request currently sits at; steps before are complete, after are future/skipped */
function current(r: Req) {
  const e = exec(r)
  return e === 'Executed' ? 5 : e === 'Permit Issued' || e === 'Held by Timelock' || e === 'Blocked by Vault' ? 4 : 2
}

export default function Requests() {
  const [f, setF] = useState<(typeof FILTERS)[number]>('All')
  const [sel, setSel] = useState<Req>(REQUESTS[0])
  const [params, setParams] = useSearchParams()
  const pid = params.get('id'), lane = params.get('lane'), gate = Number(params.get('gate')) || 0, account = params.get('account')
  useEffect(() => {
    if (lane === 'invalid') { setF('Invalid'); const r = REQUESTS.find((x) => x.invalid); if (r && !pid) setSel(r) }
    if (gate) { const r = REQUESTS.find((x) => x.gate === gate); if (r && !pid) setSel(r) }
    if (pid) { const r = REQUESTS.find((x) => x.id === pid); if (r) setSel(r) }
  }, [pid, lane, gate])
  const clear = (k: string) => { const n = new URLSearchParams(params); n.delete(k); setParams(n) }
  const acct = account ? acctKey(account) : null
  const rows = REQUESTS.filter((r) => (f === 'All' || (f === 'Invalid' ? !!r.invalid : r.state === f)) && (!gate || r.gate === gate))

  return (
    <div className="max-w-[1480px]">
      <PageHeader eyebrow="Request & trigger layer" title="RequestBoard"
        desc={<>Every withdrawal request is recorded here first. <b className="text-cream font-medium">A request is not a transfer.</b> Funds only move after Cosign evaluates the request and QuorumVault constraints allow it.</>}
        actions={<><Button variant="secondary"><Icon name="filter" size={15} />Filters</Button><Button variant="secondary"><Icon name="download" size={15} />Export</Button></>} />

      <div className="grid grid-cols-5 gap-4 mb-5">
        <Metric label="Requests · 24h" value="9,412" sub="38 members · 6 chains" status="active" />
        <Metric label="Cosign review" value="1,208" sub="12.8% entered review band" status="idle" />
        <Metric label="Pending" value="12" sub="avg hold 4m 10s" status="warning" />
        <Metric label="Rejected" value="4" sub="2 linked to #QRM-78452" status="threat" />
        <Metric label="Value held" value="$1.10M" sub="awaiting verdict or timelock" status="warning" />
      </div>

      {/* Pipeline explainer */}
      <Panel className="mb-5 px-6 py-4 honeycomb">
        <div className="flex items-center gap-3">
          {['Exchange backend', 'RequestBoard', 'Cosign Workflow', 'QuorumReceiver', 'QuorumVault'].map((n, i, a) => (
            <div key={n} className="flex items-center gap-3 flex-1 last:flex-none">
              <div className={`flex items-center gap-2 h-9 px-3 rounded-md border text-[13px] whitespace-nowrap ${i === 0 ? 'border-dashed border-dim/50 text-dim' : i === 4 ? 'border-honey bg-honey text-ink font-semibold' : i === 1 ? 'border-honey/60 text-honey' : 'border-honey/25 text-cream'}`}>
                {n}{i === 0 && <span className="font-mono text-[10px]">UNTRUSTED</span>}{i === 4 && <span className="font-mono text-[10px]">FUNDS MOVE HERE ONLY</span>}
              </div>
              {i < a.length - 1 && <div className="flex-1 h-px bg-gradient-to-r from-honey/40 to-honey/10 min-w-6" />}
            </div>
          ))}
        </div>
      </Panel>

      {gate >= 1 && gate <= 7 && (
        <div className="mb-4 flex items-center gap-3 h-10 px-4 rounded-md border border-amber/40 bg-amber/[0.06] text-[13px]">
          <Icon name="filter" size={15} className="text-amber" /><span className="text-cream">Filtered · Gate {gate} · {GATES[gate - 1]}</span>
          <button onClick={() => clear('gate')} className="ml-auto inline-flex items-center gap-1 text-dim hover:text-cream"><Icon name="close" size={14} />Clear</button>
        </div>
      )}
      <div className="grid grid-cols-[1fr_420px] gap-5 items-start">
        <Panel>
          <div className="flex items-center justify-between px-5 py-3.5">
            <Segmented options={FILTERS} value={f} onChange={setF} />
            <span className="font-mono text-[11px] text-mute">{rows.length} of {REQUESTS.length} shown · live</span>
          </div>
          <DataTable rows={rows} rowKey={(r) => r.id} selected={sel.id} onSelect={setSel} cols={[
            { key: 'id', label: 'Request', render: (r) => <div><div className="font-mono text-[12.5px] text-cream">{r.id}</div><div className="font-mono text-[11px] text-mute">{r.t}</div></div> },
            { key: 'src', label: 'Source', render: (r) => <div><div className="text-cream">{r.source}</div><div className="text-[11.5px] text-mute">{r.user}</div></div> },
            { key: 'amt', label: 'Amount', align: 'right', render: (r) => <div><div className="font-mono text-cream tabular-nums">{r.amount} {r.asset}</div><div className="text-[11.5px] text-mute">{r.usd}</div></div> },
            { key: 'route', label: 'Destination', render: (r) => <span className={`font-mono text-[12px] ${r.to.startsWith('0x3a4f') ? 'text-amber' : 'text-cream'}`}>{r.to}</span> },
            { key: 'why', label: 'Policy reason', render: (r) => <span className="text-[12px] text-dim">{r.constraint}</span> },
            { key: 'cosign', label: 'Cosign', render: (r) => <span className={`font-mono text-[11.5px] ${r.cosign ? 'text-cream' : 'text-mute'}`}>{!r.cosign ? 'quota only' : r.state === 'Rejected' ? 'REJECT' : r.state === 'Approved' ? 'APPROVE' : 'PENDING'}</span> },
            { key: 'state', label: 'Status', render: (r) => <StateBadge state={r.state} /> },
            { key: 'age', label: 'Waiting', render: (r) => <span className={`font-mono text-[12px] ${AGE[r.id] === '—' ? 'text-mute' : 'text-cream'}`}>{AGE[r.id]}</span> },
            { key: 'exe', label: 'Execution', render: (r) => <span className={`text-[12px] whitespace-nowrap ${EXEC_STYLE[exec(r)]}`}>{exec(r)}</span> },
            { key: 'inc', label: 'Incident', render: (r) => linked(r) ? <span className="font-mono text-[12px] text-dim">#QRM-78452</span> : <span className="text-mute">—</span> },
          ]} />
        </Panel>

        <Panel className="sticky top-0">
          <div className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
            <div className="flex items-center justify-between"><Label>Request detail</Label><StateBadge state={sel.state} /></div>
            <div className="mt-2 font-mono text-[18px] text-cream">{sel.id}</div>
            <div className="mt-1 text-[24px] font-semibold tabular-nums">{sel.amount} {sel.asset} <span className="text-[13px] font-normal text-dim">{sel.usd}</span></div>
          </div>
          <div className="px-5 py-4">
            {sel.invalid && (
              <div className="mb-4 p-3 rounded-md border" style={{ borderColor: RED + '66', background: RED + '0f' }}>
                <div className="font-mono text-[11px]" style={{ color: RED }}>UNVERIFIED · FORGED REQUEST</div>
                <dl className="mt-1">
                  <Row k="Rejection">{sel.invalid.reason}</Row>
                  <Row k="Signature" mono>{sel.invalid.sig}</Row>
                  <Row k="Trap link"><Link to="/traps?decoy=DW-07" className="text-honey hover:text-flare">{sel.invalid.trap}</Link></Row>
                </dl>
              </div>
            )}
            <Label>Cosign gates</Label>
            <div className="mt-2 mb-4"><GateStrip r={sel} /></div>
            <Label>Request path</Label>
            <ol className="mt-3 space-y-0">
              {stages(sel).map((s, i, a) => {
                const cur = current(sel), done = i < cur, now = i === cur
                return (
                <li key={s.name} className="grid grid-cols-[20px_1fr] gap-3">
                  <span className="relative flex justify-center">
                    {i < a.length - 1 && <span className={`absolute top-5 bottom-0 w-px ${i < cur - 1 || (done && i + 1 <= cur) ? 'bg-honey/70' : 'bg-white/[0.08]'}`} />}
                    <span className={`mt-0.5 w-4 h-4 clip-hex ${done ? 'bg-honey' : now ? 'bg-flare shadow-[0_0_12px_#FCEF3C]' : 'bg-coal-3'}`} />
                  </span>
                  <div className="pb-4">
                    <div className="flex items-baseline gap-2"><span className={`text-[13.5px] font-medium ${now ? 'text-flare' : done ? 'text-cream' : 'text-mute'}`}>{s.name}</span><span className="text-[11px] text-mute">{s.who}</span>{now && <span className="ml-auto text-[11px] text-flare">current</span>}</div>
                    <div className={`text-[12.5px] ${i > cur ? 'text-mute' : 'text-dim'}`}>{s.note}</div>
                  </div>
                </li>
              )})}
            </ol>
            <dl className="mt-1">
              <Row k="Timestamp" mono>Oct 05 {sel.t} UTC</Row>
              <Row k="Source">{sel.source}</Row>
              <Row k="Account">{ACCOUNTS[acctKey(sel.user)] ? <button onClick={() => { const n = new URLSearchParams(params); n.set('account', sel.user); setParams(n) }} className="text-honey hover:text-flare">{sel.user} →</button> : sel.user}</Row>
              <Row k="From">{sel.from}</Row>
              <Row k="Destination" mono>{sel.to}</Row>
              <Row k="Policy reason">{sel.constraint}</Row>
              <Row k="Cosign verdict" mono>{!sel.cosign ? 'quota only' : sel.state === 'Rejected' ? 'REJECT' : sel.state === 'Approved' ? 'APPROVE' : 'PENDING'}</Row>
              <Row k="Request hash" mono>{hash(sel.id)}</Row>
              <Row k="VerdictRecorded" mono>{VERDICT_S[sel.id] ?? '—'}</Row>
              <Row k="Linked incident">{linked(sel) ? <Link to="/cases/QRM-78452" className="font-mono text-honey hover:text-flare">#QRM-78452</Link> : <span className="text-mute">—</span>}</Row>
              <Row k="Execution"><span className={EXEC_STYLE[exec(sel)]}>{exec(sel)}</span></Row>
              <Row k="Waiting" mono>{AGE[sel.id]}</Row>
            </dl>
            <p className="mt-3 text-[12.5px] text-dim">{sel.note}</p>
            <div className="mt-4 flex gap-2">
              {sel.state === 'Rejected' ? <Link to="/cases/QRM-78452" className="inline-flex items-center h-9 px-4 rounded-md bg-honey text-ink text-[13px] font-semibold hover:bg-flare">Open case</Link> : <Button>Review</Button>}
              <Button variant="secondary">View Cosign run</Button>
            </div>
          </div>
        </Panel>
      </div>
      <Drawer open={!!acct} onClose={() => clear('account')} eyebrow="Account · KeyRegistry" title={<span className="font-mono">{acct ? ACCOUNTS[acct]?.id ?? account : ''}</span>}>
        {acct && <AccountBody k={acct} />}
      </Drawer>
    </div>
  )
}

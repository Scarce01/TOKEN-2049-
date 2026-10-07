import { useState } from 'react'
import { Link } from 'react-router'
import { Badge, Button, DataTable, Icon, Label, Metric, Mono, PageHeader, Panel, Row, StateBadge } from '../components/ui'

type Report = { id: string; wf: 'Trap' | 'Cosign' | 'Patrol'; t: string; nodes: string; verdict: string; incident?: string; state: 'Executed' | 'Queued' | 'Rejected'; calls: { fn: string; mod: string; d: string; tx: string; t: string }[] }

const REPORTS: Report[] = [
  { id: '#78452', wf: 'Trap', t: '14:02:24', nodes: '7/7', verdict: 'Tighten · decoy DW-07 verified', incident: 'QRM-78452', state: 'Executed', calls: [
    { fn: 'setQuota(hot, 0)', mod: 'QuorumVault', d: 'Hot quota 2,400 → 0 ETH', tx: '0x41e0…c2a7', t: '14:02:31' },
    { fn: 'sweep(hot → cold, 1120)', mod: 'QuorumVault', d: '1,120 ETH moved to ColdVault', tx: '0x9d3a…7f10', t: '14:02:31' },
    { fn: 'restrict(warm, COSIGN_ONLY, 6h)', mod: 'QuorumVault', d: 'Warm cosign-only to 20:02', tx: '0x77b1…0e3c', t: '14:02:31' },
    { fn: 'extendTimelock(cold, 72h)', mod: 'ColdVault', d: 'Timelock 24h → 72h', tx: '0x0c5f…a991', t: '14:02:32' },
    { fn: 'publish(0x7a3f…91c2)', mod: 'ThreatRegistry', d: 'Entry #4,118 · fingerprint fp-a91c', tx: '0x2f9c…b8e3', t: '14:02:38' },
  ] },
  { id: '#78451', wf: 'Cosign', t: '14:02:03', nodes: '7/7', verdict: 'Reject RB-310944 · registry match', incident: 'QRM-78452', state: 'Executed', calls: [
    { fn: 'deny(RB-310944)', mod: 'QuorumVault', d: 'No execution permit issued', tx: '0x1c08…5b2e', t: '14:02:04' },
  ] },
  { id: '#78453', wf: 'Patrol', t: '14:02:30', nodes: '7/7', verdict: 'Trace cluster · 2 linked requests', incident: 'QRM-78452', state: 'Executed', calls: [
    { fn: 'flag(RB-310919)', mod: 'ThreatRegistry', d: 'Retro-match to attacker cluster', tx: '0x6e72…d0a4', t: '14:02:33' },
  ] },
  { id: '#78454', wf: 'Cosign', t: '14:02:41', nodes: '6/7', verdict: 'Pending RB-310943 · over post-trigger quota', state: 'Queued', calls: [] },
  { id: '#78440', wf: 'Cosign', t: '14:00:12', nodes: '7/7', verdict: 'Approve RB-310938', state: 'Executed', calls: [
    { fn: 'permit(RB-310938)', mod: 'QuorumVault', d: '2,500 USDT within quota', tx: '0x5aa9…31c0', t: '14:00:13' },
  ] },
  { id: '#78437', wf: 'Patrol', t: '13:59:30', nodes: '4/7', verdict: 'Below signer threshold', state: 'Rejected', calls: [] },
]

const QUEUE = [
  { id: 'q-311', what: 'Cosign verdict for RB-310943', src: 'report #78454', eta: 'next DON round · ~20s' },
  { id: 'q-312', what: 'Patrol post-trigger trace', src: 'cron · 30s', eta: '14:03:00' },
]

const MODS = ['QuorumVault', 'ColdVault', 'ThreatRegistry', 'DecoyCommit', 'ConfigTimelock']

export default function Execution() {
  const [sel, setSel] = useState(REPORTS[0])
  const touched = new Set(sel.calls.map((c) => c.mod))
  return (
    <div className="max-w-[1480px]">
      <PageHeader eyebrow="Execution layer · QuorumReceiver" title="Execution Center"
        desc={<>What CRE verified, and what the system executed because of it. QuorumReceiver accepts <b className="text-cream font-medium">DON-signed reports only</b>. It never takes instructions from an exchange backend.</>}
        actions={<Button variant="secondary"><Icon name="download" size={15} />Export execution log</Button>} />

      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Receiver status" value="Online" sub="0x5e0a…11bd · signer set v12" status="active" />
        <Metric label="Reports accepted · 24h" value="9,418" sub="6 rejected below threshold" status="idle" />
        <Metric label="Defensive actions · 24h" value="7" sub="from 3 verified reports" status="threat" />
        <Metric label="Response queue" value="2" sub="awaiting DON round" status="warning" />
      </div>

      {/* 5-stage pipeline, QuorumReceiver central */}
      <Panel className="mb-5 px-6 py-6">
        {(() => {
          const n = sel.state === 'Rejected' ? 2 : sel.state === 'Queued' ? 3 : 5
          const ST = [['Report Received', `${sel.id} · ${sel.t}`], ['Quorum Verified', `${sel.nodes} signers`], ['Directive Parsed', sel.calls[0]?.fn ?? '—'], ['Module Routed', [...touched].join(' · ') || '—'], ['Executed Onchain', sel.calls[0]?.tx ?? '—']]
          return (
            <div className="grid grid-cols-[1fr_1fr_auto_1fr_1fr] items-center gap-3">
              {ST.map(([a, b], i) => {
                const done = i < n, cur = i === n, center = i === 2
                return (
                  <div key={a} className={center ? 'relative px-8 py-5 bg-coal-3 text-center' : 'relative'} style={center ? { clipPath: 'polygon(10% 0,90% 0,100% 50%,90% 100%,10% 100%,0 50%)' } : undefined}>
                    {center && <div className="text-[11px] text-dim mb-1">QuorumReceiver</div>}
                    <div className="flex items-center gap-2 justify-center">
                      <span className={`w-2 h-2 rotate-45 ${done ? 'bg-honey' : cur ? 'bg-amber' : 'bg-coal-3 ring-1 ring-white/10'}`} />
                      <span className={`text-[13.5px] font-semibold ${done ? 'text-cream' : 'text-mute'}`}>{a}</span>
                    </div>
                    <div className={`mt-1 font-mono text-[11px] truncate ${center ? '' : 'text-center'} text-mute`}>{b}</div>
                    {i < 4 && !center && <div className={`absolute top-[9px] -right-3 w-3 h-px ${done ? 'bg-honey/50' : 'bg-white/10'}`} />}
                  </div>
                )
              })}
            </div>
          )
        })()}
        <div className="mt-5 flex flex-wrap gap-1.5 justify-center">
          {MODS.map((m) => <span key={m} className={`text-[12px] px-2.5 h-6 inline-flex items-center ${touched.has(m) ? 'bg-amber/10 text-cream' : 'text-mute'}`}>{touched.has(m) && <Icon name="lock" size={11} className="mr-1.5 text-amber" />}{m}</span>)}
        </div>
      </Panel>

      <div className="grid grid-cols-[1fr_440px] gap-5 mb-5">
        <Panel title="Incoming verified reports">
          <DataTable rows={REPORTS} rowKey={(r) => r.id} selected={sel.id} onSelect={setSel} cols={[
            { key: 'id', label: 'Report', render: (r) => <span className="font-mono text-honey">{r.id}</span> },
            { key: 'wf', label: 'Workflow', render: (r) => <Badge status={r.wf === 'Trap' ? 'threat' : r.wf === 'Cosign' ? 'active' : 'idle'}>{r.wf}</Badge> },
            { key: 'v', label: 'Verdict', render: (r) => <span className="text-cream">{r.verdict}</span> },
            { key: 'n', label: 'Nodes', render: (r) => <span className={`font-mono ${r.nodes === '7/7' ? 'text-cream' : 'text-amber'}`}>{r.nodes}</span> },
            { key: 'a', label: 'Actions', align: 'right', render: (r) => <span className="font-mono text-dim">{r.calls.length}</span> },
            { key: 't', label: 'Received', render: (r) => <span className="font-mono text-[12px] text-dim">{r.t}</span> },
            { key: 's', label: 'State', render: (r) => <StateBadge state={r.state} /> },
          ]} />
        </Panel>
        <div className="space-y-5">
          <Panel className="p-5">
            <div className="flex items-center justify-between"><Label>Report {sel.id}</Label><StateBadge state={sel.state} /></div>
            <div className="mt-2 text-[16px] font-semibold">{sel.verdict}</div>
            <dl className="mt-3">
              <Row k="Workflow">{sel.wf} Workflow</Row>
              <Row k="Signatures" mono>{sel.nodes} · threshold 5</Row>
              <Row k="Received" mono>{sel.t} UTC</Row>
              <Row k="Incident">{sel.incident ? <Link to={`/cases/${sel.incident}`} className="font-mono text-honey hover:text-flare">#{sel.incident}</Link> : <span className="text-mute">none</span>}</Row>
            </dl>
          </Panel>
          <Panel title="Response queue">
            <ul className="px-5 pb-4 space-y-2">
              {QUEUE.map((q) => <li key={q.id} className="p-3 rounded-md border border-dashed border-amber/50"><div className="text-[13px] text-cream">{q.what}</div><div className="mt-0.5 font-mono text-[11px] text-dim">{q.src} · {q.eta}</div></li>)}
            </ul>
          </Panel>
        </div>
      </div>

      <Panel title={`Executed defensive actions · report ${sel.id}`} action={<Link to="/vaults" className="text-[12px] text-honey hover:text-flare">Vaults & Controls →</Link>}>
        {sel.calls.length ? (
          <DataTable rows={sel.calls} rowKey={(c) => c.tx} cols={[
            { key: 't', label: 'Executed', render: (c) => <span className="font-mono text-[12px] text-dim">{c.t}</span> },
            { key: 'fn', label: 'Call', render: (c) => <Mono>{c.fn}</Mono> },
            { key: 'm', label: 'Module', render: (c) => <span className="text-cream">{c.mod}</span> },
            { key: 'd', label: 'Effect', render: (c) => <span className="text-dim">{c.d}</span> },
            { key: 'tx', label: 'Tx', render: (c) => <Mono>{c.tx}</Mono> },
          ]} />
        ) : <div className="px-5 pb-5 text-[13px] text-mute">No onchain actions: {sel.state === 'Queued' ? 'awaiting verdict.' : 'report rejected by QuorumReceiver.'}</div>}
      </Panel>
    </div>
  )
}

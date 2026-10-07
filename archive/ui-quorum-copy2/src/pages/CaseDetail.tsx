import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { CASE_ID, REQUESTS } from '../components/mock'
import { Badge, Button, DataTable, Icon, IncidentChip, Label, Meter, Modal, Mono, NodeChip, PageHeader, Panel, Row, StateBadge, Tabs, VTimeline } from '../components/ui'

const STORY = [
  { k: 'What happened', v: 'An attacker with access to Exchange A’s backend enumerated decoy account QA-114, then sent a probe transfer to decoy wallet DW-07.' },
  { k: 'Why it was detected', v: 'DW-07 has zero legitimate use. Its address was committed onchain in DecoyCommit, so any touch is deterministic evidence.' },
  { k: 'What Quorum did', v: 'Trap Workflow verified the event on 7/7 CRE nodes and sent a signed tightening report to QuorumReceiver.' },
  { k: 'What changed onchain', v: 'Hot quota cleared, warm vault restricted, cold timelock 24h → 72h, and 0x7a3f…91c2 published to ThreatRegistry.' },
]

const ACTIONS = [
  { a: 'Clear hot-vault quota', c: 'QuorumVault', tx: '0x41e0…c2a7', before: '2,400 ETH / 24h', after: '0 ETH', s: 'Executed' },
  { a: 'Sweep hot → cold', c: 'QuorumVault → ColdVault', tx: '0x9d3a…7f10', before: '2,400 ETH hot', after: '1,120 ETH swept', s: 'Executed' },
  { a: 'Restrict warm vault', c: 'QuorumVault', tx: '0x77b1…0e3c', before: 'Open · cosign band', after: 'Cosign-only · 6h', s: 'Executed' },
  { a: 'Extend cold timelock', c: 'ColdVault / ConfigTimelock', tx: '0x0c5f…a991', before: '24h', after: '72h', s: 'Executed' },
  { a: 'Mark recipient address', c: 'ThreatRegistry', tx: '0x2f9c…b8e3', before: '—', after: 'Entry #4,118', s: 'Executed' },
]
const AUDIT = [
  { t: '14:02:19.408', actor: 'CRE DON (7/7)', ev: 'report.signed', d: 'Trap report #78452 · evidence 0xc71d…0a92' },
  { t: '14:02:31.112', actor: 'QuorumReceiver', ev: 'report.accepted', d: 'onReport() · signer set v12 verified' },
  { t: '14:02:31.640', actor: 'QuorumVault', ev: 'policy.tightened', d: 'hot.quota=0 · warm.mode=cosign_only' },
  { t: '14:02:32.004', actor: 'ColdVault', ev: 'timelock.extended', d: '86400 → 259200' },
  { t: '14:02:38.220', actor: 'ThreatRegistry', ev: 'entry.published', d: '#4,118 · scope=network' },
  { t: '14:05:10.000', actor: 'M. Kovač', ev: 'case.assigned', d: 'Owner set · severity confirmed' },
  { t: '14:15:44.000', actor: 'M. Kovač', ev: 'config.proposed', d: 'CT-0194 relax hot.quota → 800 ETH (48h)' },
]
const TABS = ['Execution', 'Audit log', 'Related'] as const

export default function CaseDetail() {
  const { id = CASE_ID } = useParams()
  const [params] = useSearchParams()
  const requestedReturn = params.get("returnTo")
  const returnTo = requestedReturn?.startsWith("/controls?") ? requestedReturn : "/controls?tab=triggers"
  const [tab, setTab] = useState<(typeof TABS)[number]>('Execution')
  const [escalate, setEscalate] = useState(false)
  const req = REQUESTS[0]

  return (
    <div className="max-w-[1480px]">
      <Link to={returnTo} className="mb-3 inline-flex text-xs text-honey hover:underline">← Return to Controls</Link>
      <div className="flex items-center gap-2 mb-3 text-[12px] text-mute"><Link to="/cases" className="hover:text-cream">Incidents</Link><span>/</span><span className="text-cream font-mono">#{id}</span></div>
      <PageHeader eyebrow="Incident · opened 14:02:07 UTC"
        title={<span className="flex items-center gap-4">Decoy wallet hit at Exchange A <span className="flex gap-2"><Badge status="threat">Tightened</Badge><Badge status="warning">Request blocked</Badge></span></span>}
        desc="Trap Workflow confirmed a high-confidence decoy touch. Vault controls tightened 24 seconds after the first probe, before any large-scale fund movement."
        actions={<><Button variant="secondary" onClick={() => setEscalate(true)}>Escalate</Button><Button variant="secondary"><Icon name="download" size={15} />Export report</Button><Button><Icon name="external" size={15} />View onchain</Button></>} />

      {/* Incident summary */}
      <div className="grid grid-cols-[repeat(4,1fr)_1.4fr] gap-px bg-white/[0.04] clip-hexcard mb-5">
        {[['Contained in', '24s', 'probe → controls tightened'], ['Requests blocked', '1', 'RB-310944 · 0 funds moved'], ['Vault controls changed', '3', 'Hot · Warm · Cold'], ['Members notified', '38', 'ThreatRegistry #4,118']].map(([k, v, d], i) => (
          <div key={k} className="bg-coal-2 px-5 py-4"><Label>{k}</Label><div className={`mt-1 text-[24px] font-semibold tabular-nums ${i === 0 ? 'text-honey' : 'text-cream'}`}>{v}</div><div className="text-[12px] text-dim">{d}</div></div>
        ))}
        <dl className="bg-coal-2 px-5 py-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] content-center">
          {[['Value protected', '$4.82B · 3 tiers'], ['Analyst', 'Mira Kovač'], ['Transaction', '0x8be1…44f0'], ['Request', 'RB-310944'], ['CRE run', 'run-7f21'], ['Receiver report', '#78452']].map(([k, v]) => (
            <div key={k}><dt className="text-mute">{k}</dt><dd className={`text-cream ${/^[0#rRu]/.test(v) && k !== 'Analyst' ? 'font-mono' : ''}`}>{v}</dd></div>
          ))}
        </dl>
      </div>

      {/* The four-question story strip */}
      <div className="grid grid-cols-4 gap-px bg-white/[0.04] clip-hexcard mb-6">
        {STORY.map((s, i) => (
          <div key={s.k} className={`p-5 bg-coal-2`}>
            <div className="flex items-center gap-2"><span className={`clip-hex w-6 h-6 grid place-items-center font-mono text-[11px] font-bold bg-honey/10 text-honey`}>{i + 1}</span><Label>{s.k}</Label></div>
            <p className="mt-3 text-[13.5px] leading-relaxed text-cream/90">{s.v}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_400px] gap-5">
        <div className="space-y-5 min-w-0">
          <div className="grid grid-cols-2 gap-5">
            <Panel title="Trigger & evidence">
              <dl className="px-5 pb-4">
                <Row k="Trigger type"><span className="text-wax font-medium">Decoy wallet hit</span> · DW-07</Row>
                <Row k="Pre-signal">3× enumeration of decoy account DA-114</Row>
                <Row k="Source">Exchange A <span className="text-mute">· backend treated as untrusted</span></Row>
                <Row k="Evidence">Onchain transfer · blk 21,904,118</Row>
                <Row k="Tx" mono>0x8be1…44f0</Row>
                <Row k="DecoyCommit" mono>0xc71d…0a92 ✓ matches</Row>
                <Row k="Attacker" mono>0x7a3f…91c2</Row>
              </dl>
            </Panel>
            <Panel title="Related request · RequestBoard">
              <div className="px-5 pb-5">
                <div className="flex items-center justify-between"><span className="font-mono text-[15px] text-honey">{req.id}</span><StateBadge state={req.state} /></div>
                <div className="mt-3 text-[22px] font-semibold tabular-nums">{req.amount} {req.asset} <span className="text-[13px] text-dim font-normal">{req.usd}</span></div>
                <div className="mt-1 text-[12.5px] text-dim">{req.from} → <span className="font-mono text-cream">{req.to}</span></div>
                <div className="mt-4 p-3 rounded-md border border-dashed border-honey/20 text-[12.5px] text-dim">The backend submitted this request. RequestBoard recorded it, but Cosign returned <b className="text-cream">REJECT</b>, so no funds moved.</div>
                <Link to="/requests" className="inline-block mt-3 text-[12.5px] text-honey hover:text-flare">Open in RequestBoard →</Link>
              </div>
            </Panel>
          </div>

          <Panel title="CRE workflows involved">
            <div className="grid grid-cols-3 gap-px bg-honey/[0.08] border-t border-white/[0.05]">
              {[
                { n: 'Trap Workflow', r: 'Tighten', d: 'Decoy touch verified 7/7 · report #78452', s: 'threat' as const, t: '14:02:19' },
                { n: 'Cosign Workflow', r: 'REJECT', d: 'RB-310944 · destination in ThreatRegistry', s: 'warning' as const, t: '14:02:03' },
                { n: 'Patrol Workflow', r: 'Tracking', d: 'Cluster 0x3a4f · 2 hops · no outflow', s: 'active' as const, t: '14:02:30' },
              ].map((w) => (
                <Link to="/workflows" key={w.n} className="bg-coal-2 p-5 hover:bg-coal-3/60 transition-colors">
                  <div className="flex items-center justify-between"><span className="text-[14px] font-semibold">{w.n}</span><Badge status={w.s}>{w.r}</Badge></div>
                  <div className="mt-2 text-[12.5px] text-dim">{w.d}</div>
                  <div className="mt-3 font-mono text-[11px] text-mute">last run {w.t} UTC</div>
                </Link>
              ))}
            </div>
          </Panel>

          <Panel>
            <Tabs tabs={TABS} value={tab} onChange={setTab} />
            {tab === 'Execution' && (
              <div className="p-5 grid grid-cols-[340px_1fr] gap-5">
                <div>
                  <Label>QuorumReceiver report</Label>
                  <pre className="mt-2 p-4 rounded-md bg-ink border border-white/[0.06] font-mono text-[11.5px] leading-[1.7] text-cream/90 overflow-x-auto">{`report      #78452
workflow    trap.v3
evidence    0xc71d…0a92
decoy       DW-07  (DecoyCommit ✓)
signers     7 / 7  (threshold 5)
received    14:02:31.112 UTC
directives
  hot.quota       → 0
  hot.sweep       → cold 1,120 ETH
  warm.mode       → cosign_only 6h
  cold.timelock   → 72h
  registry.mark   → 0x7a3f…91c2`}</pre>
                </div>
                <div className="min-w-0">
                  <Label>Resulting onchain actions</Label>
                  <div className="mt-2 -mx-4">
                    <DataTable dense rows={ACTIONS} rowKey={(r) => r.a} cols={[
                      { key: 'a', label: 'Action', render: (r) => <span className="font-medium text-cream">{r.a}</span> },
                      { key: 'c', label: 'Contract', render: (r) => <span className="text-dim">{r.c}</span> },
                      { key: 'ba', label: 'Before → after', render: (r) => <span className="font-mono text-[12px]"><span className="text-mute">{r.before}</span> → <span className="text-amber">{r.after}</span></span> },
                      { key: 'tx', label: 'Tx', render: (r) => <Mono>{r.tx}</Mono> },
                    ]} />
                  </div>
                </div>
              </div>
            )}
            {tab === 'Audit log' && <DataTable rows={AUDIT} rowKey={(r) => r.t} cols={[
              { key: 't', label: 'Time (UTC)', render: (r) => <span className="font-mono text-[12px] text-dim">{r.t}</span> },
              { key: 'actor', label: 'Actor', render: (r) => <span className="text-cream">{r.actor}</span> },
              { key: 'ev', label: 'Event', render: (r) => <Mono>{r.ev}</Mono> },
              { key: 'd', label: 'Detail', render: (r) => <span className="text-dim">{r.d}</span> },
            ]} />}
            {tab === 'Related' && (
              <div className="p-5 space-y-4">
                <div><Label>Addresses & entities</Label><div className="mt-2 flex flex-wrap gap-2">
                  <NodeChip name="0x7a3f…91c2" kind="attacker" status="threat" /><NodeChip name="0xbe20…44e1" kind="retro-link" status="warning" /><NodeChip name="DW-07" kind="decoy" status="threat" /><NodeChip name="DA-114" kind="decoy" status="threat" /><NodeChip name="Exchange A" kind="source" status="warning" /><NodeChip name="Exchange B" kind="consumer" status="active" />
                </div></div>
                <div><Label>Related cases</Label><div className="mt-2 flex gap-2"><IncidentChip id="#QRM-78431" label="Kestrel canary seed read" level="warning" /><IncidentChip id="#QRM-78390" label="Threshold probe · Exchange B" level="idle" /></div></div>
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Timeline">
            <div className="px-5 pb-5">
              <VTimeline items={[
                { t: '14:01:52', title: 'Probing detected', body: 'Enumeration on decoy account DA-114', level: 'warning', actor: 'Patrol' },
                { t: '14:02:03', title: 'Request submitted', body: 'RB-310944 → Cosign REJECT', level: 'warning', actor: 'RequestBoard' },
                { t: '14:02:07', title: 'Trap triggered', body: 'Transfer into DW-07', level: 'threat', actor: 'Trap' },
                { t: '14:02:19', title: 'CRE verified', body: '7/7 nodes · evidence hash signed', level: 'active', actor: 'CRE' },
                { t: '14:02:31', title: 'Funds tightened', body: 'QuorumReceiver → QuorumVault, ColdVault', level: 'active', actor: 'Receiver' },
                { t: '14:02:38', title: 'ThreatRegistry updated', body: 'Entry #4,118', level: 'active' },
                { t: '14:02:44', title: 'Network alert shared', body: '36 / 38 members consumed', level: 'active' },
              ]} />
            </div>
          </Panel>
          <Panel title="Affected vaults" action={<Link to="/vaults" className="text-[12px] text-honey">Controls →</Link>}>
            <div className="px-5 pb-5 space-y-4">
              <Meter label={<>Hot Vault · quota <b className="text-amber font-medium">cleared</b></>} value={0.02} tone="amber" />
              <Meter label={<>Warm Vault · <b className="text-amber font-medium">cosign-only 6h</b></>} value={0.4} tone="amber" />
              <Meter label={<>Cold Vault · timelock <b className="text-amber font-medium">72h</b></>} value={0.85} />
              <p className="text-[12px] text-mute">Controlled tightening: vaults stay solvent and serviceable, and only the flow allowance is reduced.</p>
            </div>
          </Panel>
          <Panel title="ThreatRegistry update" className="bg-coal-3">
            <div className="px-5 pb-5">
              <div className="flex items-center justify-between"><span className="font-mono text-honey text-[15px]">#4,118</span><Badge status="threat">Confirmed</Badge></div>
              <div className="mt-2 font-mono text-[13px]">0x7a3f…91c2</div>
              <div className="mt-4"><Meter label="Members consumed" value={36 / 38} /></div>
              <Link to="/registry" className="inline-block mt-3 text-[12.5px] text-honey hover:text-flare">Open ThreatRegistry →</Link>
            </div>
          </Panel>
        </div>
      </div>

      <Modal open={escalate} onClose={() => setEscalate(false)} title="Escalate case #QRM-78452"
        footer={<><Button variant="ghost" onClick={() => setEscalate(false)}>Cancel</Button><Button onClick={() => setEscalate(false)}>Escalate to L2</Button></>}>
        Escalation notifies the on-call custody lead and opens a joint channel with Exchange A security. It does not relax or extend controls; those changes go through ConfigTimelock.
      </Modal>
    </div>
  )
}

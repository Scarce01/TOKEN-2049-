import { useState } from 'react'
import { Link } from 'react-router'
import { THREATS } from '../components/mock'
import { Button, DataTable, Drawer, Icon, Label, Meter, Metric, Mono, PageHeader, Panel, Row, StateBadge } from '../components/ui'

type T = (typeof THREATS)[number]
const EXP = ['29d 23h', '27d 04h', '12d 10h', '6d 02h', 'expired']
const exp = (t: T) => EXP[THREATS.indexOf(t) % EXP.length]
const ev = (t: T) => `0x${(t.id.replace(/\D/g, '') + 'c71d').slice(0, 4)}…0a92`

export default function Registry() {
  const [open, setOpen] = useState<T | null>(null)
  return (
    <div className="max-w-[1480px]">
      <PageHeader eyebrow="Network intelligence" title="ThreatRegistry"
        desc="When a threat is verified, it becomes reusable network intelligence. Each entry is CRE-signed, carries its own evidence, and is readable by every connected member's Cosign Workflow."
        actions={<><Button variant="secondary"><Icon name="download" size={15} />Export feed</Button><Button variant="secondary">Subscribe API</Button></>} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Active entries" value="4,118" sub="+3 in last 24h" status="active" />
        <Metric label="Newest" value="#4,118" sub="0x7a3f…91c2 · 14:02:38" status="threat" />
        <Metric label="Avg propagation" value="13.6s" sub="publish → member ack" status="active" />
        <Metric label="Blocked by reuse" value="$2.4M" sub="value stopped via registry matches · 30d" status="warning" />
      </div>
      <Panel>
        <DataTable rows={THREATS} rowKey={(t) => t.id} selected={open?.id} onSelect={setOpen} cols={[
          { key: 'id', label: 'Entry', render: (t) => <span className="font-mono text-honey">{t.id}</span> },
          { key: 'addr', label: 'Address', render: (t) => <Mono>{t.addr}</Mono> },
          { key: 'fp', label: 'Fingerprint', render: (t) => <span className="text-dim text-[12.5px]">{t.fp}</span> },
          { key: 'ev', label: 'Evidence', render: (t) => <Mono>{ev(t)}</Mono> },
          { key: 'src', label: 'Source', render: (t) => <span className="text-dim">{t.source}</span> },
          { key: 'cons', label: 'Consumed', render: (t) => <div className="w-28"><Meter value={t.consumed / t.of} /><div className="mt-1 font-mono text-[11px] text-mute">{t.consumed}/{t.of} · {t.scope}</div></div> },
          { key: 'seen', label: 'Last seen', render: (t) => <span className="font-mono text-[12px] text-dim">{t.seen}</span> },
          { key: 'x', label: 'Expires', render: (t) => <span className={`font-mono text-[12px] ${exp(t) === 'expired' ? 'text-mute' : 'text-dim'}`}>{exp(t)}</span> },
          { key: 's', label: 'State', render: (t) => <StateBadge state={t.state} /> },
        ]} />
      </Panel>

      <Drawer open={!!open} onClose={() => setOpen(null)} eyebrow={`ThreatRegistry ${open?.id ?? ''}`} title={<span className="font-mono">{open?.addr}</span>}
        footer={<><Button variant="secondary" onClick={() => setOpen(null)}>Close</Button><Link to={`/cases/${open?.case}`} className="inline-flex items-center h-9 px-4 rounded-md bg-honey text-ink text-[13px] font-semibold">Open case</Link></>}>
        {open && <div className="space-y-5">
          <div className="flex gap-2"><StateBadge state={open.state} /></div>
          <dl>
            <Row k="Fingerprint">{open.fp}</Row>
            <Row k="Confidence">{open.conf}</Row>
            <Row k="CRE nodes" mono>{open.nodes}</Row>
            <Row k="Source">{open.source}</Row>
            <Row k="Scope">{open.scope}</Row>
            <Row k="Case" mono>#{open.case}</Row>
            <Row k="Evidence" mono>{ev(open)} · blk 21,904,118</Row>
            <Row k="TTL / expiry" mono>{exp(open)} · renewed on re-match</Row>
            <Row k="Last seen" mono>{open.seen}</Row>
          </dl>
          <div><Label>Propagation</Label><div className="mt-2"><Meter label={`${open.consumed} of ${open.of} members consumed`} value={open.consumed / open.of} /></div></div>
          <p className="text-[12.5px] text-dim">Consuming members' Cosign Workflows reject transfers to this address automatically, and their Patrol Workflows track related clusters.</p>
        </div>}
      </Drawer>
    </div>
  )
}

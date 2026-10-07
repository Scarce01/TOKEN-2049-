import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { APPROVALS } from '../components/mock'
import { Button, DataTable, Label, Metric, Mono, PageHeader, Panel, Row, StateBadge } from '../components/ui'

type A = (typeof APPROVALS)[number]

export default function Approvals() {
  const [sel, setSel] = useState<A>(APPROVALS[0])
  const [params] = useSearchParams()
  const pid = params.get('id')
  useEffect(() => { const a = APPROVALS.find((x) => x.id === pid); if (a) setSel(a) }, [pid])

  return (
    <div className="max-w-[1480px]">
      <PageHeader eyebrow="Execution · operator quorum" title="Approvals"
        desc="Manual releases, freeze extensions and relaxations need 2 of 2 operator signatures. Relaxations also wait out the ConfigTimelock before they can be signed." />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Metric label="Pending signatures" value="1" sub="AP-0412 · 1 / 2" status="warning" />
        <Metric label="Queued behind timelock" value="1" sub="AP-0410 · 0 / 2" status="idle" />
        <Metric label="Verified · 24h" value="1" sub="Cold freeze extension" status="active" />
      </div>
      <div className="grid grid-cols-[1fr_380px] gap-5 items-start">
        <Panel>
          <DataTable rows={APPROVALS} rowKey={(a) => a.id} selected={sel.id} onSelect={setSel} cols={[
            { key: 'id', label: 'Approval', render: (a) => <Mono>{a.id}</Mono> },
            { key: 'a', label: 'Action', render: (a) => <div><div className="text-cream">{a.action}</div><div className="text-[11.5px] text-mute">{a.detail}</div></div> },
            { key: 'v', label: 'Vault', render: (a) => <span className="text-dim">{a.vault}</span> },
            { key: 'sig', label: 'Signatures', render: (a) => <span className={`font-mono ${a.signed.length >= a.required ? 'text-honey' : 'text-amber'}`}>{a.signed.length} / {a.required}</span> },
            { key: 'q', label: 'Queued', render: (a) => <span className="font-mono text-[12px] text-dim">{a.queued}</span> },
            { key: 'e', label: 'Expiry', render: (a) => <span className="font-mono text-[12px] text-dim">{a.expiry}</span> },
            { key: 's', label: 'State', render: (a) => <StateBadge state={a.state} /> },
          ]} />
        </Panel>
        <Panel className="p-5">
          <div className="flex items-center justify-between"><Label>{sel.action}</Label><StateBadge state={sel.state} /></div>
          <div className="mt-2 font-mono text-[18px] text-cream">{sel.id}</div>
          <div className="text-[13px] text-dim">{sel.detail}</div>
          <div className="mt-4 flex gap-1.5">
            {Array.from({ length: sel.required }, (_, i) => <div key={i} className={`flex-1 h-8 rounded grid place-items-center text-[12px] ${sel.signed[i] ? 'bg-honey text-ink font-medium' : 'border border-dashed border-honey/30 text-mute'}`}>{sel.signed[i] ?? 'awaiting'}</div>)}
          </div>
          <dl className="mt-3">
            <Row k="Required signatures" mono>{sel.signed.length} / {sel.required}</Row>
            <Row k="Linked action">{sel.action}</Row>
            <Row k="Linked vault">{sel.vault}</Row>
            <Row k="Queued" mono>{sel.queued}</Row>
            <Row k="Expiry" mono>{sel.expiry}</Row>
          </dl>
          {sel.state === 'Pending' && <div className="mt-4"><Button>Sign as operator</Button></div>}
          {sel.state === 'Queued' && <p className="mt-4 text-[12.5px] text-dim">Signing opens when the 48h ConfigTimelock ends.</p>}
        </Panel>
      </div>
    </div>
  )
}

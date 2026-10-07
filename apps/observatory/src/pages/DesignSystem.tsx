import { useState } from 'react'
import { Accordion, Badge, Button, DataTable, Drawer, EmptyState, IncidentChip, Label, Meter, Modal, NodeChip, PageHeader, Panel, Segmented, StateBadge, Tabs, VTimeline } from '../components/ui'

const SW = [['App background', '#0B0D10'], ['Sidebar / header', '#111318'], ['Card surface', '#14161B'], ['Elevated card', '#1B1D22'], ['Border', '#2A2618'], ['Primary yellow', '#FFC700'], ['Bright highlight', '#FCEF3C'], ['Amber', '#FCAD17'], ['Cream text', '#FFF1C1']]

export default function DesignSystem() {
  const [tab, setTab] = useState('Overview')
  const [seg, setSeg] = useState('Live')
  const [drawer, setDrawer] = useState(false)
  const [modal, setModal] = useState(false)
  return (
    <div className="max-w-[1280px] space-y-5">
      <PageHeader eyebrow="Foundations" title="Quorum Design System" desc="One warm palette. State is carried by brightness, glow, border style and icon shape, never by hue." />
      <Panel title="Palette"><div className="grid grid-cols-9 gap-3 p-5">{SW.map(([n, h]) => <div key={n}><div className="h-20 rounded-md border border-honey/15" style={{ background: h }} /><div className="mt-2 text-[13px]">{n}</div><div className="font-mono text-[11px] text-mute">{h}</div></div>)}</div></Panel>
      <div className="grid grid-cols-2 gap-5">
        <Panel title="Typography"><div className="p-5 space-y-2"><div className="text-[30px] font-semibold tracking-tight">Geist Semibold 30</div><div className="text-[16px]">Geist Regular 16: body copy</div><Label>Label · mono caps</Label><div className="font-mono text-[13px] text-honey">0x41e0…c2a7 · Geist Mono</div></div></Panel>
        <Panel title="Buttons & states"><div className="p-5 flex flex-wrap gap-3"><Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="ghost">Ghost</Button></div>
          <div className="px-5 pb-5 flex flex-wrap gap-2"><Badge status="idle">Idle</Badge><Badge status="active">Active</Badge><Badge status="warning">Warning</Badge><Badge status="threat">Threat</Badge>{['Queued', 'Applied', 'Frozen', 'Verified'].map((s) => <StateBadge key={s} state={s} />)}</div></Panel>
        <Panel title="Chips & meters"><div className="p-5 flex flex-wrap gap-2"><NodeChip name="Bybit" status="threat" /><NodeChip name="Cold Vault" status="active" /><IncidentChip id="QRM-78452" label="Decoy breach" level="threat" /></div><div className="px-5 pb-5 space-y-3"><Meter value={86} label="Confidence" /><Meter value={42} label="Quota used" tone="amber" /></div></Panel>
        <Panel title="Tabs & segmented"><div className="p-5 space-y-4"><Tabs tabs={['Overview', 'Audit log', 'Related']} value={tab} onChange={setTab} /><Segmented options={['Live', '24h', '7d']} value={seg} onChange={setSeg} /></div></Panel>
        <Panel title="Accordion"><Accordion items={[{ title: 'Cosign workflow', body: 'Co-signs legitimate withdrawals.' }, { title: 'Trap workflow', body: 'Verifies decoy touches.' }]} /></Panel>
        <Panel title="Timeline"><div className="p-5"><VTimeline items={[{ t: '14:02:07', title: 'Decoy touched', level: 'threat' }, { t: '14:02:19', title: 'Trap verified', level: 'warning' }, { t: '14:02:31', title: 'Vaults tightened', level: 'active' }]} /></div></Panel>
      </div>
      <Panel title="Table"><DataTable rows={[{ id: 'R-1', s: 'Pending' }, { id: 'R-2', s: 'Applied' }]} rowKey={(r) => r.id} cols={[{ key: 'id', label: 'ID', render: (r) => r.id }, { key: 's', label: 'State', render: (r) => <StateBadge state={r.s} /> }]} /></Panel>
      <div className="grid grid-cols-2 gap-5">
        <Panel title="Overlays"><div className="p-5 flex gap-3"><Button variant="secondary" onClick={() => setDrawer(true)}>Open drawer</Button><Button variant="secondary" onClick={() => setModal(true)}>Open modal</Button></div></Panel>
        <EmptyState title="No open cases" desc="The hive is quiet. Patrol is reconciling." />
      </div>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Drawer"><p className="text-dim text-[13px]">Side context for a row.</p></Drawer>
      <Modal open={modal} onClose={() => setModal(false)} title="Modal" footer={<Button onClick={() => setModal(false)}>Confirm</Button>}><p className="text-dim text-[13px]">Confirm an operator action.</p></Modal>
    </div>
  )
}

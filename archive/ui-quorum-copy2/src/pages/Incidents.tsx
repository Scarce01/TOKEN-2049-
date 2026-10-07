import { useState } from 'react'
import { useNavigate } from 'react-router'
import { DataTable, Metric, PageHeader, Panel, StateBadge, Tabs } from '../components/ui'

const TABS = ['Active', 'Investigating', 'Contained', 'Resolved'] as const
type Inc = { id: string; trigger: string; source: string; value: string; wf: string; response: string; ttc: string; owner: string; status: (typeof TABS)[number] }

const INCIDENTS: Inc[] = [
  { id: 'QRM-78452', trigger: 'Decoy wallet hit · DW-07', source: 'Exchange A', value: '$4.82B', wf: 'Trap', response: 'Hot 0 · Warm cosign-only · Cold 72h', ttc: '24s', owner: 'M. Kovač', status: 'Active' },
  { id: 'QRM-78453', trigger: 'Cluster retro-link · 2 hops', source: 'Patrol', value: '$166K', wf: 'Patrol', response: 'RB-310919 rejected · registry review', ttc: '—', owner: 'J. Ruiz', status: 'Investigating' },
  { id: 'QRM-78449', trigger: 'Decoy threshold probe · 49.9 ETH', source: 'Exchange A', value: '$130K', wf: 'Trap', response: 'Threshold rotated', ttc: '—', owner: 'A. Osei', status: 'Investigating' },
  { id: 'QRM-78431', trigger: 'Decoy credential read · DC-09', source: 'Kestrel Custody', value: '$212M', wf: 'Trap', response: 'Warm freeze 12h · registry #4,117', ttc: '31s', owner: 'J. Ruiz', status: 'Contained' },
  { id: 'QRM-78412', trigger: 'Flow anomaly · hot outflow', source: 'Exchange B', value: '$2.1M', wf: 'Patrol', response: 'Hot quota −50%', ttc: '1m 12s', owner: 'M. Kovač', status: 'Contained' },
  { id: 'QRM-78390', trigger: 'Decoy threshold probe', source: 'Exchange B', value: '$88K', wf: 'Trap', response: 'Registry #4,109 · relaxed after 48h', ttc: '19s', owner: 'A. Osei', status: 'Resolved' },
  { id: 'QRM-78301', trigger: 'Decoy API key replay', source: 'Meridian DAO', value: '$750K', wf: 'Trap', response: 'Proposal guard · entry expired', ttc: '27s', owner: 'J. Ruiz', status: 'Resolved' },
]

export default function Incidents() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Active')
  const nav = useNavigate()
  const rows = INCIDENTS.filter((i) => i.status === tab)
  return (
    <div className="max-w-[1480px]">
      <PageHeader eyebrow="Command center" title="Incidents" desc="Every verified trigger becomes an incident with its full path: request, verification, execution, vault response and network propagation." />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Active" value="1" sub="QRM-78452 · Exchange A" status="threat" />
        <Metric label="Investigating" value="2" sub="Patrol-linked follow-ups" status="warning" />
        <Metric label="Median time to contain · 30d" value="26s" sub="trigger → controls tightened" status="active" />
        <Metric label="Funds lost · 30d" value="$0" sub="across 11 contained incidents" />
      </div>
      <Panel>
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
        <DataTable rows={rows} rowKey={(r) => r.id} onSelect={(r) => nav(`/cases/${r.id}`)} cols={[
          { key: 'id', label: 'Incident', render: (r) => <span className="font-mono text-cream">#{r.id}</span> },
          { key: 't', label: 'Trigger', render: (r) => <span className="text-cream">{r.trigger}</span> },
          { key: 's', label: 'Source', render: (r) => <span className="text-dim">{r.source}</span> },
          { key: 'v', label: 'Affected value', align: 'right', render: (r) => <span className="tabular-nums text-cream">{r.value}</span> },
          { key: 'w', label: 'Workflow', render: (r) => <span className="text-dim">{r.wf}</span> },
          { key: 'r', label: 'Response', render: (r) => <span className="text-[12.5px] text-dim">{r.response}</span> },
          { key: 'ttc', label: 'Time to contain', render: (r) => <span className="font-mono text-[12px] text-cream">{r.ttc}</span> },
          { key: 'o', label: 'Owner', render: (r) => <span className="text-dim">{r.owner}</span> },
          { key: 'st', label: 'Status', render: (r) => <StateBadge state={r.status} /> },
        ]} />
      </Panel>
    </div>
  )
}

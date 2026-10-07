import { useNavigate } from 'react-router'
import { Kind } from '@hexmap/packages/shared/src/constants'
import { DataTable, Metric, PageHeader, Panel, StateBadge } from '../components/ui'
import { buildCases, readEvents, readLive, useLive, type Case } from '../live/chain'

// Incidents, live from the fork. A case is a CRE report and every tightening it applied, grouped by caseId.
const KIND_NAME = Object.fromEntries(Object.entries(Kind).map(([k, v]) => [v, k.toLowerCase().replace(/_/g, ' ')]))
const hhmmss = (t: number) => (t ? new Date(t * 1000).toISOString().slice(11, 19) : '--:--:--')
const short = (h: string) => `${h.slice(0, 8)}…`

function response(c: Case): string {
  const kinds = new Set<string>()
  for (const e of c.events) {
    if (e.name === 'Tightened') kinds.add(KIND_NAME[Number(e.args.kind)] ?? `kind ${e.args.kind}`)
    else if (e.name === 'QuotaZeroed') kinds.add('hot quota 0')
    else if (e.name === 'FreezeSet') kinds.add('warm frozen')
    else if (e.name === 'Swept') kinds.add('swept to cold')
    else if (e.name === 'DelayRaised') kinds.add('cold timelock +')
  }
  return [...kinds].slice(0, 4).join(' · ') || '—'
}

export default function Incidents() {
  const nav = useNavigate()
  const live = useLive(readLive, 6000)
  const events = useLive(readEvents, 6000)
  const now = live.data?.chainTime ?? 0
  // an incident is a case that tightened or published a threat; patrol checkpoint cases are not incidents
  const TIGHTEN = ['Tightened', 'QuotaZeroed', 'FreezeSet', 'Swept', 'AlertSet', 'DelayRaised', 'ThreatAdded']
  const cases = buildCases(events.data ?? []).filter((c) => c.events.some((e) => TIGHTEN.includes(e.name)))
  const active = cases.filter((c) => c.org && live.data?.orgs.find((o) => o.letter === c.org!.letter && o.alert > 0 && o.alertExpiresAt > now))
  const status = (c: Case) => (active.includes(c) ? 'Active' : 'Resolved')

  return (
    <div className="max-w-[1480px]">
      <PageHeader eyebrow="Command center" title="Incidents"
        desc="Every verified trap hit becomes a case with its full on-chain response: the CRE report and each tightening action it applied. Live from the Base Sepolia fork." />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Cases" value={events.data ? cases.length : '…'} sub="on chain since deployment" status="active" />
        <Metric label="Active" value={active.length} sub="alert still in force" status={active.length ? 'threat' : 'active'} />
        <Metric label="Threats published" value={(events.data ?? []).filter((e) => e.name === 'ThreatAdded').length} sub="to the shared registry" status="warning" />
        <Metric label="Funds lost" value="$0" sub="drains reverted at the vault" />
      </div>
      <Panel>
        {cases.length === 0 ? (
          <p className="px-5 py-8 text-[13px] text-mute">No cases on the fork yet. Run an attack from the Overview to create one.</p>
        ) : (
          <DataTable rows={cases} rowKey={(c) => c.caseId} onSelect={(c) => nav(`/cases/${c.caseId}`)} cols={[
            { key: 'id', label: 'Case', render: (c) => <span className="font-mono text-cream">{short(c.caseId)}</span> },
            { key: 's', label: 'Exchange', render: (c) => <span className="text-dim">{c.org?.name ?? '—'}</span> },
            { key: 'w', label: 'Workflow', render: () => <span className="text-dim">Trap</span> },
            { key: 'r', label: 'Response', render: (c) => <span className="text-[12.5px] text-dim">{response(c)}</span> },
            { key: 'b', label: 'Block', align: 'right', render: (c) => <span className="font-mono text-[12px] text-cream">{c.block.toLocaleString('en-US')}</span> },
            { key: 't', label: 'Time', align: 'right', render: (c) => <span className="font-mono text-[12px] text-mute">{hhmmss(c.time)}</span> },
            { key: 'st', label: 'Status', render: (c) => <StateBadge state={status(c)} /> },
          ]} />
        )}
      </Panel>
    </div>
  )
}

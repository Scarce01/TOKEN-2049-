import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Decision, Kind } from '@hexmap/packages/shared/src/constants'
import { Badge, DataTable, Mono, PageHeader, Panel, Row, StateBadge, Tabs } from '../components/ui'
import { buildCases, readEvents, readLive, tokenAmount, useLive, type ChainEvent } from '../live/chain'

const KIND_NAME = Object.fromEntries(Object.entries(Kind).map(([k, v]) => [v, k.toLowerCase().replace(/_/g, ' ')]))
const DEC = Object.fromEntries(Object.entries(Decision).map(([k, v]) => [v, k]))
const hhmmss = (t: number) => (t ? new Date(t * 1000).toISOString().slice(11, 19) : '--:--:--')
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`
const TABS = ['Execution', 'Audit log', 'Related'] as const

function label(e: ChainEvent): { a: string; d: string } {
  const g = e.args
  const amt = () => { const x = tokenAmount(g.token, g.amount); return `${x.value.toLocaleString('en-US', { maximumFractionDigits: x.sym === 'qETH' ? 3 : 0 })} ${x.sym}` }
  switch (e.name) {
    case 'AlertSet': return { a: 'Alert raised', d: `level ${g.level}` }
    case 'QuotaZeroed': return { a: 'Hot quota cleared', d: tokenAmount(g.token, 0n).sym }
    case 'FreezeSet': return { a: 'Warm vault frozen', d: `until block-time ${hhmmss(Number(g.until))}` }
    case 'Swept': return { a: 'Hot swept to cold', d: amt() }
    case 'DelayRaised': return { a: 'Cold timelock raised', d: `${Number(g.delay) / 3600}h` }
    case 'ThreatAdded': return { a: 'Threat published', d: short(String(g.suspect)) }
    case 'Tightened': return { a: 'Tightened', d: KIND_NAME[Number(g.kind)] ?? `kind ${g.kind}` }
    case 'ReportProcessed': return { a: 'CRE report processed', d: `kinds ${g.kinds}` }
    case 'VerdictRecorded': return { a: `Verdict ${DEC[Number(g.decision)] ?? g.decision}`, d: short(String(g.txHash)) }
    default: return { a: e.name, d: '' }
  }
}

export default function CaseDetail() {
  const { id = '' } = useParams()
  const [tab, setTab] = useState<(typeof TABS)[number]>('Execution')
  const events = useLive(readEvents, 6000)
  const live = useLive(readLive, 6000)
  const c = buildCases(events.data ?? []).find((x) => x.caseId === id)

  if (!c) {
    return (
      <div className="max-w-[1100px]">
        <PageHeader eyebrow="Incident" title="Case" desc="" />
        <Panel><p className="px-5 py-8 text-[13px] text-mute">{events.loading ? 'Loading…' : 'This case is not on the fork. It may have been reset. '}<Link to="/cases" className="text-honey hover:underline">Back to incidents</Link>.</p></Panel>
      </div>
    )
  }

  const actions = c.events.filter((e) => ['QuotaZeroed', 'FreezeSet', 'Swept', 'DelayRaised', 'AlertSet', 'ThreatAdded'].includes(e.name))
  const threat = c.events.find((e) => e.name === 'ThreatAdded')
  const now = live.data?.chainTime ?? 0
  const alertOn = !!live.data?.orgs.find((o) => o.letter === c.org?.letter && o.alert > 0 && o.alertExpiresAt > now)

  return (
    <div className="max-w-[1100px]">
      <PageHeader eyebrow={`Incident · ${c.org?.name ?? 'org'}`} title={<span className="flex items-center gap-3">Decoy wallet hit <Badge status="threat">Tightened</Badge>{alertOn ? <Badge status="warning">Alert active</Badge> : <Badge status="active">Expired</Badge>}</span>}
        desc="A decoy with no legitimate use was touched; its address is committed on chain in DecoyCommit, so any touch is deterministic evidence. The CRE Trap workflow verified it and sent one signed tightening report." />

      <div className="grid grid-cols-2 gap-4 mb-5">
        <Panel className="p-5">
          <Row k="Case" mono>{c.caseId}</Row>
          <Row k="Exchange">{c.org?.name ?? '—'} <span className="text-mute">· backend treated as untrusted</span></Row>
          <Row k="Block">{c.block.toLocaleString('en-US')} · {hhmmss(c.time)} UTC</Row>
          <Row k="Report tx" mono>{short(c.tx)}</Row>
        </Panel>
        <Panel className="p-5">
          <Row k="Verified by">CRE DON · on-chain receipt check + second source</Row>
          <Row k="Actions applied">{actions.length}</Row>
          <Row k="Threat">{threat ? <>{short(String(threat.args.suspect))} → <Link to="/registry" className="text-honey hover:underline">registry</Link></> : 'none'}</Row>
          <Row k="Funds lost">$0 · drain reverts at the vault</Row>
        </Panel>
      </div>

      <Panel>
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
        {tab === 'Execution' && (
          <DataTable rows={actions} rowKey={(e) => `${e.tx}:${e.logIndex}`} cols={[
            { key: 'a', label: 'Action', render: (e) => <span className="text-cream">{label(e).a}</span> },
            { key: 'd', label: 'Detail', render: (e) => <span className="text-dim text-[12.5px]">{label(e).d}</span> },
            { key: 'c', label: 'Contract', render: (e) => <span className="text-dim">{e.tier ? `${e.tier} vault` : e.name === 'ThreatAdded' ? 'ThreatRegistry' : e.name === 'DelayRaised' ? 'ColdVault' : 'QuorumReceiver'}</span> },
            { key: 'b', label: 'Block', align: 'right', render: (e) => <span className="font-mono text-[12px] text-mute">{e.block.toLocaleString('en-US')}</span> },
            { key: 's', label: '', align: 'right', render: () => <StateBadge state="Executed" /> },
          ]} />
        )}
        {tab === 'Audit log' && (
          <ul className="px-5 py-3 space-y-2">
            {c.events.map((e) => (
              <li key={`${e.tx}:${e.logIndex}`} className="grid grid-cols-[80px_1fr] gap-3 text-[12.5px]">
                <span className="font-mono text-mute">{hhmmss(e.time)}</span>
                <span className="text-cream">{label(e).a} <span className="text-dim">{label(e).d}</span></span>
              </li>
            ))}
          </ul>
        )}
        {tab === 'Related' && (
          <div className="px-5 py-4 space-y-2 text-[13px]">
            {threat ? <Row k="Suspect" mono>{String(threat.args.suspect)}</Row> : <p className="text-mute">No threat published for this case.</p>}
            <Row k="Report tx" mono>{c.tx}</Row>
            <p className="text-[12px] text-mute pt-2">Testnet fork, measured on chain.</p>
          </div>
        )}
      </Panel>
    </div>
  )
}

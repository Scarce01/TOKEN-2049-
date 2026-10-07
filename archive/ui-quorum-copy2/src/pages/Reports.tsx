import { useState } from 'react'
import { REPORTS } from '../components/mock'
import { Button, DataTable, Icon, Label, Mono, PageHeader, Panel, Segmented, StateBadge } from '../components/ui'

const KINDS = ['All', 'Incident', 'CRE', 'Receiver', 'Vault', 'Registry', 'Config'] as const
const MAP: Record<string, string> = { 'Case report': 'Incident', 'Onchain actions': 'Vault', 'Workflow logs': 'CRE', 'Change history': 'Config', Compliance: 'Receiver' }
const LOG = [
  { t: '14:15:44', id: 'R-78460', type: 'Config', src: 'Operators 2/2', wf: '—', act: 'ConfigTimelock.queue(CT-0194)', tx: '0x5a1e…77c0', s: 'Queued' },
  { t: '14:02:38', id: 'R-78455', type: 'Registry', src: 'Trap Workflow', wf: 'run-7f21', act: 'ThreatRegistry.publish(#4,118)', tx: '0x2f9c…b8e3', s: 'Executed' },
  { t: '14:02:32', id: 'R-78452', type: 'Vault', src: 'QuorumReceiver', wf: 'run-7f21', act: 'ColdVault.extendTimelock(72h)', tx: '0x0c5f…a991', s: 'Executed' },
  { t: '14:02:31', id: 'R-78452', type: 'Receiver', src: 'CRE DON', wf: 'run-7f21', act: 'QuorumVault.sweep(1,120 ETH)', tx: '0x9d3a…7f10', s: 'Executed' },
  { t: '14:02:19', id: 'R-78452', type: 'CRE', src: 'Trap Workflow', wf: 'run-7f21', act: '—', tx: '0xc71d…0a92', s: 'Verified' },
  { t: '14:02:04', id: 'R-78451', type: 'Incident', src: 'Cosign Workflow', wf: 'run-7f1e', act: 'QuorumVault.deny(RB-310944)', tx: '0x1c08…5b2e', s: 'Executed' },
]
const TRAIL = [
  { t: 'Oct 05 14:15:44', who: 'M. Kovač', what: 'config.proposed', obj: 'CT-0194', hash: '0x5a1e…77c0' },
  { t: 'Oct 05 14:05:10', who: 'M. Kovač', what: 'case.assigned', obj: '#QRM-78452', hash: '0x0b3c…e1d4' },
  { t: 'Oct 05 14:02:38', who: 'ThreatRegistry', what: 'entry.published', obj: '#4,118', hash: '0x2f9c…b8e3' },
  { t: 'Oct 05 14:02:31', who: 'QuorumReceiver', what: 'report.accepted', obj: 'report #78452', hash: '0x41e0…c2a7' },
  { t: 'Oct 05 14:02:19', who: 'CRE DON', what: 'workflow.trap.signed', obj: 'run-7f21', hash: '0xc71d…0a92' },
  { t: 'Oct 05 09:00:00', who: 'Patrol', what: 'reconciliation.ok', obj: '6 chains', hash: '0x93aa…14f2' },
]

export default function Reports() {
  const [k, setK] = useState<(typeof KINDS)[number]>('All')
  const [sel, setSel] = useState(REPORTS[0])
  const list = REPORTS.filter((r) => k === 'All' || MAP[r.kind] === k)
  const log = LOG.filter((r) => k === 'All' || r.type === k)
  return (
    <div className="max-w-[1480px]">
      <PageHeader eyebrow="Compliance & audit" title="Reports & Audit Trail" desc="Every report is assembled from signed workflow runs and onchain events. Each figure traces back to a transaction or a CRE signature."
        actions={<><Button variant="secondary"><Icon name="download" size={15} />Export CSV</Button><Button variant="secondary"><Icon name="download" size={15} />Export PDF</Button><Button>View onchain proof</Button></>} />
      <div className="mb-4"><Segmented options={KINDS} value={k} onChange={setK} /></div>
      <div className="grid grid-cols-[1fr_520px] gap-5 mb-5">
        <div className="grid grid-cols-2 gap-4 content-start">
          {list.map((r) => (
            <button key={r.id} onClick={() => setSel(r)} className={`text-left clip-hexcard p-5 border transition-colors ${sel.id === r.id ? 'bg-coal-3 border-white/10' : 'bg-coal-2 border-transparent hover:bg-coal-3'}`}>
              <div className="flex items-center justify-between"><Label>{MAP[r.kind] ?? r.kind}</Label><StateBadge state={r.state} /></div>
              <div className="mt-3 text-[15px] font-semibold text-cream">{r.title}</div>
              <div className="mt-3 flex gap-4 font-mono text-[11px] text-mute"><span>{r.id}</span><span>{r.period}</span><span>{r.pages} pp</span></div>
            </button>
          ))}
        </div>
        {/* Document preview */}
        <Panel className="bg-coal-3">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]"><span className="font-mono text-[12px] text-honey">{sel.id}</span><div className="flex gap-2"><Button variant="secondary"><Icon name="download" size={14} />PDF</Button><Button variant="secondary">JSON</Button></div></div>
          <article className="px-8 py-7">
            <div className="flex items-center gap-2 text-mute font-mono text-[10.5px] tracking-[0.16em] uppercase">Quorum · {sel.kind}</div>
            <h2 className="mt-2 text-[22px] font-semibold leading-snug">{sel.title}</h2>
            <div className="mt-1 text-[12px] text-dim">Period {sel.period} · generated Oct 05 2026 14:20 UTC</div>
            <hr className="my-5 border-honey/15" />
            <h3 className="text-[13px] font-semibold text-honey">1. Summary</h3>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-cream/85">A high-confidence decoy (DW-07) was touched at Exchange A. Trap Workflow verified the event on 7 of 7 CRE nodes, and QuorumReceiver applied four tightening directives within 24 seconds of the first probe. No user funds left protected vaults.</p>
            <h3 className="mt-5 text-[13px] font-semibold text-honey">2. Onchain actions</h3>
            <table className="mt-2 w-full text-[12.5px]"><tbody>
              {[['QuorumVault', 'hot.quota → 0', '0x41e0…c2a7'], ['QuorumVault', 'sweep 1,120 ETH → cold', '0x9d3a…7f10'], ['ColdVault', 'timelock 24h → 72h', '0x0c5f…a991'], ['ThreatRegistry', 'publish #4,118', '0x2f9c…b8e3']].map((r) => <tr key={r[2]} className="border-b border-white/[0.05]"><td className="py-1.5 text-dim">{r[0]}</td><td className="py-1.5 text-cream">{r[1]}</td><td className="py-1.5 text-right font-mono text-dim">{r[2]}</td></tr>)}
            </tbody></table>
            <h3 className="mt-5 text-[13px] font-semibold text-honey">3. Attestation</h3>
            <p className="mt-1.5 font-mono text-[11.5px] text-dim">sha256 9f2c…e71a · signed by CRE signer set v12 · anchored blk 21,904,201</p>
          </article>
        </Panel>
      </div>
      <Panel title="Report ledger">
        <DataTable rows={log} rowKey={(r) => r.t + r.type} cols={[
          { key: 't', label: 'Time', render: (r) => <span className="font-mono text-[12px] text-dim">{r.t}</span> },
          { key: 'id', label: 'Report ID', render: (r) => <span className="font-mono text-cream">{r.id}</span> },
          { key: 'ty', label: 'Type', render: (r) => <span className="text-cream">{r.type}</span> },
          { key: 'src', label: 'Source', render: (r) => <span className="text-dim">{r.src}</span> },
          { key: 'wf', label: 'Workflow', render: (r) => <Mono>{r.wf}</Mono> },
          { key: 'a', label: 'Onchain action', render: (r) => <span className="text-[12.5px] text-dim">{r.act}</span> },
          { key: 'tx', label: 'Tx / Proof', render: (r) => <Mono>{r.tx}</Mono> },
          { key: 's', label: 'Status', render: (r) => <StateBadge state={r.s} /> },
        ]} />
      </Panel>
    </div>
  )
}

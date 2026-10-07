import { useNavigate } from 'react-router'
import { Kind } from '../shared/constants'
import { DataTable, Metric, PageHeader, Panel, StateBadge } from '../components/ui'
import { buildCases, CHAIN_LABEL, readEvents, readLive, useLive, type Case } from '../live/chain'
import { CASES, proves } from './Replay'

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
        desc={`Every verified trap hit becomes a case with its full on-chain response: the CRE report and each tightening action it applied. Live from ${CHAIN_LABEL}.`} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Cases" value={events.data ? cases.length : '…'} sub="on chain since deployment" status="active" />
        <Metric label="Active" value={active.length} sub="alert still in force" status={active.length ? 'threat' : 'active'} />
        <Metric label="Threats published" value={(events.data ?? []).filter((e) => e.name === 'ThreatAdded').length} sub="to the shared registry" status="warning" />
        <Metric label="Funds lost" value="$0" sub="drains reverted at the vault" />
      </div>
      {/* historical attacks replayed against public on-chain data (known ground truth, not live) */}
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-mute">Public on-chain · replay</div>
          <h2 className="mt-1 text-[18px] font-semibold text-cream">Incident Replay</h2>
          <p className="text-[13px] text-dim">Historical attacks replayed against public on-chain data.</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4 mb-4">
        {CASES.map((r) => (
          <button key={r.id} onClick={() => nav(`/cases/replay/${r.id}/incident`)} className="text-left">
            <Panel className="px-5 py-4 hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center justify-between"><span className="text-[15px] font-semibold text-cream">{r.exchange}</span><span className="font-mono text-[10.5px] tracking-[0.12em] text-honey">REPLAY</span></div>
              <div className="mt-2 text-[24px] font-semibold tabular-nums text-cream">{r.recovered} / {r.truthSize}</div>
              <div className="text-[12px] text-dim">Known attacker wallets recovered</div>
              <div className="mt-2 font-mono text-[12px] text-cream">{r.topN} / {r.truthSize} <span className="text-dim font-sans">top-{r.truthSize} precision</span></div>
              {r.ethOnly && <div className="font-mono text-[12px] text-cream">{r.ethOnly.recovered} / {r.truthSize} <span className="text-dim font-sans">Ethereum-only</span></div>}
              <p className="mt-2 text-[11.5px] leading-snug text-mute line-clamp-3">{proves(r)}</p>
            </Panel>
          </button>
        ))}
      </div>
      <Panel title="Historical cases" className="mb-8">
        <DataTable rows={CASES} rowKey={(r) => r.id} onSelect={(r) => nav(`/cases/replay/${r.id}/incident`)} cols={[
          { key: 'c', label: 'Case', render: (r) => <span className="font-mono text-cream whitespace-nowrap">{r.id}</span> },
          { key: 'e', label: 'Exchange', render: (r) => <span className="text-dim">{r.exchange}</span> },
          { key: 'w', label: 'When', render: (r) => <span className="font-mono text-[12px] text-dim whitespace-nowrap">{r.when}</span> },
          { key: 'g', label: 'Ground truth', render: (r) => <span className="text-[12.5px] text-dim">{r.groundTruth}</span> },
          { key: 'r', label: 'Recovered', align: 'right', render: (r) => <span className="font-mono text-cream">{r.recovered} / {r.truthSize}</span> },
          { key: 'p', label: 'Top-N precision', align: 'right', render: (r) => <span className="font-mono text-cream">{r.topN} / {r.truthSize}</span> },
          { key: 'n', label: 'Candidates', align: 'right', render: (r) => <span className="font-mono text-cream">{r.candidates.toLocaleString('en-US')}</span> },
          { key: 's', label: 'Status', render: () => <span className="font-mono text-[11px] tracking-[0.12em] text-honey">REPLAY</span> },
        ]} />
      </Panel>
      <Panel title={`Live cases · ${CHAIN_LABEL}`}>
        {cases.length === 0 ? (
          <p className="px-5 py-8 text-[13px] text-mute">No cases on {CHAIN_LABEL} yet. Run an attack from the Overview to create one.</p>
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

      <p className="mt-3 text-[11px] text-mute">Replays: public on-chain transfers, scored against published ground truth (analysis/trace_bybit). Live cases: testnet fork, measured.</p>
    </div>
  )
}

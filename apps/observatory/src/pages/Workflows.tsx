import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { RUNS, WORKFLOWS } from '../components/mock'
import { Accordion, Badge, DataTable, Drawer, Icon, Label, Metric, Mono, PageHeader, Panel, Row, Segmented, StateBadge, Tabs, useDeepFocus } from '../components/ui'

const F = ['All', 'Trap', 'Cosign', 'Patrol'] as const
const TABS = ['Cosign', 'Trap', 'Patrol'] as const

const NODE_IDS = ['n1 · Kraken-CRE', 'n2 · Figment', 'n3 · LinkPool', 'n4 · Chorus', 'n5 · Fiews', 'n6 · Inotel', 'n7 · Simply VC']

function Advanced({ wf, checks }: { wf: string; checks: readonly string[] }) {
  return (
    <div className="grid grid-cols-[1fr_1fr] gap-6 pt-1">
      <div className="space-y-4">
        <dl>
          <Row k="Workflow ID" mono>{wf.toLowerCase()}.v3 · 0x7d1e…a40b</Row>
          <Row k="Evidence hash" mono>0xc71d…0a92</Row>
          <Row k="DecoyCommit" mono>{wf === 'Trap' ? 'DW-07 · 0xc71d…0a92 ✓' : 'not used'}</Row>
          <Row k="Signer set" mono>v12 · threshold 5 of 7</Row>
          <Row k="Metadata" mono>don=quorum-main · blk 21,904,201</Row>
        </dl>
        <div>
          <div className="text-[12px] text-mute mb-1.5">Per-node checks</div>
          <div className="grid grid-cols-7 gap-1.5">
            {NODE_IDS.map((n, i) => (
              <div key={n} title={n} className={`h-14 rounded-md grid place-items-center text-center ${wf === 'Patrol' && i === 5 ? 'border border-dashed border-amber/60' : 'bg-honey/[0.07]'}`}>
                <div><div className={`text-[13px] ${wf === 'Patrol' && i === 5 ? 'text-amber' : 'text-honey'}`}>{wf === 'Patrol' && i === 5 ? '…' : '✓'}</div><div className="font-mono text-[10px] text-mute">n{i + 1}</div></div>
              </div>
            ))}
          </div>
          <ul className="mt-3 space-y-1 text-[12.5px] text-dim">{checks.map((c) => <li key={c}>· {c}</li>)}</ul>
        </div>
      </div>
      <pre className="p-4 rounded-md bg-ink font-mono text-[11.5px] leading-[1.7] text-cream/85 overflow-x-auto">{`{
  "workflow": "${wf.toLowerCase()}.v3",
  "report": "#78452",
  "evidence": "0xc71d…0a92",
  "verdict": "${wf === 'Trap' ? 'TIGHTEN' : wf === 'Cosign' ? 'REJECT' : 'TRACK'}",
  "signatures": 7,
  "threshold": 5,
  "directives": ${wf === 'Trap' ? `[
    "hot.quota=0",
    "hot.sweep=cold:1120",
    "warm.mode=cosign_only:6h",
    "cold.timelock=72h",
    "registry.publish=0x7a3f…91c2"
  ]` : '[]'}
}`}</pre>
    </div>
  )
}

const HEALTH: Record<(typeof TABS)[number], { ok: string; fails: string; err: string; retry: string; delay: string; warn?: string }> = {
  Trap: { ok: '14:02:19 UTC', fails: '0 · 24h', err: '—', retry: '—', delay: '0.4s' },
  Cosign: { ok: '14:02:41 UTC', fails: '0 · 24h', err: '—', retry: '—', delay: '0.2s' },
  Patrol: { ok: '14:00:00 UTC', fails: '1 · 24h', err: 'run-7f19 · n6 timeout fetching Arbitrum trace', retry: '14:03:00 UTC', delay: '2m 41s', warn: 'DELAYED · missed run > 2m · 1 failure' },
}

export default function Workflows() {
  const [run, setRun] = useState<(typeof RUNS)[number] | null>(null)
  const [f, setF] = useState<(typeof F)[number]>('All')
  const [tab, setTab] = useState<(typeof TABS)[number]>('Trap')
  const [params] = useSearchParams()
  const pt = params.get('tab'), view = params.get('view')
  useEffect(() => { const t = TABS.find((x) => x.toLowerCase() === pt?.toLowerCase()); if (t) setTab(t) }, [pt])
  const health = useDeepFocus(view === 'health', tab)
  const h = HEALTH[tab]
  const w = WORKFLOWS.find((x) => x.name.startsWith(tab))!
  const last = RUNS.find((r) => r.wf === tab)
  const rows = RUNS.filter((r) => f === 'All' || r.wf === f)

  return (
    <div className="max-w-[1480px]">
      <PageHeader eyebrow="Verification layer · Chainlink CRE" title="CRE Workflows"
        desc="Three separate workflows, each run independently by the CRE DON. Every node re-fetches the evidence itself, so a compromised exchange backend can't forge a verdict." />

      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="DON health" value="7 / 7" sub="threshold 5 · signer set v12" status="active" />
        <Metric label="Runs · 24h" value="12,294" sub="Cosign 9,412 · Patrol 2,880 · Trap 2" status="active" />
        <Metric label="Last verification" value="14:02:41" sub="Cosign · RB-310946" status="idle" />
        <Metric label="Reports to Receiver" value="3" sub="1 tightening · 2 permits" status="warning" />
      </div>

      <div className="mb-5">
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
      </div>
      <div className="grid grid-cols-[1fr_380px] gap-5 mb-5">
        <Panel className="p-6">
          <div className="flex items-center justify-between"><Label>{w.trigger}</Label><StateBadge state={w.status} /></div>
          <div className="mt-2 text-[22px] font-semibold">{w.name}</div>
          <div className={`mt-1.5 text-[14px] ${w.id === 'trap' ? 'text-wax' : 'text-cream/90'}`}>{w.conclusion}</div>
          <div className="mt-6 grid grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
            <div className="p-4 rounded-md border border-honey/15"><Label>Input</Label><ul className="mt-2 space-y-1.5 font-mono text-[12px] text-cream">{w.inputs.map((c) => <li key={c}>{c}</li>)}</ul></div>
            <div className="grid place-items-center text-honey"><Icon name="arrow" size={18} /></div>
            <div className="p-4 rounded-md border border-honey/40 bg-honey/[0.04]"><Label>Output</Label><ul className="mt-2 space-y-1.5 font-mono text-[12px] text-honey">{w.outputs.map((c) => <li key={c}>→ {c}</li>)}</ul></div>
          </div>
        </Panel>
        <Panel className="p-5">
          <Label>Run status</Label>
          <dl className="mt-2">
            <Row k="Last run" mono>{w.last} UTC</Row>
            <Row k="Verification">{last ? <StateBadge state={last.state} /> : '—'}</Row>
            <Row k="CRE nodes" mono>{last?.nodes ?? '—'} · threshold 5</Row>
            <Row k="Timing" mono>p50 {w.p50}</Row>
            <Row k="Latest verdict">{last?.result ?? '—'}</Row>
            <Row k="Report" mono>{last?.ref ?? '—'}</Row>
            <Row k="Latest incident">{w.cases.length ? w.cases.map((c) => <Link key={c} to={`/cases/${c}`} className="font-mono text-honey hover:text-flare mr-2">#{c}</Link>) : <span className="text-mute">none</span>}</Row>
          </dl>
          <div className="mt-4 pt-4 border-t border-white/[0.06] text-[12.5px] text-dim">Signed output goes to <Link to="/execution" className="text-honey hover:text-flare">QuorumReceiver</Link>. The workflow itself never moves funds.</div>
        </Panel>
      </div>

      <div ref={health.ref} className={`mb-5 scroll-mt-4 rounded-lg transition-shadow ${health.ring}`}>
        <Panel title={`Health / Run history · ${w.name}`} action={h.warn ? <span className="font-mono text-[11.5px] text-amber">{h.warn}</span> : <span className="font-mono text-[11.5px] text-honey">HEALTHY</span>}>
          <div className={`grid ${tab === 'Patrol' ? 'grid-cols-[1fr_1fr]' : 'grid-cols-1'} gap-5 px-5 pb-5`}>
            <dl className={h.warn ? 'pl-3 border-l-2 border-amber' : ''}>
              <Row k="Last successful run" mono>{h.ok}</Row>
              <Row k="Failure count" mono><span className={h.warn ? 'text-amber' : ''}>{h.fails}</span></Row>
              <Row k="Last error">{h.err}</Row>
              <Row k="Next retry" mono>{h.retry}</Row>
              <Row k="Execution delay" mono><span className={h.warn ? 'text-amber' : ''}>{h.delay}</span></Row>
            </dl>
            {tab === 'Patrol' && (
              <div className="p-4 rounded-md border border-amber/30">
                <Label>Latest patrol run</Label>
                <dl className="mt-1">
                  <Row k="Run time" mono>14:02:30 UTC · run-7f20</Row>
                  <Row k="Checks performed">Flow vs quota · 6-chain reconciliation · cluster tracking · ack sweep</Row>
                  <Row k="Anomaly found"><span className="text-amber">Cold Vault conservation Δ -8 ETH</span></Row>
                  <Row k="Related checkpoint"><Link to="/vaults?vault=cold&section=reconciliation" className="font-mono text-honey hover:text-flare">recon #2290 · blk 21,904,201</Link></Row>
                  <Row k="Resulting action">Anomaly report filed · cold releases held pending review</Row>
                </dl>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <Panel className="mb-5">
        <Accordion defaultOpen={-1} items={[{ title: 'Advanced verification', meta: <span className="text-[12px] text-mute">evidence · signer set · raw report · per-node checks</span>, body: <Advanced wf={tab} checks={w.checks} /> }]} />
      </Panel>

      <Panel>
        <div className="flex items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-4"><Label>Run log</Label><Segmented options={F} value={f} onChange={setF} /></div>
          <span className="font-mono text-[11px] text-mute">signed reports · verifiable onchain</span>
        </div>
        <DataTable rows={rows} rowKey={(r) => r.id} selected={run?.id} onSelect={setRun} cols={[
          { key: 'id', label: 'Run', render: (r) => <Mono>{r.id}</Mono> },
          { key: 'wf', label: 'Workflow', render: (r) => <Badge status={r.wf === 'Trap' ? 'threat' : r.wf === 'Cosign' ? 'active' : 'idle'}>{r.wf}</Badge> },
          { key: 't', label: 'Started', render: (r) => <span className="font-mono text-[12px] text-dim">{r.t}</span> },
          { key: 'dur', label: 'Duration', render: (r) => <span className="font-mono text-[12px] text-dim">{r.dur}</span> },
          { key: 'nodes', label: 'Nodes agreed', render: (r) => <span className={`font-mono ${r.nodes === '7/7' ? 'text-cream' : 'text-amber'}`}>{r.nodes}</span> },
          { key: 'res', label: 'Conclusion', render: (r) => <span className="font-medium text-cream">{r.result}</span> },
          { key: 'ref', label: 'Subject', render: (r) => <span className="text-dim">{r.ref}</span> },
          { key: 's', label: 'Verification', render: (r) => <StateBadge state={r.state} /> },
        ]} />
      </Panel>
      <Drawer open={!!run} onClose={() => setRun(null)} eyebrow={`${run?.wf ?? ''} Workflow · ${run?.t ?? ''} UTC`} title={<span className="font-mono">{run?.id}</span>}>
        {run && <div className="space-y-4">
          <dl>
            <Row k="Verdict">{run.result}</Row>
            <Row k="Subject" mono>{run.ref}</Row>
            <Row k="Nodes agreed" mono>{run.nodes}</Row>
            <Row k="Duration" mono>{run.dur}</Row>
            <Row k="Verification"><StateBadge state={run.state} /></Row>
          </dl>
          <Advanced wf={run.wf} checks={WORKFLOWS.find((x) => x.name.startsWith(run.wf))!.checks} />
        </div>}
      </Drawer>
    </div>
  )
}

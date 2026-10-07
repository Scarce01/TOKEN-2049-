import { useSearchParams } from 'react-router'
import { useState } from 'react'
import { CONFIG_CHANGES } from '../components/mock'
import { Accordion, Badge, Button, DataTable, Icon, Label, Metric, Modal, Mono, PageHeader, Panel, Row, StateBadge, useDeepFocus } from '../components/ui'

const POLICIES = [
  { title: 'Vault policy · Hot', rules: [['hot.quota', '0 ETH / 24h', 'tightened'], ['hot.sweep.target', 'Cold Vault', ''], ['hot.review_band', 'hidden · rotates 72h', '']] },
  { title: 'Vault policy · Warm', rules: [['warm.mode', 'cosign_only (6h)', 'tightened'], ['warm.quota', '6,000 ETH / 24h', ''], ['warm.freeze.max', '12h', '']] },
  { title: 'Vault policy · Cold', rules: [['cold.timelock', '72h', 'tightened'], ['cold.release.signers', '4 of 7', '']] },
  { title: 'Tightening thresholds · Trap', rules: [['trap.min_nodes', '5 of 7', ''], ['trap.decoy_confidence', 'deterministic only', ''], ['trap.auto_registry', 'enabled', '']] },
  { title: 'Operator approvals', rules: [['tighten.signers', '2 of 3 · immediate', ''], ['relax.signers', '2 of 3 + 48h timelock', ''], ['policy.admin', 'ConfigTimelock (no EOA)', '']] },
]

const INTEGRITY = [
  { id: 'hot', name: 'Hot', exp: '0x4be1…09c3', cur: '0x4be1…09c3', keys: '—', t: 'Oct 05 14:02', by: 'Trap Workflow (CRE)', lock: 'Applied · fast-path', drift: false },
  { id: 'warm', name: 'Warm', exp: '0x91f0…2ad7', cur: '0x91f0…7e14', keys: 'warm.freeze.max (12h ≠ 6h proposal), warm.quota', t: 'Oct 05 14:06', by: 'unknown · not via ConfigTimelock', lock: 'No queued proposal', drift: true },
  { id: 'cold', name: 'Cold', exp: '0xc3d2…5f80', cur: '0xc3d2…5f80', keys: '—', t: 'Oct 05 14:02', by: 'Trap Workflow (CRE)', lock: 'Applied · fast-path', drift: false },
]

export default function Config() {
  const [propose, setPropose] = useState(false)
  const [params] = useSearchParams()
  const pol = params.get('policy')
  const integ = useDeepFocus(!!pol, pol ?? '')
  return (
    <div className="max-w-[1480px]">
      <PageHeader eyebrow="Governance · ConfigTimelock" title="Config & Policy"
        desc="Policy can't be edited on the spot. Tightening takes effect at once. Every relaxation is proposed, co-signed and delayed in ConfigTimelock, so a compromised operator or backend can't quietly open the vaults."
        actions={<Button onClick={() => setPropose(true)}><Icon name="plus" size={15} />Propose change</Button>} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Relax delay" value="48h" sub="all vault & threshold relaxations" status="active" />
        <Metric label="Queued" value="1" sub="CT-0194 · unlocks Oct 07 14:15" status="warning" />
        <Metric label="Applied · 30d" value="27" sub="22 tighten · 5 relax" status="idle" />
        <Metric label="Rejected · 30d" value="2" sub="cancelled during delay" status="idle" />
      </div>

      <Panel className="mb-5 px-6 py-5 flex items-center justify-between">
        <div className="text-[22px] font-semibold tracking-[0.04em]"><span className="text-honey">TIGHTEN IMMEDIATELY.</span> <span className="text-cream">RELAX DELIBERATELY.</span></div>
        <div className="flex gap-6 text-[12.5px] text-dim"><span><b className="text-cream font-medium">Tighten</b> · CRE or 2/3 operators · instant</span><span><b className="text-cream font-medium">Relax</b> · 2/3 + 48h ConfigTimelock · cancellable</span></div>
      </Panel>

      <h2 className="mb-3 text-[15px] font-semibold text-cream">Pending relaxations</h2>
      <Panel className="mb-6 p-5">
        <div className="flex items-center justify-between"><div className="flex items-baseline gap-3"><span className="font-mono text-honey">CT-0194</span><span className="text-[16px] font-semibold">Relax hot.quota</span></div><Badge status="warning">Queued</Badge></div>
        <div className="mt-4 grid grid-cols-[1fr_1fr_1fr_1fr] gap-5 text-[12.5px]">
          <div><Label>Proposer</Label><div className="mt-1 text-cream">M. Kovač</div></div>
          <div><Label>Co-signers</Label><div className="mt-1 text-cream">J. Ruiz · 2 of 3</div></div>
          <div><Label>ETA</Label><div className="mt-1 font-mono text-amber">Oct 07 14:15 · 47h 12m</div></div>
          <div><Label>Linked incident</Label><div className="mt-1 font-mono text-cream">#QRM-78452</div></div>
        </div>
        <div className="mt-4 grid grid-cols-[1fr_1fr] gap-5">
          <div><Label>Diff</Label><pre className="mt-1.5 p-3 bg-ink font-mono text-[12px] leading-relaxed"><span className="text-mute">  hot.quota:</span>{'\n'}<span className="text-amber">-   0 ETH / 24h</span>{'\n'}<span className="text-honey">+   800 ETH / 24h</span></pre></div>
          <div><Label>Reason</Label><p className="mt-1.5 text-[13px] text-dim">Attacker cluster isolated and registry entry #4,118 consumed by 36/38 members. Restore partial hot liquidity for withdrawals queue.</p></div>
        </div>
        <div className="mt-4 h-1.5 bg-coal-3 overflow-hidden"><div className="h-full w-[2%] bg-amber" /></div>
        <div className="mt-4 flex gap-2"><Button variant="secondary">Cancel proposal</Button></div>
      </Panel>

      <div ref={integ.ref} className={`mb-6 scroll-mt-4 rounded-lg transition-shadow ${integ.ring}`}>
        <Panel title="Config integrity" action={<span className="font-mono text-[11px] text-dim">onchain configHash vs ConfigTimelock record</span>}>
          <div className="grid grid-cols-3 gap-4 px-5 pb-5">
            {INTEGRITY.map((c) => (
              <div key={c.id} className={`p-4 rounded-md border ${c.drift ? 'border-amber/50 bg-amber/[0.05]' : pol === c.id ? 'border-honey/60' : 'border-honey/15'}`}>
                <div className="flex items-center justify-between"><span className="text-[14px] font-semibold text-cream">{c.name} Vault</span>{c.drift ? <Badge status="warning">CONFIG DRIFT</Badge> : <Badge status="active">Match</Badge>}</div>
                <dl className="mt-2">
                  <Row k="Expected" mono>{c.exp}</Row>
                  <Row k="Current" mono><span className={c.drift ? 'text-amber' : ''}>{c.cur}</span></Row>
                  <Row k="Changed keys">{c.drift ? <span className="text-amber">{c.keys}</span> : c.keys}</Row>
                  <Row k="Timestamp" mono>{c.t}</Row>
                  <Row k="Proposer">{c.by}</Row>
                  <Row k="Timelock">{c.lock}</Row>
                </dl>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-[440px_1fr] gap-5">
        <Panel title="Current policy">
          <Accordion items={POLICIES.map((p) => ({
            title: p.title, meta: p.rules.some((r) => r[2]) ? <Badge status="warning">Tightened</Badge> : <Icon name="lock" size={15} className="text-mute" />,
            body: <dl className="space-y-2">{p.rules.map(([k, v, s]) => <div key={k} className="flex justify-between gap-3"><dt className="font-mono text-[12px] text-dim">{k}</dt><dd className={`font-mono text-[12px] ${s ? 'text-amber' : 'text-cream'}`}>{v}</dd></div>)}</dl>,
          }))} />
        </Panel>
        <Panel title="Change history">
          <DataTable rows={CONFIG_CHANGES} rowKey={(c) => c.id} cols={[
            { key: 'id', label: 'Change', render: (c) => <div><div className="font-mono text-honey">{c.id}</div><div className="font-mono text-[11px] text-mute">{c.t}</div></div> },
            { key: 'k', label: 'Key', render: (c) => <Mono>{c.key}</Mono> },
            { key: 'd', label: 'From → to', render: (c) => <span className="font-mono text-[12px]"><span className="text-mute">{c.from}</span> → <span className="text-cream">{c.to}</span></span> },
            { key: 'by', label: 'Authority', render: (c) => <span className="text-dim">{c.by}</span> },
            { key: 'p', label: 'Path', render: (c) => <span className="text-[12px] text-dim">{c.path}</span> },
            { key: 's', label: 'State', render: (c) => <StateBadge state={c.state} /> },
          ]} />
        </Panel>
      </div>

      <Modal open={propose} onClose={() => setPropose(false)} title="Propose a policy change"
        footer={<><Button variant="ghost" onClick={() => setPropose(false)}>Cancel</Button><Button onClick={() => setPropose(false)}>Submit to timelock</Button></>}>
        <div className="space-y-3">
          <label className="block"><span className="text-[12px] text-mute">Policy key</span><input defaultValue="hot.quota" className="mt-1 w-full h-10 px-3 rounded-md bg-ink border border-honey/20 font-mono text-[13px] text-cream outline-none focus:border-honey" /></label>
          <label className="block"><span className="text-[12px] text-mute">New value</span><input defaultValue="1,200 ETH / 24h" className="mt-1 w-full h-10 px-3 rounded-md bg-ink border border-honey/20 font-mono text-[13px] text-cream outline-none focus:border-honey" /></label>
          <div className="flex items-center gap-2"><Badge status="warning">Relaxation · 48h delay</Badge><span className="text-[12px] text-mute">needs 1 more co-signer</span></div>
        </div>
      </Modal>
    </div>
  )
}

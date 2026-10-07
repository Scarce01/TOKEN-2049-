import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { DECOYS, type Decoy } from '../components/mock'
import { Flow, IsoHex } from '../components/Iso'
import { Badge, Button, DataTable, Icon, Label, Meter, Metric, Modal, Mono, PageHeader, Panel, Row, Segmented, StateBadge, VTimeline, type Status } from '../components/ui'

const TYPES = ['All', 'Wallet', 'Account', 'Address', 'API key', 'Threshold', 'Credential'] as const
const lvl = (d: Decoy): Status => (d.state === 'Triggered' ? 'threat' : d.state === 'Rotating' ? 'warning' : d.state === 'Armed' ? 'active' : 'idle')
const ROTATION: Record<Decoy['type'], string> = { Wallet: 'Rotate after any touch · 90d max', Account: '60d · on touch', Address: '30d', 'API key': '45d', Threshold: '7d · randomized band', Credential: '90d · canary refresh' }
const conf = (d: Decoy) => (d.hits ? (d.type === 'Account' ? 'High · enumeration' : 'Deterministic') : '—')
const CODE: Record<Decoy['type'], string> = { Wallet: 'W', Account: 'AC', Address: 'AD', 'API key': 'K', Threshold: 'T', Credential: 'C' }

// Honeycomb placement: Exchange A district on the left, Exchange B on the right
const SLOT: Record<string, [number, number]> = { 'DW-07': [2, 1], 'DA-114': [1, 1], 'DX-21': [2, 2], 'DK-03': [3, 1], 'DT-02': [1, 2], 'DW-02': [3, 2], 'DC-09': [6, 1], 'DW-11': [6, 2] }
const pos = ([c, r]: [number, number]): [number, number] => [80 + c * 92, 70 + r * 76 + (c % 2) * 38]

export default function Traps() {
  const [type, setType] = useState<(typeof TYPES)[number]>('All')
  const [sel, setSel] = useState<Decoy>(DECOYS[0])
  const [params] = useSearchParams()
  const pd = params.get('decoy')
  useEffect(() => { const d = DECOYS.find((x) => x.id === pd); if (d) { setSel(d); setType('All') } }, [pd])
  const [hover, setHover] = useState<string | null>(null)
  const [deploy, setDeploy] = useState(false)
  const rows = DECOYS.filter((d) => type === 'All' || d.type === type)

  return (
    <div className="max-w-[1480px]">
      <PageHeader eyebrow="Defensive lure infrastructure" title="Traps & Decoys"
        desc="Decoys are planted on purpose: wallets, accounts, addresses, keys, thresholds and credentials that no legitimate flow ever touches. Each one is committed onchain in DecoyCommit, so a touch is proof of probing, not a guess."
        actions={<><Button variant="secondary">Rotation schedule</Button><Button onClick={() => setDeploy(true)}><Icon name="plus" size={15} />Deploy decoy</Button></>} />

      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Active decoys" value="64" sub="across 38 members · 6 types" status="active" />
        <Metric label="Triggered · 24h" value="2" sub="DW-07, DA-114 · same actor" status="threat" />
        <Metric label="Rotating" value="5" sub="next rotation in 3h 12m" status="warning" />
        <Metric label="False positives" value="0" sub="deterministic by design" status="idle" />
      </div>

      <div className="grid grid-cols-[1fr_400px] gap-5 mb-5">
        <Panel className="bg-coal-2" title="Lure field · Exchange A & B" action={<div className="flex gap-4 font-mono text-[11px] text-dim">{(['threat', 'active', 'warning', 'idle'] as Status[]).map((s) => <span key={s} className="flex items-center gap-1.5"><svg width="14" height="10"><polygon points="3,1 11,1 13.5,5 11,9 3,9 0.5,5" fill={s === 'threat' ? '#FACF30' : 'none'} stroke={s === 'idle' ? '#6b675c' : s === 'warning' ? '#FCAD17' : '#FFC700'} strokeDasharray={s === 'warning' ? '2 1.5' : undefined} /></svg>{{ threat: 'Triggered', active: 'Armed', warning: 'Rotating', idle: 'Retired' }[s]}</span>)}</div>}>
          <svg viewBox="0 0 860 330" className="w-full h-[330px]">
            <text x="230" y="24" textAnchor="middle" className="font-mono" fontSize="10" letterSpacing="2" fill="#6b675c">EXCHANGE A DISTRICT</text>
            <text x="632" y="24" textAnchor="middle" className="font-mono" fontSize="10" letterSpacing="2" fill="#6b675c">EXCHANGE B DISTRICT</text>
            {/* empty cells keep the honeycomb coherent */}
            {[[0, 1], [0, 2], [4, 1], [4, 2], [5, 1], [5, 2], [7, 1], [7, 2], [1, 0], [3, 0], [6, 0]].map(([c, r]) => { const [x, y] = pos([c, r]); return <IsoHex key={`${c}${r}`} x={x} y={y} r={40} depth={8} status="idle" /> })}
            <Flow a={[30, 292]} b={pos(SLOT['DA-114'])} kind="attack" bend={-10} />
            <Flow a={pos(SLOT['DA-114'])} b={pos(SLOT['DW-07'])} kind="attack" bend={-30} />
            <text x="8" y="305" className="font-mono" fontSize="10" fill="#FCAD17">ATTACKER 0x3a4f →</text>
            {DECOYS.map((d) => {
              const [x, y] = pos(SLOT[d.id])
              const s = lvl(d)
              return (
                <IsoHex key={d.id} x={x} y={y} r={40} depth={12} status={s} selected={sel.id === d.id} hovered={hover === d.id} onClick={() => setSel(d)} onHover={(h) => setHover(h ? d.id : null)}>
                  <text x={x} y={y - 2} textAnchor="middle" fontSize="13" fontWeight="700" className="font-mono" fill={s === 'threat' ? '#0B0D10' : s === 'idle' ? '#6b675c' : '#FFC700'}>{CODE[d.type]}</text>
                  <text x={x} y={y + 12} textAnchor="middle" fontSize="9.5" className="font-mono" fill={s === 'threat' ? '#0B0D10' : '#8f8a7a'}>{d.id}</text>
                </IsoHex>
              )
            })}
          </svg>
        </Panel>

        <Panel>
          <div className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
            <div className="flex items-center justify-between"><Label>{sel.type} decoy · {sel.host}</Label><StateBadge state={sel.state} /></div>
            <div className="mt-2 text-[18px] font-semibold">{sel.label}</div>
            <div className="mt-1 font-mono text-[13px] text-dim">{sel.id} · {sel.ref}</div>
          </div>
          <div className="px-5 py-4 space-y-4">
            <Meter label="Lure strength" value={sel.lure} />
            <dl>
              <Row k="Host member">{sel.host}</Row>
              <Row k="Rotation">{ROTATION[sel.type]}</Row>
              <Row k="Commitment" mono>{sel.commit} ✓ verified 2m ago</Row>
              <Row k="Triggers">{sel.hits} · last {sel.lastHit}</Row>
              <Row k="Confidence">{conf(sel)}</Row>
              <Row k="Workflow">Trap Workflow{sel.state === 'Triggered' && <span className="font-mono text-dim"> · run-7f21</span>}</Row>
              <Row k="Incident">{sel.state === 'Triggered' ? <Link to="/cases/QRM-78452" className="font-mono text-honey hover:text-flare">#QRM-78452</Link> : <span className="text-mute">none</span>}</Row>
            </dl>
            <div className="p-3 rounded-md border border-white/[0.06] bg-ink/50">
              <Label>Trap Workflow result</Label>
              <p className="mt-1.5 text-[13px] text-cream">{sel.state === 'Triggered' ? 'Verified 7/7 · tightening report #78452 issued to QuorumReceiver.' : sel.state === 'Retired' ? 'Retired after Aug 14 hit; commitment archived.' : 'No touches. Commitment proof re-checked by Patrol 2m ago.'}</p>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-[1fr_400px] gap-5">
        <Panel>
          <div className="flex items-center justify-between px-5 py-3.5"><Segmented options={TYPES} value={type} onChange={setType} /></div>
          <DataTable rows={rows} rowKey={(d) => d.id} selected={sel.id} onSelect={setSel} cols={[
            { key: 'id', label: 'Decoy', render: (d) => <div><div className="font-mono text-cream">{d.id}</div><div className="text-[11.5px] text-mute">{d.type}</div></div> },
            { key: 'label', label: 'Lure', render: (d) => <div><div className="text-cream">{d.label}</div><div className="font-mono text-[11.5px] text-mute">{d.ref}</div></div> },
            { key: 'host', label: 'Host', render: (d) => <span className="text-dim">{d.host}</span> },
            { key: 'rot', label: 'Rotation', render: (d) => <span className="text-[12px] text-dim">{ROTATION[d.type].split(' ·')[0]}</span> },
            { key: 'commit', label: 'Commitment', render: (d) => <Mono>{d.commit}</Mono> },
            { key: 'conf', label: 'Confidence', render: (d) => <span className="text-[12px] text-dim">{conf(d)}</span> },
            { key: 'hits', label: 'Triggers', align: 'right', render: (d) => <span className={`font-mono ${d.hits ? 'text-cream' : 'text-mute'}`}>{d.hits}</span> },
            { key: 's', label: 'State', render: (d) => <StateBadge state={d.state} /> },
          ]} />
        </Panel>
        <Panel title="Trigger history">
          <div className="px-5 pb-5">
            <VTimeline items={[
              { t: '14:02:07', title: 'DW-07 received transfer', body: '0.42 ETH from 0x7a3f…91c2', level: 'threat', actor: 'Exchange A' },
              { t: '14:01:52', title: 'DA-114 enumerated ×3', body: 'Login + balance + limit read', level: 'warning', actor: 'Exchange A' },
              { t: '13:40:03', title: 'DC-09 canary seed read', body: 'Kestrel Custody · #QRM-78431', level: 'active', actor: 'Network' },
              { t: 'Oct 03', title: 'DT-02 threshold probe', body: '49.9 ETH against a 50 ETH decoy limit', level: 'idle', actor: 'Exchange B' },
              { t: 'Aug 14', title: 'DW-02 hit → retired', body: 'Rotated to DW-07', level: 'idle' },
            ]} />
          </div>
        </Panel>
      </div>

      <Modal open={deploy} onClose={() => setDeploy(false)} title="Deploy a new decoy"
        footer={<><Button variant="ghost" onClick={() => setDeploy(false)}>Cancel</Button><Button onClick={() => setDeploy(false)}>Commit &amp; schedule</Button></>}>
        <div className="space-y-3">
          <p>Deployment writes a hash commitment to <b className="text-cream">DecoyCommit</b> first. The decoy goes live after the 24h ConfigTimelock delay, so an insider can't create and immediately “trigger” a decoy.</p>
          <div className="grid grid-cols-3 gap-2">{['Wallet', 'Account', 'Address', 'API key', 'Threshold', 'Credential'].map((t, i) => <button key={t} className={`h-10 rounded-md border text-[13px] ${i === 0 ? 'border-honey text-honey bg-honey/10' : 'border-honey/15 text-dim hover:text-cream'}`}>{t}</button>)}</div>
          <div className="flex items-center gap-2 text-[12px]"><Badge status="warning">Timelock 24h</Badge><span className="text-mute">Requires 2 operator approvals</span></div>
        </div>
      </Modal>
    </div>
  )
}

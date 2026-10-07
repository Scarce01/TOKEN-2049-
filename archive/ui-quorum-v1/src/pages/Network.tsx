import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { MEMBERS } from '../components/mock'
import { Flow, IsoHex } from '../components/Iso'
import { DataTable, Label, Meter, Metric, PageHeader, Panel, Row, StateBadge, type Status } from '../components/ui'

type M = (typeof MEMBERS)[number]
const HUB: [number, number] = [450, 236]
const at = (m: M): [number, number] => [HUB[0] + m.x * 200, HUB[1] + m.y * 140]
const st = (m: M): Status => (m.id === 'exA' ? 'threat' : m.state === 'Pending' ? 'warning' : m.state === 'Received' ? 'idle' : 'active')

export default function Network() {
  const [sel, setSel] = useState<M>(MEMBERS[1])
  const [hover, setHover] = useState<string | null>(null)
  const [params] = useSearchParams()
  const pm = params.get('member')
  useEffect(() => { const m = MEMBERS.find((x) => x.id === pm || x.name.toLowerCase() === pm?.toLowerCase()); if (m) setSel(m) }, [pm])
  const focusId = hover ?? sel.id

  return (
    <div className="max-w-[1480px]">
      <PageHeader eyebrow="Partner / network view" title={<>One attack, <span className="text-honey">every member protected</span></>}
        desc="Exchange A's decoy hit became ThreatRegistry entry #4,118. Within 44 seconds, connected exchanges, custodians, DAO treasuries and agent wallets tightened their own controls without seeing Exchange A's data." />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Members" value="38" sub="21 exchanges · 9 custodians · 8 agent/DAO" status="active" />
        <Metric label="Consumed #4,118" value="36 / 38" sub="2 pending ack" status="warning" />
        <Metric label="Network protection" value="94%" sub="members with registry-enforced Cosign" status="active" />
        <Metric label="Propagation time" value="44s" sub="trigger → last consuming member" status="idle" />
      </div>

      <div className="grid grid-cols-[1fr_380px] gap-5">
        <Panel className="honeycomb bg-coal-2" title="Hive outposts · propagation of #4,118" action={<span className="font-mono text-[11px] text-dim">hover an outpost to trace its path</span>}>
          <svg viewBox="0 0 900 500" className="w-full h-[500px]">
            {MEMBERS.map((m) => (
              <Flow key={m.id} a={m.id === 'exA' ? at(m) : HUB} b={m.id === 'exA' ? HUB : at(m)} kind={m.id === 'exA' ? 'defense' : 'intel'}
                live={m.state !== 'Received'} focus={focusId === m.id || (m.id === 'exA' && !!hover)} dim={!!hover && hover !== m.id && !(m.id === 'exA')} bend={-30} />
            ))}
            <IsoHex x={HUB[0]} y={HUB[1]} r={62} depth={20} status="active" label="ThreatRegistry Core" sub="entry #4,118">
              {[0, 1, 2].map((i) => <line key={i} x1={HUB[0] - 22} x2={HUB[0] + 22} y1={HUB[1] - 8 + i * 8} y2={HUB[1] - 8 + i * 8} stroke="#FFF1C1" strokeOpacity=".8" />)}
            </IsoHex>
            {MEMBERS.map((m) => {
              const [x, y] = at(m)
              return (
                <IsoHex key={m.id} x={x} y={y} r={44} depth={14} status={st(m)} selected={sel.id === m.id} hovered={hover === m.id}
                  onClick={() => setSel(m)} onHover={(h) => setHover(h ? m.id : null)} label={m.name} sub={m.id === 'exA' ? 'source member' : m.state}>
                  {/* outpost towers — height = protection level */}
                  {[-14, 0, 14].map((dx, i) => <rect key={i} x={x + dx - 4} y={y - m.level * 26 + i * 3} width="8" height={m.level * 26 - i * 3} fill={st(m) === 'threat' ? '#0B0D10' : '#FFC700'} fillOpacity={st(m) === 'idle' ? 0.3 : 0.75} />)}
                </IsoHex>
              )
            })}
          </svg>
        </Panel>

        <div className="space-y-5">
          <Panel>
            <div className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
              <div className="flex items-center justify-between"><Label>{sel.kind}</Label><StateBadge state={sel.state} /></div>
              <div className="mt-2 text-[20px] font-semibold">{sel.name}</div>
              <div className="text-[13px] text-dim">{sel.note}</div>
            </div>
            <div className="px-5 py-4 space-y-4">
              <Meter label="Protection level" value={sel.level} />
              <dl><Row k="Type">{sel.kind}</Row><Row k="Sync state">{sel.state}</Row><Row k="Latest alert">{sel.alert}</Row><Row k="Enforcement">{sel.enf ? <span className="text-honey">Enabled</span> : <span className="text-amber">Disabled</span>}</Row><Row k="Registry ack" mono>{sel.ack}</Row><Row k="Policy applied">{sel.state === 'Consumed' || sel.state === 'Tightened' ? 'Yes · auto via Cosign' : 'Not yet'}</Row><Row k="Shares decoys">{sel.id === 'orb' ? 'No' : 'Yes'}</Row></dl>
              {sel.id === 'exB' && (
                <div className="p-3 rounded-md border border-honey/20">
                  <Label>Received threat intel</Label>
                  <dl className="mt-1">
                    <Row k="Threat entry" mono>#4,118</Row>
                    <Row k="Address match" mono>0x7a3f…91c2 ✓</Row>
                    <Row k="Fingerprint match">decoy-wallet-touch · enum→probe→transfer ✓</Row>
                    <Row k="Acknowledged" mono>14:02:44 UTC · +37s</Row>
                    <Row k="Policy response"><span className="text-honey">Stricter Cosign review · registry match</span></Row>
                    <Row k="Freeze">No · vaults remain operational</Row>
                  </dl>
                </div>
              )}
            </div>
          </Panel>
          <Panel title="Cross-member propagation">
            <DataTable dense rows={MEMBERS.filter((m) => m.id !== 'exA')} rowKey={(m) => m.id} selected={sel.id} onSelect={setSel} cols={[
              { key: 'n', label: 'Member', render: (m) => <span className="text-cream">{m.name}</span> },
              { key: 'a', label: 'Type', render: (m) => <span className="text-dim">{m.kind}</span> },
              { key: 'e', label: 'Enforced', render: (m) => <span className={m.enf ? 'text-cream' : 'text-amber'}>{m.enf ? 'Yes' : 'No'}</span> },
              { key: 'ack', label: 'Ack', render: (m) => <span className="font-mono text-[12px] text-dim">{m.ack}</span> },
              { key: 's', label: 'State', render: (m) => <StateBadge state={m.state} /> },
            ]} />
          </Panel>
        </div>
      </div>
    </div>
  )
}

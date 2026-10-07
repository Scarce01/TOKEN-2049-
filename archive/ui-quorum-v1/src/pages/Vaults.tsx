import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { VAULTS } from '../components/mock'
import { useLive, readLive } from '../live/chain'
import { Flow, IsoHex } from '../components/Iso'
import { Badge, Button, DataTable, Label, Meter, Metric, Modal, Mono, PageHeader, Panel, Row, StateBadge, useDeepFocus, type Status } from '../components/ui'

type VId = 'hot' | 'warm' | 'cold'
type NId = VId | 'receiver' | 'qv' | 'timelock' | 'registry'
const P: Record<NId, [number, number]> = { timelock: [150, 78], receiver: [430, 60], registry: [710, 78], qv: [430, 196], hot: [190, 336], warm: [430, 362], cold: [670, 336] }
const INFO: Record<NId, { name: string; role: string }> = {
  receiver: { name: 'QuorumReceiver', role: 'Accepts CRE-signed reports only; relays directives' },
  qv: { name: 'QuorumVault', role: 'Execution constraints · quota buckets · hidden bands' },
  timelock: { name: 'ConfigTimelock', role: 'Delays any relaxation of policy' },
  registry: { name: 'ThreatRegistry', role: 'Destination check on every transfer' },
  hot: { name: 'Hot Vault', role: 'Operational liquidity' },
  warm: { name: 'Warm Vault', role: 'Semi-protected reserve' },
  cold: { name: 'Cold Vault', role: 'Deep storage · ColdVault contract' },
}
const STATE: Record<VId, { allow: string; restr: number; next: string; relaxers: string; mode: string }> = {
  hot: { allow: '0 / 2,400 ETH', restr: 3, next: '47h 12m · CT-0194', relaxers: 'ops-1, ops-2 (2 of 3)', mode: 'Tight' },
  warm: { allow: '1,800 / 6,000 ETH', restr: 2, next: '5h 48m · auto-expiry', relaxers: 'ops-1, ops-3 (2 of 3)', mode: 'Restricted' },
  cold: { allow: '0 / 0 ETH (deep)', restr: 1, next: '71h 58m · timelock', relaxers: 'ops-1, ops-2, ops-3 (3 of 3)', mode: 'Guarded' },
}
const RISK: Record<string, { act: string; effect: string; signer: string; lock: string; undo: string }> = {
  Freeze: { act: 'Freeze vault outflows', effect: 'All outbound transfers halt; only Cosign-approved returns allowed', signer: '2 of 3 operators', lock: 'None, effective immediately', undo: 'Yes, via Relax restriction (48h timelock)' },
  Sweep: { act: 'Sweep to Cold Vault', effect: 'Excess liquidity moves to ColdVault; hot quota drops to 0', signer: '2 of 3 operators', lock: 'None, effective immediately', undo: 'Partially: withdrawals from cold need a 72h timelock' },
  Tighten: { act: 'Tighten policy', effect: 'Quota lowered and review bands narrowed for the vault', signer: '2 of 3 operators', lock: 'None, tightening is instant', undo: 'Yes, via Relax restriction (48h timelock)' },
  Relax: { act: 'Relax restriction', effect: 'Queues a proposal to restore quota; nothing changes until ETA', signer: '2 of 3 operators + co-sign', lock: '48h in ConfigTimelock', undo: 'Yes, cancellable until ETA' },
}
const ACTIONS = [
  { t: '14:02:31', a: 'Quota cleared', v: 'Hot Vault', d: '2,400 → 0 ETH / 24h', src: 'Trap report #78452', s: 'Executed' },
  { t: '14:02:31', a: 'Sweep', v: 'Hot → Cold', d: '1,120 ETH', src: 'Trap report #78452', s: 'Executed' },
  { t: '14:02:31', a: 'Freeze (partial)', v: 'Warm Vault', d: 'Cosign-only · 6h', src: 'Trap report #78452', s: 'Executed' },
  { t: '14:02:32', a: 'Timelock extended', v: 'Cold Vault', d: '24h → 72h', src: 'Trap report #78452', s: 'Executed' },
  { t: '14:15:44', a: 'Relax proposed', v: 'Hot Vault', d: '0 → 800 ETH (CT-0194)', src: 'Operators 2/2', s: 'Queued' },
]
const CONSTRAINTS = [
  ['Quota bucket', 'Per-vault rolling 24h allowance; replenished only by Patrol permits'],
  ['Hidden thresholds', 'Review bands rotate every 72h and are never exposed to the backend'],
  ['Destination check', 'Every transfer destination is checked against ThreatRegistry at execution'],
  ['Intent verification', 'User-signed intent must match the RequestBoard entry byte-for-byte'],
  ['Tighten fast, relax slow', 'CRE reports tighten instantly; any relaxation waits 48h in ConfigTimelock'],
]

const RECON: { id: VId; name: string; chain: string; exp: string; obs: string; d: string; t: string; bad?: boolean }[] = [
  { id: 'hot', name: 'Hot Vault', chain: 'Ethereum', exp: '1,280 ETH', obs: '1,280 ETH', d: '0', t: '14:02:30' },
  { id: 'warm', name: 'Warm Vault', chain: 'Ethereum + Arbitrum', exp: '18,400 ETH', obs: '18,400 ETH', d: '0', t: '14:02:30' },
  { id: 'cold', name: 'Cold Vault · tranche C-3', chain: 'Ethereum', exp: '12,480 ETH', obs: '12,472 ETH', d: '-8 ETH', t: '14:02:30', bad: true },
]
const RECON_HIST = [
  { t: '14:02:30', r: 'Cold Δ -8 ETH · flagged to Patrol', bad: true },
  { t: '14:02:00', r: 'All vaults conserved · 6 chains' },
  { t: '14:01:30', r: 'All vaults conserved · 6 chains' },
  { t: '14:01:00', r: 'Hot Δ -1,120 ETH explained by sweep #78452' },
]
const QUOTA = { cur: '0', max: '2,400 ETH', refill: 'Paused · post-trigger', next: 'Blocked until CT-0194 ETA (47h 12m)', change: '14:02:31 · 2,400 → 0 ETH', by: 'Report #78452 via QuorumReceiver' }

export default function Vaults() {
  const [params] = useSearchParams()
  const pv = params.get('vault'), section = params.get('section')
  const recon = useDeepFocus(section === 'reconciliation', pv ?? '')
  const [sel, setSel] = useState<VId>('hot')
  useEffect(() => { if (pv === 'hot' || pv === 'warm' || pv === 'cold') setSel(pv) }, [pv])
  const [hover, setHover] = useState<NId | null>(null)
  const [action, setAction] = useState<string | null>(null)
  const v = VAULTS.find((x) => x.id === sel)!
  const live = useLive(readLive)
  const lo = live.data?.orgs[0]
  const lv = lo?.vaults.find((x) => x.id === sel)
  const fmt = (a?: { qUSD: number; qETH: number }) => a ? `${a.qUSD.toLocaleString()} qUSD · ${a.qETH.toLocaleString(undefined,{maximumFractionDigits:3})} qETH` : null
  const quotaFrac = lv?.quota && lv?.cap && (lv.cap.qUSD>0) ? Math.min(1, lv.quota.qUSD / lv.cap.qUSD) : undefined
  const frozen = lv?.frozenUntil && lv.frozenUntil*1000 > Date.now()
  const liveTag = live.data ? 'LIVE' : live.error ? 'mock (chain offline)' : 'loading'
  const vs = (id: VId): Status => (id === 'hot' ? 'threat' : 'warning')

  return (
    <div className="max-w-[1480px]">
      <PageHeader eyebrow={`Onchain defense & control layer · ${liveTag}`} title="Vaults & Controls"
        desc="After a CRE-verified event, QuorumReceiver relays signed directives to QuorumVault and ColdVault. Controls tighten in proportion to risk. Nothing is switched off wholesale, and every relaxation is timelocked."
        actions={<><Button variant="secondary" onClick={() => setAction('Freeze')}>Freeze</Button><Button variant="secondary" onClick={() => setAction('Sweep')}>Sweep to cold</Button><Button variant="secondary" onClick={() => setAction('Relax')}>Relax restriction</Button><Button onClick={() => setAction('Tighten')}>Tighten policy</Button></>} />

      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Hot vault (org A)" value={fmt(lo?.vaults.find(x=>x.id==='hot')?.balance) ?? '$3.33M'} sub={lo ? `quota ${lo.vaults.find(x=>x.id==='hot')?.quota?.qUSD.toLocaleString()} qUSD` : 'quota 0 · post-trigger'} status={lo ? 'active' : 'threat'} />
        <Metric label="Warm vault (org A)" value={fmt(lo?.vaults.find(x=>x.id==='warm')?.balance) ?? '$47.8M'} sub={lo ? 'live balance' : 'reserve'} status="active" />
        <Metric label="Cold vault (org A)" value={fmt(lo?.vaults.find(x=>x.id==='cold')?.balance) ?? '$4.77B'} sub={lo ? `release delay ${lo.vaults.find(x=>x.id==='cold')?.coldDelayHours}h` : 'deep storage'} status="idle" />
        <Metric label="Alert level (org A)" value={lo?.alertLabel ?? '1'} sub={lo?.mode==='SIM' ? 'CRE simulation' : lo ? 'DON' : 'CT-0194'} status={lo && lo.alert>=4 ? 'threat' : lo && lo.alert>0 ? 'warning' : 'active'} />
      </div>

      <div className="grid grid-cols-[1fr_400px] gap-5 mb-5">
        <Panel title="Control topology" className="honeycomb bg-coal-2" action={<span className="font-mono text-[11px] text-dim">click a vault to inspect</span>}>
          <svg viewBox="0 0 860 440" className="w-full h-[440px]">
            <Flow a={P.receiver} b={P.qv} focus />
            <Flow a={P.timelock} b={P.qv} kind="request" bend={20} />
            <Flow a={P.registry} b={P.qv} kind="intel" bend={20} />
            {(['hot', 'warm', 'cold'] as VId[]).map((id) => <Flow key={id} a={P.qv} b={P[id]} focus={sel === id} dim={sel !== id && hover !== id} bend={-10} />)}
            <Flow a={P.hot} b={P.cold} bend={110} kind="defense" focus={sel === 'hot' || sel === 'cold'} />
            <text x="430" y="424" textAnchor="middle" className="font-mono" fontSize="10" fill="#FCAD17" letterSpacing="1.5">SWEEP 1,120 ETH · HOT → COLD</text>

            {(['timelock', 'receiver', 'registry'] as NId[]).map((id) => (
              <IsoHex key={id} x={P[id][0]} y={P[id][1]} r={34} depth={9} status="active" hovered={hover === id} onHover={(h) => setHover(h ? id : null)} label={INFO[id].name} />
            ))}
            <IsoHex x={P.qv[0]} y={P.qv[1]} r={60} depth={18} status="active" label="QuorumVault" sub="policy engine">
              <polygon points="430,180 446,189 446,203 430,212 414,203 414,189" fill="#FFC700" />
            </IsoHex>
            {(['hot', 'warm', 'cold'] as VId[]).map((id) => {
              const x = VAULTS.find((y) => y.id === id)!
              return (
                <IsoHex key={id} x={P[id][0]} y={P[id][1]} r={48} depth={14} status={vs(id)} selected={sel === id} hovered={hover === id}
                  onClick={() => setSel(id)} onHover={(h) => setHover(h ? id : null)} label={x.name} sub={x.state}>
                  {/* rings = protection depth */}
                  {Array.from({ length: id === 'cold' ? 3 : id === 'warm' ? 2 : 1 }, (_, i) => <ellipse key={i} cx={P[id][0]} cy={P[id][1]} rx={30 - i * 8} ry={(30 - i * 8) * 0.56} fill="none" stroke={id === 'hot' ? '#0B0D10' : '#FCAD17'} strokeOpacity=".7" />)}
                </IsoHex>
              )
            })}
          </svg>
        </Panel>

        <Panel>
          <div className="flex gap-1 p-2 border-b border-white/[0.04]">
            {(['hot', 'warm', 'cold'] as VId[]).map((id) => <button key={id} onClick={() => setSel(id)} className={`flex-1 py-1.5 text-[12.5px] font-medium capitalize ${sel === id ? 'bg-coal-3 text-cream' : 'text-dim hover:text-cream'}`}>{id}</button>)}
          </div>
          <div className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
            <div className="flex items-center justify-between"><Label>{INFO[sel].role}</Label><StateBadge state={v.state} /></div>
            <div className="mt-2 text-[20px] font-semibold">{v.name}</div>
            <div className="font-mono text-[12.5px] text-honey">{v.addr}</div>
            <div className="mt-3 text-[26px] font-semibold tabular-nums">{lv ? fmt(lv.balance) : <>{v.balance} <span className="text-[13px] font-normal text-dim">{v.usd}</span></>}{frozen ? <span className="ml-2 text-[12px] text-amber">· frozen</span> : null}</div>
          </div>
          <div className="px-5 py-4 space-y-4">
            <Meter label="Remaining flow allowance" value={quotaFrac ?? v.quota} tone="amber" />
            {sel === 'hot' && (
              <div className="p-3 rounded-md border border-honey/20">
                <Label>Quota detail</Label>
                <div className="mt-1 font-mono text-[20px] text-cream tabular-nums">{QUOTA.cur} <span className="text-[13px] text-dim">/ max {QUOTA.max}</span></div>
                <dl className="mt-1">
                  <Row k="Refill state"><span className="text-amber">{QUOTA.refill}</span></Row>
                  <Row k="Next refill">{QUOTA.next}</Row>
                  <Row k="Latest change" mono>{QUOTA.change}</Row>
                  <Row k="Changed by">{QUOTA.by}</Row>
                </dl>
              </div>
            )}
            <dl>
              <Row k="Protection mode"><span className="text-amber">{STATE[sel].mode}</span></Row>
              <Row k="Total allowance"><Mono>{STATE[sel].allow}</Mono></Row>
              <Row k="Active restrictions">{STATE[sel].restr}</Row>
              <Row k="Next relaxation"><Mono>{STATE[sel].next}</Mono></Row>
              <Row k="Authorised relaxers">{STATE[sel].relaxers}</Row>
              <Row k="Quota">{v.quotaMax}</Row>
              <Row k="Timelock">{v.timelock}</Row>
              <Row k="Restriction"><span className="text-amber">{v.restriction}</span></Row>
              <Row k="Set by">Trap report #78452 · 14:02:31</Row>
              <Row k="Relax path">ConfigTimelock · 48h · 2 operators</Row>
            </dl>
            <div className="flex gap-1">
              {[1, 2, 3, 4].map((l) => <div key={l} className={`flex-1 h-2 ${l <= (sel === 'hot' ? 4 : sel === 'warm' ? 3 : 2) ? 'bg-amber' : 'bg-coal-3'}`} style={{ clipPath: 'polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%)' }} />)}
            </div>
            <div className="flex justify-between font-mono text-[10.5px] text-mute"><span>NORMAL</span><span>GUARDED</span><span>RESTRICTED</span><span>TIGHT</span></div>
          </div>
        </Panel>
      </div>

      <div ref={recon.ref} className={`mb-5 scroll-mt-4 rounded-lg transition-shadow ${recon.ring}`}>
        <Panel title="Asset integrity · reconciliation" action={<span className="font-mono text-[11px] text-dim">Patrol · every 30s · expected vs observed</span>}>
          <div className="grid grid-cols-[1fr_320px] gap-5 px-5 pb-5">
            <DataTable dense rows={RECON} rowKey={(r) => r.id} selected={sel} onSelect={(r) => setSel(r.id)} cols={[
              { key: 'v', label: 'Vault', render: (r) => <span className="text-cream">{r.name}</span> },
              { key: 'c', label: 'Chain', render: (r) => <span className="text-dim">{r.chain}</span> },
              { key: 'e', label: 'Expected', align: 'right', render: (r) => <Mono>{r.exp}</Mono> },
              { key: 'o', label: 'Observed', align: 'right', render: (r) => <span className={`font-mono text-[12.5px] ${r.bad ? 'text-amber' : 'text-cream'}`}>{r.obs}</span> },
              { key: 'd', label: 'Δ', align: 'right', render: (r) => <span className={`font-mono text-[12.5px] ${r.bad ? 'text-amber font-semibold' : 'text-mute'}`}>{r.d}</span> },
              { key: 't', label: 'Checked', render: (r) => <span className="font-mono text-[12px] text-dim">{r.t}</span> },
              { key: 's', label: 'State', render: (r) => r.bad ? <Badge status="warning">Discrepancy</Badge> : <Badge status="active">Conserved</Badge> },
            ]} />
            <div>
              <Label>Recent checks</Label>
              <ul className="mt-2 space-y-1.5">{RECON_HIST.map((h) => <li key={h.t} className="flex gap-3 text-[12.5px]"><span className="font-mono text-mute">{h.t}</span><span className={h.bad ? 'text-amber' : 'text-dim'}>{h.r}</span></li>)}</ul>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-[1fr_440px] gap-5">
        <Panel title="Latest defense actions">
          <DataTable rows={ACTIONS} rowKey={(r) => r.t + r.a} cols={[
            { key: 't', label: 'Time', render: (r) => <span className="font-mono text-[12px] text-dim">{r.t}</span> },
            { key: 'a', label: 'Action', render: (r) => <span className="font-medium text-cream">{r.a}</span> },
            { key: 'v', label: 'Vault', render: (r) => <span className="text-dim">{r.v}</span> },
            { key: 'd', label: 'Change', render: (r) => <Mono>{r.d}</Mono> },
            { key: 'src', label: 'Authority', render: (r) => <span className="text-dim">{r.src}</span> },
            { key: 's', label: 'State', render: (r) => <StateBadge state={r.s} /> },
          ]} />
        </Panel>
        <Panel title="Execution constraints · QuorumVault">
          <ul className="px-5 pb-5 space-y-3">
            {CONSTRAINTS.map(([k, d]) => (
              <li key={k} className="flex gap-3"><span className="mt-1 text-honey"><svg width="10" height="10" viewBox="0 0 10 10"><polygon points="2.5,0.7 7.5,0.7 9.6,5 7.5,9.3 2.5,9.3 0.4,5" fill="currentColor" /></svg></span><div><div className="text-[13.5px] font-medium text-cream">{k}</div><div className="text-[12.5px] text-dim">{d}</div></div></li>
            ))}
          </ul>
        </Panel>
      </div>

      <Modal open={!!action} onClose={() => setAction(null)} title={action ? `Confirm · ${RISK[action].act}` : ''}
        footer={<><Button variant="ghost" onClick={() => setAction(null)}>Cancel</Button><Button onClick={() => setAction(null)}>Sign &amp; submit</Button></>}>
        {action && <dl>
          <Row k="Action">{RISK[action].act}</Row>
          <Row k="Affected vault">{v.name} <Mono>{v.addr}</Mono></Row>
          <Row k="Expected effect">{RISK[action].effect}</Row>
          <Row k="Signer requirement">{RISK[action].signer}</Row>
          <Row k="Timelock">{RISK[action].lock}</Row>
          <Row k="Reversible">{RISK[action].undo}</Row>
        </dl>}
      </Modal>
    </div>
  )
}

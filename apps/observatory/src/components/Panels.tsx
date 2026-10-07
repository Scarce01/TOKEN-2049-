import { type ReactNode } from 'react'
import { Link } from 'react-router'
import { EVENTS, NODES, STEPS } from './data'
import { Badge, HexDot, Icon, Label, Panel, Row } from './ui'

const KPIS = [
  { k: 'Protected Funds', v: '$4.82B', s: 'across 3 vault tiers', tag: '' },
  { k: 'Requests Under Review', v: '14', s: 'Cosign pending or held', tag: '' },
  { k: 'Verified Threat Signals', v: '1', s: 'Trap Workflow · 14:02:19', tag: 'threat' },
  { k: 'Network Members Synced', v: '38 / 38', s: 'entry #4,118 consumed', tag: '' },
]

export function Kpis() {
  return (
    <div className="grid grid-cols-4 gap-3">
      {KPIS.map((c) => (
        <Panel key={c.k} className={`px-4 py-3 backdrop-blur-md ${c.tag ? 'bg-[#221f14]/85' : 'bg-coal-2/75'}`}>
          <div className="flex items-center justify-between"><Label>{c.k}</Label>{c.tag && <span className="text-flare"><HexDot status="threat" /></span>}</div>
          <div className={`mt-1 text-[24px] font-semibold tabular-nums tracking-tight ${c.tag ? 'text-flare' : 'text-cream'}`}>{c.v}</div>
          <div className="mt-0.5 text-[12px] text-dim">{c.s}</div>
        </Panel>
      ))}
    </div>
  )
}

/** Architecture layers touched by the incident, lit by step */
const LAYERS: [string, number][] = [['Request', 1], ['Trap', 2], ['CRE', 3], ['Receiver', 4], ['Vaults', 5], ['Registry', 6], ['Network', 7]]

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="py-3 border-b border-white/[0.05] last:border-0">
      <div className="flex items-center justify-between mb-1"><Label>{title}</Label>{aside}</div>
      <dl>{children}</dl>
    </section>
  )
}

/** Overview context only: "what is happening now". Depth lives on the Incident page. */
export function IncidentPanel({ phase, onLayer }: { phase: number; onLayer?: (step: number) => void }) {
  const response: [string, string, number][] = [
    ['Hot Vault', 'Quota 2,400 → 0 ETH', 5],
    ['Warm Vault', 'Cosign-only · 6h', 5],
    ['Cold Vault', 'Timelock 24h → 72h', 5],
    ['ThreatRegistry', 'Entry #4,118 shared', 6],
  ]
  return (
    <Panel className="flex flex-col h-full bg-coal-2/90 backdrop-blur-md">
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between"><Label>Active incident</Label><span className="font-mono text-[12px] text-dim">#QRM-78452</span></div>
        <h2 className="mt-2 text-[19px] font-semibold text-cream leading-snug">Decoy wallet hit at Bybit</h2>
        <div className="mt-2.5 flex gap-2"><Badge status="threat">Verified</Badge><Badge status="warning">Contained</Badge></div>
        <div className="mt-4 grid grid-cols-7 gap-1">
          {LAYERS.map(([l, p], i) => (
            <button key={l} onClick={() => onLayer?.(i)} title={l} className="group text-center">
              <div className={`h-1 rounded-sm transition-colors ${p <= phase ? (p === 2 ? 'bg-flare' : 'bg-honey/80') : 'bg-coal-3 group-hover:bg-honey/30'}`} />
              <div className={`mt-1 text-[9.5px] ${p <= phase ? 'text-dim' : 'text-mute/60'}`}>{l}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5">
        <Section title="Now">
          <Row k="Source">Bybit <span className="text-mute">· backend untrusted</span></Row>
          <Row k="Trigger">Decoy wallet <span className="font-mono text-dim">DW-07</span></Row>
          <Row k="Evidence">Onchain transfer · <span className="font-mono text-dim">blk 21,904,118</span></Row>
          <Row k="CRE">{phase >= 3 ? <span>Trap Workflow <span className="text-honey">✓ 7/7</span></span> : <span className="text-mute">verifying…</span>}</Row>
        </Section>
        <Section title="Current response">
          <ul className="pt-1 space-y-1">
            {response.map(([a, d, p]) => {
              const done = phase >= p
              return (
                <li key={a} className="flex items-center gap-2.5 py-1.5 text-[13px]">
                  <span className={done ? 'text-amber' : 'text-mute'}><Icon name={done ? 'lock' : 'clock'} size={13} /></span>
                  <span className={done ? 'text-cream' : 'text-mute'}>{a}</span>
                  <span className="ml-auto text-[12px] text-dim">{done ? d : 'pending'}</span>
                </li>
              )
            })}
          </ul>
        </Section>
      </div>
      <div className="p-5 pt-3"><Link to="/cases/QRM-78452" className="flex items-center justify-center h-10 rounded-md bg-honey text-ink text-[13px] font-semibold hover:bg-flare">Open incident</Link></div>
    </Panel>
  )
}

export function Timeline({ phase, active, onStep }: { phase: number; active: number | null; onStep: (i: number) => void }) {
  return (
    <Panel title="Defense flow · #QRM-78452" action={<span className="font-mono text-[11px] text-dim">probe → network protected in <b className="text-honey">52s</b> · click a step to trace it</span>}>
      <ol className="grid grid-cols-7 px-5 pb-5">
        {STEPS.map((s, i) => {
          const done = s.phase <= phase
          const sel = active === i
          return (
            <li key={s.label} className="relative">
              <div className="flex items-center">
                <button onClick={() => onStep(i)} aria-label={s.label}
                  className={`relative z-10 w-9 h-9 clip-hex grid place-items-center font-mono text-[12px] font-semibold transition-all ${sel ? 'bg-cream text-ink scale-110' : i === 1 && done ? 'bg-flare text-ink' : done ? 'bg-honey text-ink' : 'bg-coal-3 text-mute'}`}>
                  {i + 1}
                </button>
                {i < STEPS.length - 1 && <div className={`flex-1 h-px mx-2 ${STEPS[i + 1].phase <= phase ? 'bg-honey' : 'bg-honey/15 border-t border-dashed border-honey/20'}`} />}
              </div>
              <button onClick={() => onStep(i)} className={`text-left mt-3 pr-3 group ${active !== null && !sel ? 'opacity-50' : ''}`}>
                <div className={`text-[13px] leading-snug font-semibold group-hover:text-honey transition-colors ${sel ? 'text-honey' : done ? 'text-cream' : 'text-mute'}`}>{s.label}</div>
                <div className="font-mono text-[11.5px] text-dim mt-1">{s.t}</div>
                <div className="text-[12px] text-dim mt-0.5">{s.d}</div>
              </button>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}

export function Events() {
  return (
    <Panel title="Recent security events" action={<a href="#" className="text-[12px] text-honey hover:text-flare">All events</a>} className="h-full">
      <table className="w-full text-[13px]">
        <tbody>
          {EVENTS.map((e, i) => (
            <tr key={i} className="border-t border-white/[0.04] hover:bg-honey/[0.03]">
              <td className="pl-5 py-2 w-6 text-honey"><span className={e.level === 'threat' ? 'text-flare' : e.level === 'warning' ? 'text-amber' : e.level === 'idle' ? 'text-mute' : ''}><HexDot status={e.level} /></span></td>
              <td className="py-2 text-cream font-medium whitespace-nowrap">{e.type}</td>
              <td className="py-2 text-dim truncate max-w-[180px]">{e.s}</td>
              <td className="pr-5 py-2 text-right font-mono text-[11px] text-mute">{e.t}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

export { Icon }

/** Contextual detail for anything clicked on the map — Summary · State · Evidence · Timeline · Linked object · Action */
type Rows = [string, string, boolean?][]
type Detail = { type: string; name: string; status: string; tone?: 'honey' | 'amber' | 'red' | 'grey'; summary: string; state: Rows; evidence?: Rows; timeline?: [string, string][]; linked?: string; link: [string, string] }
const DETAILS: Record<string, Detail> = {
  threat: { type: 'Malicious transaction', name: '0x7a3f…91c2', status: 'Active threat · source identified', tone: 'red', summary: 'Withdrawal attempt touched decoy DW-07 at Bybit.', state: [['Source', '0x7a3f…91c2', true], ['Destination', 'Decoy DW-07 · 0x5c11…d07a', true], ['Tx', '0x9e1c…44b0 · blk 21,904,118', true], ['Reason', 'Decoy touch · fresh-funded via mixer']], evidence: [['DecoyCommit', 'match · 0xc71d…0a92', true], ['CRE', '7 / 7 nodes verified']], timeline: [['14:02:07', 'Probe 0.42 ETH'], ['14:02:31', 'Decoy touched'], ['14:02:38', 'Report #78452 accepted']], linked: 'Incident #QRM-78452', link: ['/cases/QRM-78452', 'Open incident'] },
  decoy: { type: 'Honeypot', name: 'Decoy DW-07', status: 'Triggered', tone: 'honey', summary: 'Hot overflow wallet decoy hosted by Bybit.', state: [['Type', 'Wallet decoy'], ['Host', 'Bybit'], ['Touch', '14:02:31 · 0x7a3f…91c2', true], ['Rotation', 'Next rotation Oct 12']], evidence: [['Commitment', 'DecoyCommit 0xc71d…0a92 · blk 21,880,002', true]], linked: 'Incident #QRM-78452', link: ['/traps?decoy=DW-07', 'Open in Traps & Decoys'] },
  core: { type: 'CRE Core', name: 'Quorum CRE', status: '7 / 7 DON healthy', tone: 'honey', summary: 'Runs Trap, Cosign and Patrol. Signs reports only — never holds funds.', state: [['Consensus', '7 / 7 · threshold 5'], ['Last report', '#78452 · 14:02:38', true], ['Signer set', 'v12']], link: ['/workflows', 'Open CRE Workflows'] },
  receiver: { type: 'QuorumReceiver', name: 'QuorumReceiver', status: 'Report #78452 processed', tone: 'honey', summary: 'Only accepts DON-signed reports, then relays directives to the vaults.', state: [['Report', '#78452 · ReportProcessed', true], ['Directives', 'QuorumVault · ColdVault'], ['Executed', '14:02:38 UTC', true]], link: ['/execution', 'Open Execution Center'] },
  board: { type: 'RequestBoard', name: 'RequestBoard', status: 'Recording', tone: 'grey', summary: 'Every request is recorded here first. A request is not a transfer.', state: [['Requests · 24h', '9,412'], ['Pending', '12'], ['Rejected', '4']], link: ['/requests', 'Open RequestBoard'] },
  exA: { type: 'Member', name: 'Bybit', status: 'Incident source member', tone: 'grey', summary: 'Hosts decoy DW-07. Its backend is untrusted and only submits requests.', state: [['Decoys', '6 armed · 1 triggered'], ['Backend', 'Untrusted · RequestBoard only']], link: ['/requests', 'Inspect backend activity'] },
  exB: { type: 'Member', name: 'Bitget', status: 'Registry match · stricter review', tone: 'honey', summary: 'Received entry #4,118 and tightened its own Cosign scrutiny. No blanket freeze.', state: [['Entry', '#4,118', true], ['Address match', '0x7a3f…91c2', true], ['Fingerprint', 'match'], ['Ack', '14:02:44 · +6s'], ['Response', 'Cosign review band lowered']], link: ['/network?member=exB', 'Open in Network Members'] },
  registry: { type: 'ThreatRegistry', name: 'Entry #4,118', status: 'Verified · shared', tone: 'honey', summary: 'Verified threat written by QuorumReceiver, consumed by members.', state: [['Address', '0x7a3f…91c2', true], ['Fingerprint', 'decoy-touch · velocity · fresh-funded'], ['Expiry', 'TTL 30d'], ['Consumed', '36 / 38 members']], link: ['/registry', 'Open ThreatRegistry'] },
  hot: { type: 'Vault · Hot', name: 'Hot Vault', status: 'Quota cleared', tone: 'amber', summary: 'Hot liquidity halted; 1,120 ETH swept to cold.', state: [['Balance', '1,280 ETH'], ['Quota', '0 / 2,400 ETH · 24h'], ['Restriction', 'Outflow halted'], ['Timelock', 'none'], ['Latest action', 'Sweep 1,120 ETH → cold']], evidence: [['Authority', 'Report #78452 via QuorumReceiver', true]], link: ['/vaults?vault=hot', 'Open Hot Vault'] },
  warm: { type: 'Vault · Warm', name: 'Warm Vault', status: 'Cosign-only', tone: 'amber', summary: 'Access narrowed to co-signed withdrawals for 6h.', state: [['Balance', '18,400 ETH'], ['Quota', '2,400 / 6,000 ETH'], ['Restriction', 'Cosign-only · 6h'], ['Timelock', '6h freeze'], ['Latest action', 'Open → Cosign-only']], link: ['/vaults?vault=warm', 'Open Warm Vault'] },
  cold: { type: 'Vault · Cold', name: 'Cold Vault', status: 'Timelock extended', tone: 'amber', summary: 'Receives swept funds; releases delayed.', state: [['Balance', '1.84M ETH'], ['Restriction', 'Withdrawals queued'], ['Timelock', '24h → 72h'], ['Latest action', 'Received sweep 1,120 ETH']], link: ['/vaults?vault=cold', 'Open Cold Vault'] },
  route: { type: 'Verified route', name: 'Origin trace', status: 'Source identified', tone: 'honey', summary: 'Trace narrowed five candidate routes to one verified path.', state: [['Route', 'DW-07 → 0x7a3f…91c2', true], ['Status', 'Verified · 4 rejected'], ['Workflow stage', 'Trap → CRE verification'], ['Verification', '7 / 7 · report #78452']], link: ['/workflows?tab=Trap', 'Open Trap workflow'] },
  backend: { type: 'Exchange backend', name: 'Backend · Bybit', status: 'Untrusted', tone: 'grey', summary: 'Can submit requests to RequestBoard. Cannot authorize fund movement — it has no path to QuorumVault.', state: [['Reaches', 'RequestBoard only'], ['Requests · 1h', '412'], ['Forged / invalid', '3 · signature failure']], linked: 'Incident #QRM-78452', link: ['/requests', 'Inspect via RequestBoard'] },
  req: { type: 'Withdrawal request', name: 'RB-310938', status: 'Approved · executed', tone: 'grey', summary: 'WithdrawalRequested → Cosign → QuorumReceiver → QuorumVault.', state: [['Account', 'acct 0c7d…91', true], ['Amount', '2,500 USDT'], ['Destination', '0x7710…c3a8', true], ['Timestamp', '14:00:12'], ['Cosign verdict', 'Approve · 7/7 gates'], ['Execution', 'Executed']], link: ['/requests?id=RB-310938', 'Open request'] },
  forged: { type: 'Unverified request', name: 'Forged requests', status: 'Signature invalid', tone: 'red', summary: 'Never enters the Cosign route. Stopped at the trap layer.', state: [['Lane', 'Invalid · 3 requests'], ['Reason', 'Intent signature mismatch'], ['Trap link', 'RB-310944 touched DW-07']], link: ['/requests?lane=invalid', 'Open invalid lane'] },
  verdict: { type: 'VerdictRecorded', name: 'Cosign verdict', status: 'Latest: approve', tone: 'honey', summary: 'Cosign verdict delivered to QuorumReceiver.', state: [['Request hash', '0x4e2a…c1f0', true], ['Request → verdict', '2.1s'], ['Pending', 'amber dashed'], ['Reject', 'red stop-line']], link: ['/requests?id=RB-310941', 'Open request verdict'] },
  key: { type: 'Key delay account', name: 'acct 41aa…7c', status: 'KeyRegistry notBefore', tone: 'honey', summary: 'Key recently rotated — withdrawals wait until notBefore.', state: [['Key status', 'Rotated · delayed'], ['notBefore', '14:44:20 UTC'], ['Last key change', '13:44:20 UTC'], ['Funding proof', 'Deposit 12 ETH · 3 conf']], link: ['/requests?account=acct%2041aa%E2%80%A67c', 'Open account'] },
  approval: { type: 'Manual approval', name: 'Warm Vault release', status: '1 / 2 signatures · pending', tone: 'honey', summary: 'Human path into the vaults for release, freeze extension and relaxation.', state: [['Signed', 'ops.lin'], ['Required', '2 of 2'], ['Linked vault', 'Warm Vault'], ['Expiry', 'in 3h 12m'], ['Queued', '14:06:10']], link: ['/approvals?id=AP-0412', 'Open Approvals'] },
  quota: { type: 'Quota bucket', name: 'Hot Vault quota', status: 'Drained to 0', tone: 'amber', summary: 'Quota cleared by the tightening directive.', state: [['Remaining', '0 / 2,400 ETH'], ['Before', '1,120 ETH'], ['Refill', 'Paused while tightened'], ['Authority', 'Report #78452']], link: ['/vaults?vault=hot', 'Open Hot Vault'] },
  bridge: { type: 'Cross-member propagation', name: 'Entry #4,118 → Bitget', status: '36 / 38 acknowledged', tone: 'honey', summary: 'Verified threat shared through ThreatRegistry. Members tighten their own review — no automatic freeze.', state: [['Path', 'Bybit → Registry → Bitget'], ['Ack', '14:02:44'], ['Response', 'Stricter Cosign review']], link: ['/network?member=exB', 'Open Network Members'] },
}
const WF: Record<string, [string, string, string]> = { trap: ['Trap', '7 / 7 · healthy', 'Last run 14:02:38 · report #78452'], cosign: ['Cosign', '7 / 7 · healthy', 'Last run 14:06:41 · 2.1s verdict'], patrol: ['Patrol', 'Delayed · missed run > 2m', 'Last success 14:03:12 · 1 failure'] }
for (const [k, [n, st, last]] of Object.entries(WF)) DETAILS[`wf-${k}`] = { type: 'CRE workflow', name: `${n} workflow`, status: st, tone: k === 'patrol' ? 'amber' : 'honey', summary: k === 'patrol' ? 'Continuous inspection. Latest run found a conservation Δ on Cold Vault.' : k === 'trap' ? 'Verifies decoy interactions.' : 'Seven-gate check on every withdrawal request.', state: [['Health', st], ['Latest', last], ['Mode', 'PROD · DON consensus']], evidence: k === 'patrol' ? [['Anomaly', 'Cold Vault Δ −8 ETH'], ['Next retry', '14:08:00']] : undefined, link: [`/workflows?tab=${n}${k === 'patrol' ? '&view=health' : ''}`, `Open ${n} workflow`] }
const GATES = ['Intent signature', 'RequestBoard match', 'ThreatRegistry', 'Destination age', 'Velocity', 'Quota bucket', 'Patrol reconciliation']
GATES.forEach((g, i) => { DETAILS[`gate-${i + 1}`] = { type: `Cosign gate ${i + 1} / 7`, name: g, status: i === 5 ? '2 requests held' : 'passing', tone: i === 5 ? 'amber' : 'honey', summary: `Requests blocked or held at gate ${i + 1}.`, state: [['Held · 24h', i === 5 ? '2' : String(i % 3)], ['Reason code', `G${i + 1}_${g.toUpperCase().replace(/ /g, '_')}`]], link: [`/requests?gate=${i + 1}`, 'Open filtered requests'] } })
;(['hot', 'warm', 'cold'] as const).forEach((v) => {
  const name = v[0].toUpperCase() + v.slice(1)
  DETAILS[`check-${v}`] = { type: 'Asset conservation', name: `${name} Vault checkpoint`, status: v === 'cold' ? 'Discrepancy Δ −8 ETH' : 'Balanced', tone: v === 'cold' ? 'amber' : 'grey', summary: 'Expected vs observed balance, reconciled every Patrol run.', state: v === 'cold' ? [['Expected', '12,480 ETH'], ['Observed', '12,472 ETH'], ['Δ', '−8 ETH'], ['Checked', '14:06:12 · Ethereum']] : [['Expected', 'matches'], ['Observed', 'matches'], ['Δ', '0']], link: [`/vaults?vault=${v}&section=reconciliation`, 'Open reconciliation'] }
  DETAILS[`drift-${v}`] = { type: 'Config integrity', name: `${name} Vault config`, status: v === 'warm' ? 'Config drift' : 'Hash matches', tone: v === 'warm' ? 'amber' : 'grey', summary: 'configHash compared against the timelocked policy.', state: v === 'warm' ? [['Expected', '0x8a1f…c204', true], ['Current', '0x8a1f…e9b7', true], ['Changed keys', 'cosign.band'], ['Proposer', 'ops.kade'], ['Timelock', 'not queued']] : [['configHash', 'matches ConfigTimelock']], link: [`/config?policy=${v}`, 'Open Config & Timelock'] }
})

export function NodeDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const n = NODES.find((x) => x.id === id)
  const d = DETAILS[id] ?? (n && { type: n.kind, name: n.name, status: n.status, summary: n.event, state: [['Restriction', n.restriction]] as Rows, link: ['/', 'Overview'] as [string, string] })
  if (!d) return null
  const tone = { honey: 'text-honey', amber: 'text-amber', red: 'text-[#FF7A7E]', grey: 'text-dim' }[d.tone ?? 'honey']
  const sec = (t: string, rows?: Rows) => rows && rows.length > 0 && (
    <div className="px-5 pt-3"><div className="text-[10.5px] font-mono uppercase tracking-wider text-mute">{t}</div><dl>{rows.map(([k, v, mono]) => <Row key={k} k={k} mono={mono}>{v}</Row>)}</dl></div>
  )
  return (
    <Panel className="flex flex-col h-full bg-coal-2/90 backdrop-blur-md">
      <div className="px-5 pt-5 pb-3 flex items-start justify-between">
        <div>
          <Label>{d.type}</Label>
          <div className="mt-1 text-[18px] font-semibold text-cream flex items-center gap-2">
            {d.tone === 'red' && <svg width="12" height="11" viewBox="0 0 10 9"><polygon points="0.5,0.5 9.5,0.5 5,8.5" fill="#E5484D" /></svg>}
            {d.name}
          </div>
          <div className={`mt-1 font-mono text-[11px] uppercase tracking-wider ${tone}`}>{d.status}</div>
        </div>
        <button onClick={onClose} aria-label="Close detail" className="h-7 w-7 grid place-items-center rounded text-dim hover:text-cream hover:bg-white/[0.04]">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto pb-3">
        <p className="px-5 text-[12.5px] text-dim leading-relaxed">{d.summary}</p>
        {sec('State', d.state)}
        {sec('Evidence', d.evidence)}
        {d.timeline && (
          <div className="px-5 pt-3"><div className="text-[10.5px] font-mono uppercase tracking-wider text-mute">Timeline</div>
            <ol className="mt-1.5 space-y-1">{d.timeline.map(([t, e]) => <li key={t} className="flex gap-3 text-[12.5px]"><span className="font-mono text-mute">{t}</span><span className="text-cream">{e}</span></li>)}</ol></div>
        )}
        {d.linked && <div className="px-5 pt-3 text-[12.5px]"><span className="text-mute">Linked · </span><span className="text-cream">{d.linked}</span></div>}
      </div>
      <div className="px-5 py-4 border-t border-white/[0.05]"><Link to={d.link[0]} className="text-[13px] text-honey hover:text-flare">{d.link[1]} →</Link></div>
    </Panel>
  )
}

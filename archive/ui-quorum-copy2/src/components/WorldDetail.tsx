import { Link } from 'react-router'
import { Icon } from './ui'
import { ALL_RECEIVED, DECOYS, ORIGIN_AGENCY, ORIGIN_DECOY, PROTECTED, RECEIVERS, T, agency, arriveAt, parsePick, type Agency } from './worldData'

type Tone = 'gold' | 'red' | 'amber' | 'grey'
type KV = [string, string, Tone?]
type Detail = { eyebrow: string; title: string; tone: Tone; state: [string, Tone]; agency: string; latest: string; rows: KV[]; note?: string; action?: [string, string] }

/** incident-relative view of the world, so panels stay truthful to the replay position */
type Clock = { t: number; trace: boolean; traceT: number }
const fired = (c: Clock) => c.trace || c.t >= T.trigger
const recvAt = (a: Agency) => (a.id === ORIGIN_AGENCY.id ? T.toLocalEnd : arriveAt(RECEIVERS.findIndex((r) => r.id === a.id)))
const stamp = (sec: number) => { const s = 7 + Math.round(sec); return `14:02:${String(s).padStart(2, '0')}` }
const TIER_NAMES = ['Hot', 'Warm', 'Cold'] as const

function detail(id: string, c: Clock): Detail | null {
  const p = parsePick(id)
  if (!p) return null
  const incident = fired(c)
  const verified = c.trace || c.t >= T.toGlobalEnd
  if (p.kind === 'decoy') {
    const d = DECOYS.find((x) => x.id === p.id)!
    const o = d.id === ORIGIN_DECOY.id && incident
    return {
      eyebrow: 'Decoy · honey beacon', title: `Decoy ${d.name}`, tone: o ? 'red' : 'gold',
      state: o ? ['Triggered', 'red'] : ['Armed · idle', 'gold'],
      agency: `Agency ${agency(d.agency).letter} · ${agency(d.agency).name}`,
      latest: o ? '14:02:07 · hostile wallet interaction' : 'No interaction in window',
      rows: [
        ['Trigger', o ? 'Approval call on bait allowance' : 'Armed · approval + transfer bait'],
        ['Source', o ? '0x7a3f…91c2' : '—'],
        ['Verification', o ? (verified ? 'Verified · CRE 7 / 7' : 'Verifying…') : '—', o ? (verified ? 'gold' : 'amber') : undefined],
        ['Linked incident', o ? 'QRM-78452' : '—'],
      ],
      action: o ? ['Open incident QRM-78452', '/cases/QRM-78452'] : ['Open Triggers', '/controls?tab=triggers'],
    }
  }
  if (p.kind === 'global') {
    const sent = c.trace ? RECEIVERS.length : RECEIVERS.filter((_, i) => c.t >= arriveAt(i)).length
    return {
      eyebrow: 'Network capital', title: 'Global Quorum Core', tone: 'gold',
      state: incident ? ['Incident active', 'amber'] : ['Nominal', 'gold'],
      agency: 'Quorum network · all members',
      latest: verified ? `${stamp(T.toGlobalEnd)} · DW-07 evidence verified` : incident ? 'Awaiting evidence from Agency A' : 'No verified signal in window',
      rows: [
        ['Network health', 'DON 7 / 7 nodes'],
        ['Connected agencies', `${PROTECTED.length} protected · 2 outside`],
        ['Active incident', incident ? 'QRM-78452 · Agency A' : 'None'],
        ['Propagation', !incident ? 'Idle' : c.trace || c.t >= ALL_RECEIVED ? `Delivered ${sent} / ${RECEIVERS.length}` : c.t >= T.dispatch ? `Dispatching ${sent} / ${RECEIVERS.length}` : 'Awaiting verification', incident ? 'gold' : undefined],
      ],
      note: 'Verifies and distributes intelligence. Never holds or moves funds.',
      action: ['Open CRE workflows', '/controls?tab=workflows'],
    }
  }
  const a = agency(p.agency)
  if (!a.protected) return { eyebrow: `Agency ${a.letter}`, title: a.name, tone: 'grey', state: ['Unprotected', 'grey'], agency: `Agency ${a.letter}`, latest: 'Not onboarded to Quorum', rows: [], note: 'No Quorum protection active. Shared threat intelligence is not delivered to this territory.' }
  const got = c.trace || (c.t >= 0 && c.t >= recvAt(a))
  const isO = a.id === ORIGIN_AGENCY.id
  const who = `Agency ${a.letter} · ${a.name}`
  if (p.kind === 'vault') {
    const locked = got && (c.trace || c.t >= recvAt(a) + 0.6)
    const tiers = TIER_NAMES.slice(0, a.tiers)
    return {
      eyebrow: 'Vault building', title: `${tiers.join(' · ')} Vault`, tone: locked ? 'amber' : 'gold',
      state: locked ? [isO ? 'Hot paused' : 'Tightened', 'amber'] : ['Stable', 'gold'], agency: who,
      latest: locked ? `${stamp(recvAt(a) + 0.6)} · tiers locked` : 'Checkpoint balanced',
      rows: [
        ['Available tiers', `${tiers.join(' + ')} · ${a.tiers} of 3`],
        ['Balance', a.tiers === 3 ? '18,420 ETH' : a.tiers === 2 ? '7,960 ETH' : '2,140 ETH'],
        ['Quota', locked ? (isO ? '0 / 6,000 ETH' : '1,200 / 6,000 ETH') : '2,400 / 6,000 ETH', locked ? 'amber' : undefined],
        ['Restriction', locked ? (isO ? 'Hot paused · registry match' : 'Registry screen strict') : 'None', locked ? 'amber' : undefined],
        ['Timelock', a.tiers === 3 ? 'Cold 24h' : a.tiers === 2 ? 'Warm 6h' : '—'],
      ],
      action: ['Open vault controls', '/controls?tab=vaults'],
    }
  }
  return {
    eyebrow: p.kind === 'core' ? 'Local Agency Core' : 'Protected territory', title: p.kind === 'core' ? `Local Core · ${a.letter}` : a.name, tone: isO && incident ? 'red' : 'gold',
    state: isO && incident ? ['Responding', 'red'] : got ? ['Signal received', 'gold'] : ['Listening', 'gold'], agency: who,
    latest: got ? `${stamp(recvAt(a))} · ${isO ? 'local trigger DW-07' : 'Registry #4,118'}` : 'No signal in window',
    rows: [
      ['Service state', 'Protected · onboarded', 'gold'],
      ['CRE status', got ? 'Signal verified' : 'Listening'],
      ['Current response', got ? (isO ? 'Hot vault paused · decoy re-armed' : 'Stricter Cosign on match') : 'Standing policy', got ? 'amber' : undefined],
      ['Vault tiers', TIER_NAMES.slice(0, a.tiers).join(' + ')],
      ['Decoys', DECOYS.filter((d) => d.agency === a.id).map((d) => d.name).join(' · ')],
    ],
    action: ['Open in Network', `/network?member=${encodeURIComponent(a.name)}`],
  }
}

const TONE = { gold: 'text-[#E2B52E]', red: 'text-[#ff8a7d]', amber: 'text-amber', grey: 'text-dim' }
const DOT = { gold: 'bg-[#D6A61F]', red: 'bg-[#E5484D]', amber: 'bg-amber', grey: 'border border-[#8a877f]' }

const mono = (v: string) => /0x|#|ETH|\d{2}:\d{2}|DW-|QRM|\d \/ \d/.test(v)

/** right half of inspection mode — large, scannable hierarchy */
export function DetailPanel({ id, t, trace, traceT, onClose }: { id: string; t: number; trace: boolean; traceT: number; onClose: () => void }) {
  const d = detail(id, { t, trace: trace && traceT >= 0, traceT: Math.max(0, traceT) })
  if (!d) return null
  return (
    <aside className="pointer-events-auto h-full flex flex-col bg-[#0b0e16]/94 backdrop-blur-xl border-l border-white/[0.07] shadow-[-40px_0_80px_-30px_rgba(0,0,0,0.8)]">
      <header className="px-10 pt-9 pb-7 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-mute">{d.eyebrow}</span>
          <button onClick={onClose} aria-label="Close inspection" className="-mr-2 h-9 px-3 flex items-center gap-2 rounded-md font-mono text-[10.5px] uppercase tracking-[0.14em] text-dim hover:text-cream hover:bg-white/[0.05]">Esc<Icon name="close" size={15} /></button>
        </div>
        <h2 className="mt-4 text-[40px] leading-[1.05] font-semibold tracking-[-0.02em] text-cream">{d.title}</h2>
        <div className="mt-4 flex items-center gap-2.5">
          <span className={`w-2.5 h-2.5 ${d.state[1] === 'red' ? 'clip-tri' : 'clip-hex'} ${DOT[d.state[1]]}`} />
          <span className={`font-mono text-[13px] uppercase tracking-[0.18em] ${TONE[d.state[1]]}`}>{d.state[0]}</span>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-10 py-7">
        <dl className="grid grid-cols-2 gap-px rounded-lg overflow-hidden bg-white/[0.06] border border-white/[0.06]">
          <div className="bg-[#0e121b] px-5 py-4"><dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-mute">Agency</dt><dd className="mt-1.5 text-[15px] text-cream">{d.agency}</dd></div>
          <div className="bg-[#0e121b] px-5 py-4"><dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-mute">Latest event</dt><dd className={`mt-1.5 text-[15px] text-cream ${mono(d.latest) ? 'font-mono text-[13.5px]' : ''}`}>{d.latest}</dd></div>
        </dl>
        {d.rows.length > 0 && (
          <dl className="mt-7 divide-y divide-white/[0.06]">
            {d.rows.map(([k, v, tn]) => (
              <div key={k} className="grid grid-cols-[160px_1fr] gap-4 py-3.5 items-baseline">
                <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">{k}</dt>
                <dd className={`text-[15px] ${tn ? TONE[tn] : 'text-cream'} ${mono(v) ? 'font-mono text-[13.5px]' : ''}`}>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {d.note && <p className="mt-6 max-w-[46ch] text-[14px] leading-relaxed text-dim">{d.note}</p>}
        {d.action && <Link to={d.action[1]} className="mt-8 inline-flex items-center gap-3 h-11 px-4 rounded-md bg-[#D6A61F]/12 border border-[#D6A61F]/30 text-[14px] font-medium text-[#E2B52E] hover:bg-[#D6A61F]/20">{d.action[0]}<Icon name="arrow" size={15} /></Link>}
      </div>
      <footer className="px-10 py-4 border-t border-white/[0.06] flex justify-between font-mono text-[10px] tracking-[0.14em] uppercase text-mute">
        <span>Drag to orbit · scroll to zoom the model</span><span>Demo fixture · not live telemetry</span>
      </footer>
    </aside>
  )
}

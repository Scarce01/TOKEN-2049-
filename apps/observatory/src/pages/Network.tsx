import { Link } from 'react-router'
import { Metric, Mono, Panel, PageHeader } from '../components/ui'
import { ALERT, readEvents, readLive, useLive, type ChainEvent, type LiveOrg } from '../live/chain'

// The onboarded network, live from the fork. The backend runs two exchanges (org A / org B); a confirmed
// threat at one is written to the shared ThreatRegistry and is readable by the other within the same block.
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`
const hhmmss = (t: number) => (t ? new Date(t * 1000).toISOString().slice(11, 19) : '--:--:--')

export default function Network() {
  const live = useLive(readLive, 5000)
  const events = useLive(readEvents, 6000)
  const now = live.data?.chainTime ?? 0
  const orgs = live.data?.orgs ?? []
  const threats = (events.data ?? []).filter((e) => e.name === 'ThreatAdded').slice().reverse()
  const alerts = orgs.filter((o) => o.alert > 0 && o.alertExpiresAt > now).length

  return (
    <div className="max-w-[1480px]">
      <PageHeader eyebrow="Shared defence" title="Network"
        desc="Connected exchanges share confirmed threats through the on-chain ThreatRegistry. A trap hit at one member is reusable intelligence for every other, with no shared backend to compromise. Live from the Base Sepolia fork." />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Connected" value={orgs.length || '…'} sub="exchanges on this deployment" status="active" />
        <Metric label="Active alerts" value={orgs.length ? alerts : '…'} sub="members tightened now" status={alerts ? 'threat' : 'active'} />
        <Metric label="Shared threats" value={live.data ? live.data.activeConfirmed : '…'} sub="confirmed, network-wide" status={live.data?.activeConfirmed ? 'warning' : 'active'} />
        <Metric label="Registry entries" value={threats.length} sub="written on chain" status="active" />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-5">
        {(orgs.length ? orgs : [undefined, undefined]).map((o, i) => (o ? <MemberCard key={o.letter} o={o} now={now} threats={threats} /> : <div key={i} className="h-[150px] rounded-xl bg-white/[0.02]" />))}
      </div>

      <Panel title="Threat propagation">
        {threats.length === 0 ? (
          <p className="px-5 py-8 text-[13px] text-mute">No threats shared on the fork yet. A confirmed trap hit publishes one here, readable by every member.</p>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {threats.slice(0, 12).map((t) => (
              <li key={`${t.tx}:${t.logIndex}`} className="px-5 py-3 grid grid-cols-[1fr_1fr_auto] items-center gap-3 text-[13px]">
                <span className="font-mono text-honey">{short(String(t.args.suspect))}</span>
                <span className="text-dim">reported by {t.org?.name ?? 'org'} · readable by all members</span>
                <span className="font-mono text-[11.5px] text-mute">blk {t.block.toLocaleString('en-US')} · {hhmmss(t.time)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <p className="mt-4 text-[11px] text-mute">Testnet fork, measured. Registry entries: <Link to="/registry" className="text-honey hover:underline">ThreatRegistry</Link>.</p>
    </div>
  )
}

function MemberCard({ o, now, threats }: { o: LiveOrg; now: number; threats: ChainEvent[] }) {
  const alerted = o.alert > 0 && o.alertExpiresAt > now
  const reported = threats.filter((t) => t.org?.letter === o.letter).length
  const tone = o.alert >= 4 && alerted ? 'text-[#ff8a7a]' : alerted ? 'text-[#e9c46a]' : 'text-[#5fd38d]'
  const dot = o.alert >= 4 && alerted ? 'bg-[#ff6b5a]' : alerted ? 'bg-[#e9c46a]' : 'bg-[#5fd38d]'
  return (
    <Panel className="p-5">
      <div className="flex items-center gap-2">
        <span className="text-[16px] font-semibold text-cream">{o.name}</span>
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span className={`text-[12px] ${tone}`}>{alerted ? `Alert ${ALERT[o.alert]}` : 'Monitoring'}</span>
        <span className="ml-auto font-mono text-[11px] text-mute">{o.mode}</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 text-[12px]">
        <div><div className="text-dim">Receiver</div><Mono>{short(o.receiver)}</Mono></div>
        <div><div className="text-dim">Last ping</div><span className="font-mono text-cream">{o.lastPingBlock ? `blk ${o.lastPingBlock.toLocaleString('en-US')}` : 'never'}</span></div>
        <div><div className="text-dim">Threats reported</div><span className="font-mono text-cream">{reported}</span></div>
      </div>
      <div className="mt-3 text-[12px]"><span className="text-dim">Shares decoys & confirmed threats with the network</span></div>
    </Panel>
  )
}

import { useState } from 'react'
import { DataTable, Drawer, Label, Metric, Mono, Panel, PageHeader, Row } from '../components/ui'
import { readEvents, readLive, useLive, type ChainEvent } from '../live/chain'

// ThreatRegistry, live from the fork: every ThreatAdded log since deployment. A derived entry
// (parentEvidence != 0) is one Trek traced from a confirmed root.
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`
const hhmmss = (t: number) => (t ? new Date(t * 1000).toISOString().slice(11, 19) : '--:--:--')
const derived = (e: ChainEvent) => !/^0x0*$/.test(String(e.args.parentEvidence ?? '0x0'))
function expLeft(sec: number, now: number) {
  const d = sec - now
  if (d <= 0) return 'expired'
  const dd = Math.floor(d / 86400), h = Math.floor((d % 86400) / 3600)
  return dd ? `${dd}d ${h}h` : `${h}h ${Math.floor((d % 3600) / 60)}m`
}

export default function Registry() {
  const live = useLive(readLive, 6000)
  const events = useLive(readEvents, 6000)
  const [open, setOpen] = useState<ChainEvent | null>(null)
  const now = live.data?.chainTime ?? 0
  const threats = (events.data ?? []).filter((e) => e.name === 'ThreatAdded').slice().reverse()
  const newest = threats[0]
  const day = threats.filter((t) => t.time > now - 86400).length

  return (
    <div className="max-w-[1480px]">
      <PageHeader eyebrow="Network intelligence" title="ThreatRegistry"
        desc="When a threat is verified it becomes reusable network intelligence. Each entry is written on chain, carries its own evidence hash, and is readable by every connected member's Cosign workflow. Live from the Base Sepolia fork." />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Active confirmed" value={live.data ? live.data.activeConfirmed : '…'} sub="network-wide, unexpired" status={live.data?.activeConfirmed ? 'warning' : 'active'} />
        <Metric label="Entries on chain" value={threats.length} sub={`+${day} in last 24h`} status="active" />
        <Metric label="Newest" value={newest ? short(String(newest.args.suspect)) : '—'} sub={newest ? `${newest.org?.name ?? 'org'} · ${hhmmss(newest.time)}` : 'none yet'} status={newest ? 'threat' : undefined} />
        <Metric label="Traced (derived)" value={threats.filter(derived).length} sub="Trek edges from a root" status="active" />
      </div>
      <Panel>
        {threats.length === 0 ? (
          <p className="px-5 py-8 text-[13px] text-mute">No ThreatRegistry entries on the fork yet. Run an attack from the Overview to create one.</p>
        ) : (
          <DataTable rows={threats} rowKey={(t) => `${t.tx}:${t.logIndex}`} selected={open ? `${open.tx}:${open.logIndex}` : undefined} onSelect={setOpen} cols={[
            { key: 'suspect', label: 'Suspect', render: (t) => <span className="font-mono text-honey">{short(String(t.args.suspect))}</span> },
            { key: 'kind', label: 'Kind', render: (t) => <span className="text-dim text-[12.5px]">{derived(t) ? 'Traced' : 'Root (confirmed)'}</span> },
            { key: 'ev', label: 'Evidence', render: (t) => <Mono>{short(String(t.args.evidenceHash))}</Mono> },
            { key: 'src', label: 'Reporter', render: (t) => <span className="text-dim">{t.org?.name ?? 'org'}</span> },
            { key: 'count', label: 'Hits', align: 'right', render: (t) => <span className="font-mono text-cream">{Number(t.args.count ?? 0)}</span> },
            { key: 'ttl', label: 'Expires', align: 'right', render: (t) => <span className="font-mono text-[12px] text-mute">{expLeft(Number(t.args.expiresAt), now)}</span> },
            { key: 'blk', label: 'Block', align: 'right', render: (t) => <span className="font-mono text-[12px] text-mute">{t.block.toLocaleString('en-US')}</span> },
          ]} />
        )}
      </Panel>

      <Drawer open={!!open} onClose={() => setOpen(null)} eyebrow="Registry entry" title={open ? short(String(open.args.suspect)) : ''}>
        {open && (
          <div className="space-y-1">
            <Row k="Suspect" mono>{String(open.args.suspect)}</Row>
            <Row k="Kind">{derived(open) ? 'Derived (Trek-traced edge)' : 'Root (confirmed trap hit)'}</Row>
            <Row k="Reporter">{open.org?.name ?? 'org'}</Row>
            <Row k="Evidence" mono>{String(open.args.evidenceHash)}</Row>
            <Row k="Fingerprint" mono>{short(String(open.args.fingerprintHash))}</Row>
            {derived(open) && <Row k="Parent" mono>{short(String(open.args.parentEvidence))}</Row>}
            <Row k="Hits">{Number(open.args.count ?? 0)}</Row>
            <Row k="Expires">{expLeft(Number(open.args.expiresAt), now)} ({hhmmss(Number(open.args.expiresAt))} UTC)</Row>
            <Row k="Added">block {open.block.toLocaleString('en-US')} · {hhmmss(open.time)} UTC</Row>
            <Row k="Tx" mono>{open.tx}</Row>
            <div className="pt-3"><Label>Source</Label><p className="mt-1 text-[12px] text-mute">Testnet fork, measured on chain.</p></div>
          </div>
        )}
      </Drawer>
    </div>
  )
}

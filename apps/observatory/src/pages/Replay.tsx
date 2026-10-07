import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import PaidInvestigationCard from '../components/PaidInvestigationCard'
import SolanaGuardCard from '../components/SolanaGuardCard'
import { DataTable, Metric, PageHeader, Panel, Row, Tabs, VTimeline } from '../components/ui'
import replay from '../data/replay.json'

// Incident Replay: historical attacks replayed against public on-chain transfers (analysis/trace_bybit,
// exported by export_ui.py). Known-ground-truth recovery, not live attribution. The Controls tab adds the
// enforcement receipt of the last real attack on the fork, read from the indexer (/history).
type Hop = { hop: number; flagged: number; found: number }
type Truth = { address: string; label: string | null; hop: number | null; taintPct: number | null; recovered: boolean; ethereumOnly?: boolean }
export type ReplayCase = {
  id: string
  exchange: string
  when: string
  groundTruth: string
  truthSize: number
  seeds: number
  windowBlocks: number
  discoveryFloorPct: number
  highViewPct: number
  recovered: number
  topN: number
  candidates: number
  graph: { addresses: number; edges: number }
  hops: Hop[]
  fullRecoveryHop: number | null
  highViewHolds: number
  coverage: string
  crossChain: boolean
  ethOnly: { recovered: number; candidates: number } | null
  breakpoints: { unit: string; totals: Record<string, number>; addresses: Record<string, number> }
  attackerLike: { count: number; on_fbi: number }
  truth: Truth[]
  network?: { chains: { chain: string; reached: number; skipped: string | null; bridges: Record<string, number>; usd: number }[]; links: number; bridgedUsd: number }
  timeline?: { utc: string; event: string }[]
  controls?:
    | { kind: 'spike'; events: Record<string, string>; rule: { kind: string; first_alarm: string; minutes_after_large_outflow: number; false_alarms_per_day: number; before_bitget_detected: boolean }[]; note: string }
    | { kind: 'trek'; watchBudget: number; proposed: number; of: number; stillUnmovedPct: Record<string, number>; note: string }
}
export const CASES = replay.cases as unknown as ReplayCase[]

const TABS = ['Incident', 'Network', 'Controls'] as const
type Tab = (typeof TABS)[number]
const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(1).replace(/\.0$/, '')}%`
const n = (x: number) => x.toLocaleString('en-US')
const usd = (x: number) => (x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${n(Math.round(x))}`)
const NAMES: Record<string, string> = { bsc: 'BSC', across: 'Across', stargate: 'Stargate' }
const cap = (s: string) => NAMES[s] ?? s.charAt(0).toUpperCase() + s.slice(1)

export function proves(c: ReplayCase): string {
  const start = c.seeds === 1 ? 'Starting from one known attacker address' : `Starting from ${c.seeds} seeds`
  if (c.fullRecoveryHop)
    return `${start}, Qu3ee recovered all ${c.truthSize} ${c.exchange} addresses on the ground-truth list within ${c.fullRecoveryHop} hops using public ${c.coverage} transfers.`
  const eth = c.ethOnly ? ` The Ethereum-only replay recovered ${c.ethOnly.recovered} of ${c.truthSize}.` : ''
  return `${start}, Qu3ee recovered ${c.recovered} of ${c.truthSize} known ${c.exchange} wallets at the ≥${c.discoveryFloorPct}% discovery floor. The ≥${c.highViewPct}% view holds ${c.highViewHolds} of ${c.truthSize}.${eth}`
}

export default function Replay() {
  const { case: id, tab } = useParams()
  const nav = useNavigate()
  const c = CASES.find((x) => x.id === id) ?? CASES[0]!
  const t = (TABS.find((x) => x.toLowerCase() === tab) ?? 'Incident') as Tab
  const go = (cid: string, tt: Tab) => nav(`/cases/replay/${cid}/${tt.toLowerCase()}`)

  return (
    <div className="max-w-[1480px]">
      <PageHeader
        eyebrow="Incident replay · public on-chain"
        title={<>{c.exchange} {c.when} <span className="ml-2 align-middle text-[12px] font-mono tracking-[0.14em] text-honey border border-honey/40 rounded px-1.5 py-0.5">REPLAY</span></>}
        desc="Historical replay against public on-chain transfers. This is known-ground-truth recovery, not a live incident."
        actions={<Link to="/cases?tab=history" className="text-[13px] text-dim hover:text-cream">All incidents</Link>}
      />
      <div className="flex flex-wrap gap-2 mb-4">
        {CASES.map((x) => (
          <button key={x.id} onClick={() => go(x.id, t)}
            className={`h-8 px-3 rounded-md border text-[12.5px] ${x.id === c.id ? 'border-honey bg-honey/10 text-cream' : 'border-white/10 text-dim hover:text-cream hover:border-honey/40'}`}>
            {x.exchange} <span className="font-mono text-[11px] text-mute">{x.when}</span>
          </button>
        ))}
      </div>
      <Panel className="mb-5">
        <Tabs tabs={TABS} value={t} onChange={(tt) => go(c.id, tt)} />
        <div className="px-5 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-mute">
          Replay · public on-chain · 2026-10-07 · historical replay, not live attribution, known-ground-truth only
        </div>
      </Panel>
      {t === 'Incident' && <IncidentTab c={c} />}
      {t === 'Network' && <NetworkTab c={c} />}
      {t === 'Controls' && <ControlsTab c={c} />}
    </div>
  )
}

/* ---------------------------------------------------------------- Incident: what happened, what we recovered */

function IncidentTab({ c }: { c: ReplayCase }) {
  const full = c.fullRecoveryHop
  return (
    <>
      <Panel className="px-5 py-4 mb-5">
        <div className="text-[12px] text-mute">What this proves</div>
        <p className="mt-1 text-[15px] leading-relaxed text-cream">{proves(c)}</p>
        <Flow steps={[
          `${c.seeds === 1 ? 'Seed address' : `${c.seeds} seed addresses`}`,
          `Qu3ee finds ${c.recovered} / ${c.truthSize} known wallets`,
          `Recall ${pct(c.recovered, c.truthSize)}`,
          `Top-${c.truthSize} precision ${pct(c.topN, c.truthSize)}`,
        ]} />
      </Panel>

      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Known wallets recovered" value={`${c.recovered} / ${c.truthSize}`} sub={`Discovery floor ≥${c.discoveryFloorPct}% taint`} status="active" />
        <Metric label={`Top-${c.truthSize} precision`} value={`${pct(c.topN, c.truthSize)}`} sub={`${c.topN}/${c.truthSize} · ${n(c.candidates)} candidates ranked`} />
        <Metric label="Full recovery reached" value={full ? `Hop ${full}` : 'Not reached'} sub={full ? `High-confidence view ≥${c.highViewPct}% taint` : `≥${c.highViewPct}% view holds ${c.highViewHolds} / ${c.truthSize}`} status={full ? 'active' : 'warning'} />
        <Metric label="Graph explored" value={n(c.graph.addresses)} sub={`addresses · ${n(c.graph.edges)} edges`} />
      </div>

      <div className="grid grid-cols-[1fr_1.4fr] gap-4 mb-5">
        <Panel title="Case">
          <dl className="px-5 pb-4">
            <Row k="Case" mono>{c.id}</Row>
            <Row k="Exchange">{c.exchange}</Row>
            <Row k="Ground truth">{c.groundTruth}</Row>
            <Row k="Recall">{pct(c.recovered, c.truthSize)} · {c.recovered} / {c.truthSize}</Row>
            <Row k="Seed addresses">{c.seeds}</Row>
            <Row k="Replay source">Public on-chain</Row>
            <Row k="Window">{n(c.windowBlocks)} blocks</Row>
            <Row k="Discovery floor">≥ {c.discoveryFloorPct}% taint</Row>
            <Row k="Coverage">{c.coverage}</Row>
            <Row k="Cross-chain">{c.crossChain ? `Included${c.ethOnly ? ` · Ethereum-only ${c.ethOnly.recovered} / ${c.truthSize}` : ''}` : 'Not included in this replay'}</Row>
          </dl>
        </Panel>
        <Panel title={`Rounds of tracing (high-confidence view ≥${c.highViewPct}% taint)`}>
          <DataTable dense rows={c.hops} rowKey={(h) => String(h.hop)} cols={[
            { key: 'h', label: 'Hop', render: (h) => <span className="font-mono text-cream">{h.hop}{h.hop === full ? <span className="ml-2 text-honey">full recovery</span> : ''}</span> },
            { key: 'f', label: 'Candidates flagged', align: 'right', render: (h) => <span className="font-mono text-cream">{n(h.flagged)}</span> },
            { key: 'k', label: 'Known wallets', align: 'right', render: (h) => <span className={`font-mono ${h.found === c.truthSize ? 'text-honey' : 'text-cream'}`}>{h.found} / {c.truthSize}</span> },
          ]} />
          <p className="px-5 py-3 text-[12px] text-dim">
            {full
              ? `All known ${c.exchange} addresses were recovered by hop ${full}.${c.hops.length > full ? ` Hop ${full + 1} added candidates but no additional known wallets, so hop ${full} gives full recall without the extra expansion.` : ''}`
              : `This view keeps wallets at ≥${c.highViewPct}% taint; the recovered count above uses the ≥${c.discoveryFloorPct}% discovery floor. Deeper hops add candidates, and add known wallets only while the count is still rising.`}
          </p>
        </Panel>
      </div>

      <Panel className="px-5 py-4 mb-5">
        <div className="text-[12px] text-mute">How to read taint</div>
        <p className="mt-1 text-[13px] leading-relaxed text-dim">
          Taint is the share of the money an address received that traces back to the attacker seed. A wallet that
          received 100 ETH, 20 of which follow the path back to the seed, is about 20% tainted. Any address at
          ≥{c.discoveryFloorPct}% becomes a candidate (a deliberately wide net); the ≥{c.highViewPct}% view keeps
          only wallets that are almost entirely attacker money. Each hop is one more round of following the money
          outward from the seed.
        </p>
      </Panel>

      {c.timeline && (
        <Panel title="Timeline (UTC)" className="mb-5">
          <div className="px-5 pb-5">
            <VTimeline items={c.timeline.map((e) => ({ t: e.utc.slice(11, 19), title: e.event, level: /flags|blocked|shut/.test(e.event) ? 'warning' : 'active' }))} />
          </div>
        </Panel>
      )}

      <Panel title={c.truth.some((x) => x.label) ? 'Labelled wallets' : 'Ground-truth wallets'}>
        <div className="max-h-[420px] overflow-y-auto">
          <DataTable dense rows={c.truth} rowKey={(r) => r.address + (r.label ?? '')} cols={[
            ...(c.truth.some((x) => x.label) ? [{ key: 'l', label: 'Label', render: (r: Truth) => <span className="text-cream">{r.label}</span> }] : []),
            { key: 'a', label: 'Address', render: (r) => <span className="font-mono text-[12px] text-dim">{r.address}</span> },
            ...(c.ethOnly ? [{ key: 'e', label: 'Ethereum only', render: (r: Truth) => <Found ok={!!r.ethereumOnly} /> }] : []),
            { key: 'r', label: c.crossChain ? 'Cross-chain' : 'Recovered', render: (r) => <Found ok={r.recovered} /> },
            { key: 'h', label: 'Hop', align: 'right', render: (r) => <span className="font-mono text-cream">{r.hop ?? '-'}</span> },
            { key: 't', label: 'Taint %', align: 'right', render: (r) => <span className="font-mono text-cream">{r.taintPct ?? '-'}</span> },
          ]} />
        </div>
      </Panel>
    </>
  )
}

function Found({ ok }: { ok: boolean }) {
  return <span className={ok ? 'text-honey' : 'text-mute'}>{ok ? 'recovered' : 'missed'}</span>
}

function Flow({ steps }: { steps: string[] }) {
  return (
    <ol className="mt-3 flex flex-wrap items-center gap-2">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className={`h-8 px-3 grid place-items-center rounded-md border text-[12.5px] ${i === 0 ? 'border-white/10 text-dim' : 'border-honey/30 bg-honey/[0.06] text-cream'}`}>{s}</span>
          {i < steps.length - 1 && <span className="text-honey">→</span>}
        </li>
      ))}
    </ol>
  )
}

/* ---------------------------------------------------------------- Network: where the money went */

function NetworkTab({ c }: { c: ReplayCase }) {
  const bp = Object.entries(c.breakpoints.totals).sort((a, b) => b[1] - a[1])
  const linked = c.candidates - c.recovered
  return (
    <>
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Confirmed" value={c.recovered} sub="known attacker wallets recovered" status="active" />
        <Metric label="High-confidence" value={n(c.attackerLike.count)} sub={`≥${c.highViewPct}% taint, few clean senders`} status="warning" />
        <Metric label="Linked" value={n(linked)} sub={`candidates ≥${c.discoveryFloorPct}% taint, not on the list`} />
        <Metric label="Chains" value={c.network ? c.network.chains.filter((x) => !x.skipped).length + 1 : 1} sub={c.crossChain ? `${c.coverage}` : 'Ethereum only in this replay'} />
      </div>

      {c.network ? (
        <Panel title="Cross-chain path" className="mb-5">
          <div className="px-5 pb-5">
            <p className="text-[12.5px] text-dim mb-4">
              The attacker moved funds on several chains, then bridged them into Ethereum. {c.network.links} bridge
              transfers matched, {usd(c.network.bridgedUsd)} in total.
            </p>
            <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-3">
              <div className="space-y-2">
                {c.network.chains.map((ch) => (
                  <div key={ch.chain} className={`rounded-md border px-3 py-2 ${ch.skipped ? 'border-white/[0.05] opacity-50' : 'border-white/10'}`}>
                    <div className="flex justify-between text-[13px] text-cream"><span>{cap(ch.chain)}</span><span className="font-mono">{ch.skipped ? 'skipped' : usd(ch.usd)}</span></div>
                    <div className="text-[11px] text-mute">{ch.skipped ? 'no historical state on the node' : `${ch.reached} addresses reached`}</div>
                  </div>
                ))}
              </div>
              <span className="text-honey text-[18px]">→</span>
              <div className="space-y-2">
                {['across', 'stargate'].map((b) => {
                  const count = c.network!.chains.reduce((s, ch) => s + (ch.bridges[b] ?? 0), 0)
                  return (
                    <div key={b} className="rounded-md border border-honey/30 bg-honey/[0.05] px-3 py-3 text-center">
                      <div className="text-[14px] font-semibold text-cream">{cap(b)}</div>
                      <div className="text-[11px] text-mute">{count} transfers</div>
                    </div>
                  )
                })}
              </div>
              <span className="text-honey text-[18px]">→</span>
              <div className="rounded-md border border-white/10 px-3 py-6 text-center">
                <div className="text-[14px] font-semibold text-cream">Ethereum</div>
                <div className="text-[11px] text-mute">{c.recovered} of {c.truthSize} labelled wallets recovered</div>
              </div>
            </div>
          </div>
        </Panel>
      ) : (
        <Panel className="px-5 py-4 mb-5">
          <p className="text-[13px] text-dim">This replay covers Ethereum only; cross-chain movement is not included.</p>
        </Panel>
      )}

      <PaidInvestigationCard caseId={c.id} />

      <Panel title={`Where the traced money stopped (${c.breakpoints.unit})`} className="mb-5">
        <DataTable dense rows={bp} rowKey={([k]) => k} cols={[
          { key: 'k', label: 'Endpoint', render: ([k]) => <span className="text-cream">{cap(k)}</span> },
          { key: 'a', label: 'Addresses', align: 'right', render: ([k]) => <span className="font-mono text-cream">{c.breakpoints.addresses[k] ?? 0}</span> },
          { key: 'v', label: `Traced ${c.breakpoints.unit}`, align: 'right', render: ([, v]) => <span className="font-mono text-cream">{n(Math.round(v))}</span> },
        ]} />
        <p className="px-5 py-3 text-[12px] text-dim">Tracing stops at exchanges, DEX pools and bridge routers: they are where the money leaves the attacker's own wallets, not suspects.</p>
      </Panel>

      <Panel className="px-5 py-4">
        <div className="text-[12px] text-mute">Should other Qu3ee members raise their guard?</div>
        <p className="mt-1 text-[13px] leading-relaxed text-dim">
          In a live incident the confirmed addresses go on the shared ThreatRegistry, and every member's Cosign holds
          withdrawals to them (gate 4). For this replay that would be {c.recovered} confirmed wallets, with{' '}
          {n(c.attackerLike.count)} high-confidence addresses for an analyst to review. Linked addresses are never
          published automatically.
        </p>
      </Panel>
    </>
  )
}

/* ---------------------------------------------------------------- Controls: what would / did change */

type Snap = { block: number; alert: number; hotFrozenUntil: number; warmFrozenUntil: number; vaults: Record<string, Record<string, Record<string, string>>> }
type Angle = { key: string; title: string; status: string; summary: string; source: string; tx?: string; block?: number }
type Ev = { block: number; tx: string; event: string; org: string | null; args: Record<string, unknown> }

function ControlsTab({ c }: { c: ReplayCase }) {
  return (
    <>
      <Panel title="If Qu3ee had been running (replay)" className="mb-5">
        <div className="px-5 pb-5"><Counterfactual c={c} /></div>
      </Panel>
      <EnforcementReceipt />
      <SolanaGuardCard />
    </>
  )
}

function Counterfactual({ c }: { c: ReplayCase }) {
  const k = c.controls
  if (!k) return <p className="text-[13px] text-dim">No control rule was replayed for this case. The tracing above is the replayed part.</p>
  if (k.kind === 'spike') {
    return (
      <>
        <p className="text-[13px] text-dim mb-3">{k.note}.</p>
        <DataTable dense rows={k.rule} rowKey={(r) => r.kind} cols={[
          { key: 'k', label: 'Asset', render: (r) => <span className="text-cream">{r.kind === 'stable' ? 'Stablecoins' : 'ETH'}</span> },
          { key: 'a', label: 'First alarm (UTC)', render: (r) => <span className="font-mono text-honey">{r.first_alarm.slice(6)}</span> },
          { key: 'm', label: 'After first large outflow', align: 'right', render: (r) => <span className="font-mono text-cream">{r.minutes_after_large_outflow} min</span> },
          { key: 'b', label: `Before Bitget noticed (${k.events.bitget_detected.slice(6)})`, render: (r) => <span className={r.before_bitget_detected ? 'text-honey' : 'text-mute'}>{r.before_bitget_detected ? 'yes' : 'no'}</span> },
          { key: 'f', label: 'False alarms / day', align: 'right', render: (r) => <span className="font-mono text-cream">{r.false_alarms_per_day}</span> },
        ]} />
        <p className="mt-3 text-[12px] text-dim">An alarm halves the hot vault's refill, the softest tightening; the decoy trap is what tightens hard.</p>
      </>
    )
  }
  return (
    <>
      <p className="text-[13px] text-dim mb-3">{k.note}.</p>
      <div className="grid grid-cols-3 gap-4">
        <Metric label="Known wallets proposed" value={`${k.proposed} / ${k.of}`} sub={`watch budget ${k.watchBudget} addresses`} status="active" />
        <Metric label="Still unmoved if flagged in 60 s" value={`${k.stillUnmovedPct['60s']}%`} sub="of delay-tier wallets" />
        <Metric label="Still unmoved if flagged in 10 min" value={`${k.stillUnmovedPct['600s']}%`} sub="of delay-tier wallets" />
      </div>
    </>
  )
}

const RECEIPT: { label: string; events: string[] }[] = [
  { label: 'Trigger detected (trap report)', events: ['Tightened'] },
  { label: 'CRE report verified by the forwarder', events: ['ReportProcessed'] },
  { label: 'Alert raised', events: ['AlertSet'] },
  { label: 'Hot quota → 0', events: ['QuotaZeroed'] },
  { label: 'Warm frozen', events: ['FreezeSet'] },
  { label: 'Sweep → Cold', events: ['Swept'] },
  { label: 'Cold wait raised', events: ['DelayRaised'] },
  { label: 'Registry publication', events: ['ThreatAdded'] },
]
const ALERT = ['Normal', 'L1', 'L2', 'L3', 'CONFIRMED']
const H = (import.meta.env.VITE_HISTORY_URL as string) ?? (typeof location !== 'undefined' ? `${location.origin}/history` : 'http://127.0.0.1:42069/history')
const j = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))

/** The last real attack on the fork: what each control did, and the vault state before and after (indexer). */
function EnforcementReceipt() {
  const [d, setD] = useState<{ from: number; angles: Angle[]; evs: Ev[]; before?: Snap; after?: Snap } | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let live = true
    ;(async () => {
      const a = await j(`${H}/angles?org=A`)
      const from = a.fromBlock as number
      const [evs, before, after] = await Promise.all([
        j(`${H}/events?fromBlock=${from}&org=A&limit=5000`) as Promise<Ev[]>,
        j(`${H}/series/snapshots?org=A&fromBlock=${Math.max(0, from - 1)}&limit=1`) as Promise<Snap[]>,
        j(`${H}/series/snapshots?org=A&last=1`) as Promise<Snap[]>,
      ])
      if (live) setD({ from, angles: a.angles, evs: evs.filter((e) => e.org === 'A' || e.event === 'ThreatAdded'), before: before[0], after: after[0] })
    })().catch(() => live && setErr(true))
    return () => {
      live = false
    }
  }, [])

  if (err) return <Panel className="px-5 py-4"><p className="text-[13px] text-mute">Enforcement receipt needs the indexer (/history). Start it with serve.ts.</p></Panel>
  if (!d) return <Panel className="px-5 py-4"><p className="text-[13px] text-mute">Loading the last fork attack…</p></Panel>
  // every step of the receipt comes from the trap report's own transaction (Patrol reports land in between)
  const trapTx = d.evs.find((e) => e.event === 'ThreatAdded' || e.event === 'AlertSet')?.tx
  const hit = (evs: string[]) => d.evs.find((e) => e.tx === trapTx && evs.includes(e.event))
  const q = (s?: Snap, tier = 'hot', f = 'quota') => (s ? Number(BigInt(s.vaults[tier]?.qUSD?.[f] ?? '0') / 1_000_000n) : 0)
  const cmp: [string, string, string][] = [
    ['Alert', ALERT[d.before?.alert ?? 0] ?? '-', ALERT[d.after?.alert ?? 0] ?? '-'],
    ['Hot quota (qUSD)', n(q(d.before)), n(q(d.after))],
    ['Hot balance (qUSD)', n(q(d.before, 'hot', 'balance')), n(q(d.after, 'hot', 'balance'))],
    ['Warm frozen', d.before?.warmFrozenUntil ? 'yes' : 'no', d.after?.warmFrozenUntil ? 'yes' : 'no'],
  ]
  return (
    <div className="grid grid-cols-[1.2fr_1fr] gap-4">
      <Panel title="Enforcement receipt · last attack on the fork">
        <ol className="px-5 pb-4">
          {RECEIPT.map((r) => {
            const e = hit(r.events)
            return (
              <li key={r.label} className="flex items-center gap-3 py-2 border-b border-white/[0.04] last:border-0 text-[13px]">
                <span className={e ? 'text-honey' : 'text-mute'}>{e ? '✓' : '·'}</span>
                <span className={e ? 'text-cream' : 'text-mute'}>{r.label}</span>
                <span className="ml-auto font-mono text-[11px] text-mute">{e ? `blk ${n(e.block)} · ${e.tx.slice(0, 8)}…` : 'not applied in this attack'}</span>
              </li>
            )
          })}
        </ol>
        <p className="px-5 pb-4 text-[11px] text-mute">Source: testnet fork, measured (indexer, from block {n(d.from)}).</p>
      </Panel>
      <div className="space-y-4">
        <Panel title="Before and after (org A)">
          {cmp.every(([, b, a]) => b === a) && (
            <p className="px-5 pb-2 text-[12px] text-dim">No change: org A was still tightened from an earlier attack when this one started.</p>
          )}
          <DataTable dense rows={cmp} rowKey={([k]) => k} cols={[
            { key: 'k', label: '', render: ([k]) => <span className="text-dim">{k}</span> },
            { key: 'b', label: 'Before', align: 'right', render: ([, b]) => <span className="font-mono text-cream">{b}</span> },
            { key: 'a', label: 'Now', align: 'right', render: ([, , a]) => <span className="font-mono text-honey">{a}</span> },
          ]} />
        </Panel>
        <Panel className="px-5 py-4">
          <div className="text-[12px] text-mute">Can money leave now, and who can restore it?</div>
          <p className="mt-1 text-[13px] leading-relaxed text-dim">
            {q(d.after) === 0 ? 'No fast withdrawals: the hot quota is 0.' : `Hot withdrawals up to ${n(q(d.after))} qUSD.`}{' '}
            {d.after?.warmFrozenUntil ? 'The warm vault is frozen. ' : ''}
            Tightening used the latest block; loosening only uses finalized data. Patrol refills the quota after the
            alert expires, and anything sooner needs two officers through the ConfigTimelock. The exchange backend
            cannot lift any of it.
          </p>
        </Panel>
        <Panel title="Independent angles">
          <ul className="px-5 pb-4">
            {d.angles.map((a) => (
              <li key={a.key} className="flex items-start gap-2 py-1.5 text-[12.5px]">
                <span className={a.status === 'flag' ? 'text-honey' : a.status === 'clear' ? 'text-dim' : 'text-mute'}>{a.status === 'flag' ? '●' : a.status === 'clear' ? '✓' : '○'}</span>
                <span><span className="text-cream">{a.title}</span> <span className="text-dim">· {a.summary}</span></span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  )
}

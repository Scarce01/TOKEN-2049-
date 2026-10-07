import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Label, Metric, PageHeader, Panel, Row } from '../components/ui'
import {
  EDGES,
  HEADLINE,
  HOP_COUNT,
  HOT_WALLETS,
  NODES,
  SEED,
  TAU_CANDIDATE_PPM,
  TAU_FOLLOW_PPM,
  type TraceNode,
} from '../live/trace-data'

type Phase = 'idle' | 'backend' | 'rank' | 'tripped' | 'trace' | 'done'

const eth = (n: number) => `${n.toLocaleString()} ETH`
const pct = (ppm: number) => `${(ppm / 10000).toFixed(0)}%`

// taint tier -> colour, matching the honey/amber palette
function tone(n: TraceNode): string {
  if (n.type === 'seed') return '#FF5C3C'
  if (n.stop) return '#6b7a8d'
  if (n.taintPpm >= TAU_FOLLOW_PPM) return '#FFC700'
  if (n.taintPpm >= TAU_CANDIDATE_PPM) return '#FCAD17'
  return '#5a5347'
}
const STOP_WORD: Record<string, string> = {
  exchange: 'EXCHANGE · stop',
  bridge: 'BRIDGE · stop',
  service: 'SERVICE · stop',
  burn: 'BURN · stop',
}

export default function AttackTrace() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [ranked, setRanked] = useState(false)
  const [traceHop, setTraceHop] = useState(0) // 0..3 how many hops revealed
  const timer = useRef<number | null>(null)

  const ranks = [...HOT_WALLETS].sort((a, b) => b.balanceEth - a.balanceEth)
  const target = ranks[0] // highest balance = what the attacker's own ranker picks
  const revealDecoy = phase === 'tripped' || phase === 'trace' || phase === 'done'

  function stopTimer() {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = null
  }
  useEffect(() => () => stopTimer(), [])

  function reset() {
    stopTimer()
    setPhase('idle')
    setRanked(false)
    setTraceHop(0)
  }

  function startTrace() {
    setPhase('trace')
    setTraceHop(0)
    stopTimer()
    let h = 0
    timer.current = window.setInterval(() => {
      h += 1
      setTraceHop(h)
      if (h >= 3) {
        stopTimer()
        setTimeout(() => setPhase('done'), 900)
      }
    }, 1400)
  }

  const visNodes = NODES.filter((n) => n.hop <= (phase === 'done' ? 3 : traceHop))
  const visEdges = EDGES.filter((e) => e.hop <= (phase === 'done' ? 3 : traceHop))
  const ranking = [...NODES].filter((n) => n.hop > 0).sort((a, b) => b.taintedEth - a.taintedEth)

  return (
    <div className="max-w-[1480px]">
      <PageHeader
        eyebrow="Red team · attacker's view and fund tracing"
        title={
          <>
            Attack the exchange, trip a decoy, <span className="text-honey">trace the money to source</span>.
          </>
        }
        desc="The attacker only sees what a compromised backend exposes. A decoy is indistinguishable, so the attacker's own ranking touches it. Once it trips, Quorum tightens and traces the stolen funds by the real backtest logic."
        actions={
          <>
            <Button variant="ghost" onClick={reset}>
              Reset
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-[320px_1fr] gap-5">
        {/* attacker controls */}
        <Panel title="Attacker console">
          <div className="p-4 space-y-3">
            <div className="text-[12px] text-dim">
              You have the exchange backend's admin token. Run the attack step by step.
            </div>
            <Button
              className="w-full justify-center"
              variant={phase === 'idle' ? 'primary' : 'secondary'}
              onClick={() => setPhase('backend')}
            >
              1 · Compromise backend
            </Button>
            <Button
              className="w-full justify-center"
              variant={phase === 'backend' ? 'primary' : 'secondary'}
              onClick={() => {
                setRanked(true)
                setPhase('rank')
              }}
            >
              2 · Rank hot wallets by balance
            </Button>
            <Button
              className="w-full justify-center"
              variant={phase === 'rank' ? 'primary' : 'secondary'}
              onClick={() => setPhase('tripped')}
            >
              3 · Forge withdrawal from #1
            </Button>
            <div className="pt-2 border-t border-white/[0.06]">
              <Label>Defender</Label>
              <Button
                className="mt-2 w-full justify-center"
                variant={phase === 'tripped' ? 'primary' : 'secondary'}
                onClick={startTrace}
              >
                4 · Trace stolen funds
              </Button>
            </div>

            <dl className="pt-2">
              <Row k="Target picked" mono>
                {phase === 'idle' || phase === 'backend' ? '—' : `${target.label} · ${eth(target.balanceEth)}`}
              </Row>
              <Row k="What it really was">
                {revealDecoy ? <span className="text-flare">decoy wallet</span> : phase === 'rank' ? 'unknown to attacker' : '—'}
              </Row>
              <Row k="Trace follows">{'taint ≥ 50% · ≤ 4 hops · rank by $'}</Row>
            </dl>
          </div>
        </Panel>

        {/* stage */}
        <Panel className="bg-coal-2" title={stageTitle(phase)}>
          {phase === 'idle' ? (
            <div className="p-10 text-center text-dim">Start from the attacker console on the left.</div>
          ) : phase === 'backend' || phase === 'rank' || phase === 'tripped' ? (
            <BackendView ranks={ranks} ranked={ranked} target={target} phase={phase} revealDecoy={revealDecoy} />
          ) : (
            <TraceView visNodes={visNodes} visEdges={visEdges} hop={phase === 'done' ? 3 : traceHop} done={phase === 'done'} ranking={ranking} />
          )}
        </Panel>
      </div>

      {phase === 'tripped' && (
        <div className="mt-4">
          <Badge status="threat">Decoy tripped</Badge>{' '}
          <span className="text-[13px] text-cream">
            The forged withdrawal touched a decoy. CRE verified it, QuorumReceiver tightened the vaults, and the
            attacker address went on the shared threat list. Now trace where the money would go.
          </span>
        </div>
      )}

      {phase === 'done' && (
        <div className="grid grid-cols-4 gap-4 mt-4">
          <Metric label="FBI-listed found" value={HEADLINE.found} sub="within 3 hops" status="active" />
          <Metric label="First touched" value="16 min" sub={HEADLINE.fbiList} status="active" />
          <Metric label="Ranking" value="top 102" sub={HEADLINE.precision} status="idle" />
          <Metric label="Cross-chain limit" value="8 / 14" sub="Bitget: bridges handed off" status="warning" />
        </div>
      )}
    </div>
  )
}

function stageTitle(p: Phase): string {
  if (p === 'backend') return "Attacker's view · GET /admin/hot-wallets"
  if (p === 'rank') return "Attacker's view · ranked by balance"
  if (p === 'tripped') return 'Attacker struck a decoy'
  if (p === 'trace' || p === 'done') return 'Fund tracing · proportional taint, hop by hop'
  return 'Stage'
}

function BackendView({
  ranks,
  ranked,
  target,
  phase,
  revealDecoy,
}: {
  ranks: typeof HOT_WALLETS
  ranked: boolean
  target: (typeof HOT_WALLETS)[number]
  phase: Phase
  revealDecoy: boolean
}) {
  const rows = ranked ? ranks : HOT_WALLETS
  return (
    <div className="p-4">
      <div className="text-[12px] text-dim mb-3">
        Fields the backend exposes: label, chain, address, kind, status, balance. There is no "is-decoy" flag, so
        the highest-balance wallet the attacker ranks is bait.
      </div>
      <table className="w-full text-[13px]">
        <thead className="text-dim text-[11px] uppercase tracking-wide">
          <tr className="border-b border-white/[0.06]">
            <th className="text-left py-1.5">{ranked ? '#' : ''} label</th>
            <th className="text-left">address</th>
            <th className="text-left">kind</th>
            <th className="text-right">balance</th>
            <th className="text-left pl-3">reveal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w, i) => {
            const isTarget = w.address === target.address
            return (
              <tr
                key={w.address}
                className={`border-b border-white/[0.04] ${isTarget && phase !== 'backend' ? 'bg-honey/10' : ''}`}
              >
                <td className="py-1.5">
                  {ranked ? <span className="font-mono text-dim mr-2">{i + 1}</span> : null}
                  {w.label}
                </td>
                <td className="font-mono text-dim">{w.address}</td>
                <td className="text-dim">{w.kind}</td>
                <td className="text-right tabular-nums">{w.balanceEth.toLocaleString()} ETH</td>
                <td className="pl-3">
                  {revealDecoy && w.decoy ? (
                    <span className="text-flare font-semibold">DECOY</span>
                  ) : isTarget && phase === 'rank' ? (
                    <span className="text-honey">← attacker picks #1</span>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TraceView({
  visNodes,
  visEdges,
  hop,
  done,
  ranking,
}: {
  visNodes: TraceNode[]
  visEdges: typeof EDGES
  hop: number
  done: boolean
  ranking: TraceNode[]
}) {
  const pos = (id: string) => {
    const n = NODES.find((x) => x.id === id)!
    return { x: n.x, y: n.y }
  }
  return (
    <div className="grid grid-cols-[1fr_260px]">
      <div className="p-2">
        <svg viewBox="0 0 860 470" className="w-full h-[440px]">
          {/* hop guide labels */}
          {[1, 2, 3].map((h) => (
            <text key={h} x={90 + h * 215} y={30} textAnchor="middle" fontSize="10" className="font-mono" fill={h <= hop ? '#FCAD17' : '#3a3730'}>
              HOP {h} · {HOP_COUNT[h]} found
            </text>
          ))}
          {/* edges */}
          {visEdges.map((e) => {
            const a = pos(e.from)
            const b = pos(e.to)
            const to = NODES.find((n) => n.id === e.to)!
            return (
              <g key={`${e.from}-${e.to}`}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={to.stop ? '#6b7a8d' : '#FCAD17'} strokeOpacity={0.5} strokeWidth={Math.max(1, Math.log10(e.eth) - 2)} strokeDasharray={to.stop ? '4 3' : undefined}>
                  <animate attributeName="stroke-opacity" from="0" to="0.5" dur="0.7s" fill="freeze" />
                </line>
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle" fontSize="8" fill="#6b6457" className="font-mono">
                  {Math.round(e.eth / 1000)}k
                </text>
              </g>
            )
          })}
          {/* nodes */}
          {visNodes.map((n) => (
            <g key={n.id}>
              {n.fbi && (
                <circle cx={n.x} cy={n.y} r={16} fill="none" stroke="#FFC700" strokeOpacity="0.5" strokeDasharray="2 2" />
              )}
              <circle cx={n.x} cy={n.y} r={n.type === 'seed' ? 13 : 10} fill={tone(n)}>
                {!done && <animate attributeName="r" from="2" to={n.type === 'seed' ? '13' : '10'} dur="0.5s" fill="freeze" />}
              </circle>
              <text x={n.x} y={n.y - 18} textAnchor="middle" fontSize="9" fill="#d8cfb8" className="font-medium">
                {n.label}
              </text>
              <text x={n.x} y={n.y + 22} textAnchor="middle" fontSize="8" fill={n.stop ? '#6b7a8d' : '#8a8270'} className="font-mono">
                {n.stop ? STOP_WORD[n.type] : `${pct(n.taintPpm)} · ${Math.round(n.taintedEth / 1000)}k`}
              </text>
            </g>
          ))}
          {/* seed caption */}
          <text x={90} y={275} textAnchor="middle" fontSize="8" fill="#FF8a6c" className="font-mono">
            seed {SEED.slice(0, 8)}…
          </text>
        </svg>
      </div>

      {/* ranked-by-tainted-amount list (the officer's triage order) */}
      <div className="border-l border-white/[0.06] p-3">
        <Label>Ranked by tainted amount</Label>
        <div className="mt-2 space-y-1">
          {ranking.map((n, i) => {
            const shown = n.hop <= hop || done
            return (
              <div key={n.id} className={`flex items-center justify-between text-[12px] ${shown ? '' : 'opacity-30'}`}>
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-dim w-4">{i + 1}</span>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone(n) }} />
                  <span className="text-cream">{n.label}</span>
                  {n.fbi && <span className="text-[9px] text-honey">FBI</span>}
                  {n.stop && <span className="text-[9px]" style={{color:'#6b7a8d'}}>stop</span>}
                </span>
                <span className="tabular-nums text-dim">{Math.round(n.taintedEth / 1000)}k</span>
              </div>
            )
          })}
        </div>
        {done && (
          <div className="mt-4 p-2 rounded border border-honey/20 text-[11px] text-cream">
            <span className="font-mono text-honey">{HEADLINE.found}</span> FBI-listed within 3 hops. {HEADLINE.note}
          </div>
        )}
      </div>
    </div>
  )
}

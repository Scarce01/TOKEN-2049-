'use client'
// Observatory: 3D replay of one incident (decoy hit, vault restricted, threat shared). Port of hexmap.html.
// Data seam: `replay` and `decoyKeys` are demo constants today. To go live, build a Replay from
// /api/timeline points (ThreatAdded, Tightened) and fetch decoy positions from an officer-only route (rule 2).
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { HexTerrain, type TerrainHandle } from '@/components/HexTerrain'
import { RecordingCtx } from '@/lib/client'
import {
  buildCells,
  type Cell,
  clamp,
  DEMO_DECOY_KEYS,
  demoReplay,
  EXCHANGES,
  hotVault,
  labelOf,
  stateAt,
} from '@/lib/observatory'

const decoyKeys = DEMO_DECOY_KEYS
const replay = demoReplay

export default function Observatory() {
  const masked = useContext(RecordingCtx).on
  const cells = useMemo(() => buildCells(decoyKeys), [])
  const ctx = useMemo(() => {
    const threat = cells.find((c) => c.key === replay.threatKey)!
    return { threat, vault: hotVault(cells, replay.frozenExchange), target: hotVault(cells, replay.sharedExchange) }
  }, [cells])
  const terrain = useRef<TerrainHandle>(null)
  const [time, setTime] = useState(3.2)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [selected, setSelected] = useState<Cell>(ctx.threat)
  const [topView, setTopView] = useState(false)
  const [zoom, setZoom] = useState(1)
  const s = stateAt(replay, time)

  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      const dt = Math.min((now - last) / 1000, 0.1) * speed
      last = now
      setTime((t) => {
        const n = Math.min(replay.duration, t + dt)
        if (n >= replay.duration) setPlaying(false)
        return n
      })
      raf = requestAnimationFrame(tick)
    })
    const hide = () => document.hidden && setPlaying(false)
    document.addEventListener('visibilitychange', hide)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', hide)
    }
  }, [playing, speed])

  const choose = (c: Cell, focus = false) => {
    setSelected(c)
    if (focus) terrain.current?.focus(c)
  }
  const togglePlay = () => {
    if (!playing && time >= replay.duration) setTime(0)
    setPlaying(!playing)
  }
  const label = (c: Cell) => labelOf(c, decoyKeys, masked)
  const objects = useMemo(
    () => (['decoy', 'vault', 'account'] as const).flatMap((k) => cells.filter((c) => c.kind === k)),
    [cells],
  )

  // inspector
  const c = selected
  const isThreat = c === ctx.threat
  const frozen = c.kind === 'vault' && c.tier === 'Hot' && c.exchange === replay.frozenExchange && s.frozen
  const status = !c.served
    ? 'NOT CONNECTED'
    : c.kind === 'terrain'
      ? 'TERRAIN'
      : isThreat && s.hit
        ? s.shared
          ? 'CONTAINED'
          : 'RESPONDING'
        : frozen
          ? 'RESTRICTED'
          : 'MONITORED'
  const statusCls =
    status === 'RESPONDING'
      ? 'text-[#edc185] bg-[#34291d] border-[#6a5232]'
      : status === 'RESTRICTED'
        ? 'text-[#efaaa0] bg-[#342321] border-[#6b4841]'
        : 'text-[#b4c7ba] bg-[#242d28] border-[#525e55]'
  const notice = s.shared
    ? 'Threat shared across the network. Withdrawal capacity remains restricted.'
    : s.frozen
      ? `Vault ${replay.frozenExchange} is restricted. Sharing the threat with Exchange ${replay.sharedExchange}.`
      : s.hit
        ? 'Decoy touched. A coordinated response is in progress.'
        : 'Monitoring. Replay an incident to see the response propagate.'
  const steps = [
    [
      s.hit,
      masked ? 'Flagged interaction detected' : 'Decoy interaction detected',
      `+${replay.hitAt.toFixed(1)}s · trap signal`,
    ],
    [
      s.frozen,
      `Vault ${replay.frozenExchange} limit set to zero`,
      `+${replay.freezeAt.toFixed(1)}s · receiver confirmed`,
    ],
    [s.shared, `Exchange ${replay.sharedExchange} notified`, `+${replay.shareAt.toFixed(1)}s · shared threat registry`],
  ] as const
  const btn = 'rounded border border-[#2b2f33] px-3 py-2 hover:bg-[#303438] disabled:opacity-40'

  return (
    <div className="-m-4 grid h-[calc(100dvh-41px)] min-h-0 grid-cols-[minmax(0,1fr)_306px] bg-[#101214] text-[13px] text-[#eceeed] max-[780px]:flex max-[780px]:h-auto max-[780px]:flex-col">
      <div className="flex min-h-0 min-w-0 flex-col">
        <section className="shrink-0 border-b border-[#2b2f33] bg-[#171b1e] px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-[19px] font-normal tracking-tight">Network observatory</h1>
            <div className="flex items-center gap-3">
              <span className="rounded border border-[#45403a] bg-[#26231f] px-2 py-1.5 text-[10px] tracking-wider text-[#d2c0a3]">
                DEMO · ASSUMED DATA
              </span>
              <button
                type="button"
                className={`${btn} border-[#79613a] bg-[#2e281e] text-[11px] text-[#f1c781]`}
                onClick={() => {
                  choose(ctx.threat)
                  setTime(0)
                  setPlaying(true)
                }}
              >
                ↗ Simulate attack
              </button>
            </div>
          </div>
          <div className="mt-3 flex gap-6 text-[10px] text-[#939a9f]">
            <span>
              <strong className="mr-2 text-[17px] font-normal text-[#eceeed]">{cells.length}</strong>Terrain cells
            </span>
            <span>
              <strong className="mr-2 text-[17px] font-normal text-[#efb85c]">
                {masked ? '••' : String(decoyKeys.length).padStart(2, '0')}
              </strong>
              {masked ? 'Protected objects' : 'Armed decoys'}
            </span>
            <span>
              <strong className="mr-2 text-[17px] font-normal text-[#eceeed]">{s.hit ? '01' : '00'}</strong>Active
              incidents · {s.shared ? 'contained' : s.hit ? 'responding' : 'monitoring'}
            </span>
          </div>
        </section>

        <section
          className="relative min-h-[340px] flex-1 overflow-hidden bg-[#14181b]"
          aria-label="Interactive network terrain"
        >
          <HexTerrain
            ref={terrain}
            cells={cells}
            replay={replay}
            ctx={ctx}
            time={time}
            selected={selected}
            masked={masked}
            topView={topView}
            onSelect={(x) => choose(x)}
            onZoom={setZoom}
          />
          <div className="absolute left-5 top-4 z-[2] flex items-center gap-3">
            <span className="text-[9px] font-semibold tracking-[1.7px] text-[#c0c6c6]">NETWORK TOPOLOGY</span>
            <select
              aria-label="Jump to exchange"
              className="rounded border border-[#2b2f33] bg-[#171e24] p-1.5 text-[10px]"
              value=""
              onChange={(e) => {
                const ex = EXCHANGES.find((x) => x.id === e.target.value)
                const cell = ex && cells.find((x) => x.q === ex.q && x.r === ex.r)
                if (cell) choose(cell, true)
              }}
            >
              <option value="">Explore exchanges</option>
              {EXCHANGES.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} / {e.served ? 'Connected' : 'Not connected'}
                </option>
              ))}
            </select>
          </div>
          <div className="pointer-events-none absolute inset-x-4 bottom-4 z-[2] flex flex-wrap items-end justify-between gap-2">
            <div className="flex gap-3 rounded border border-[#3a4148] bg-[#14191ee8] px-3 py-2.5 text-[10px] text-[#bac0c1]">
              <span>⬡ Terrain</span>
              <span>⬢ Vault</span>
              {masked ? null : <span className="text-[#efb85c]">⬢ Honeypot</span>}
              <span className="text-[#ed776b]">▼ Threat</span>
            </div>
            <div className="pointer-events-auto flex items-center gap-1 rounded-md border border-[#3a4148] bg-[#14191eee] p-1">
              {(
                [
                  [
                    'All regions',
                    () => {
                      terrain.current?.reset()
                      terrain.current?.zoomBy(0.48)
                    },
                  ],
                  ['←', () => terrain.current?.panBy(-60, 0)],
                  ['→', () => terrain.current?.panBy(60, 0)],
                  ['−', () => terrain.current?.zoomBy(1 / 1.2)],
                ] as const
              ).map(([t, f]) => (
                <button key={t} type="button" className="rounded px-2 py-1.5 hover:bg-[#303438]" onClick={f}>
                  {t}
                </button>
              ))}
              <span className="min-w-9 text-center font-mono text-[10px] text-[#a3abad]">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                className="rounded px-2 py-1.5 hover:bg-[#303438]"
                onClick={() => terrain.current?.zoomBy(1.2)}
              >
                +
              </button>
              <button
                type="button"
                className="rounded px-2 py-1.5 hover:bg-[#303438]"
                onClick={() => terrain.current?.reset()}
              >
                Reset
              </button>
              <button
                type="button"
                aria-pressed={topView}
                className={`rounded px-2 py-1.5 hover:bg-[#303438] ${topView ? 'text-[#efb85c]' : ''}`}
                onClick={() => setTopView(!topView)}
              >
                {topView ? 'Isometric' : 'Top view'}
              </button>
            </div>
          </div>
        </section>

        <section
          className="flex h-[70px] shrink-0 items-center gap-4 border-t border-[#2b2f33] bg-[#171c20] px-5"
          aria-label="Event replay"
        >
          <button
            type="button"
            className="h-[34px] w-[34px] shrink-0 rounded-full border border-[#2b2f33] text-[#efb85c]"
            aria-label={playing ? 'Pause event replay' : 'Play event replay'}
            onClick={togglePlay}
          >
            {playing ? 'Ⅱ' : '▶'}
          </button>
          <div className="whitespace-nowrap font-mono text-[10px]">
            00:{String(Math.floor(time)).padStart(2, '0')} / 00:{replay.duration}
            <small className="block text-[9px] tracking-wider text-[#939a9f]">EVENT REPLAY</small>
          </div>
          <div className="min-w-0 flex-1">
            <input
              type="range"
              min={0}
              max={replay.duration}
              step={0.01}
              value={time}
              aria-label="Replay time in seconds"
              className="w-full accent-[#efb85c]"
              onChange={(e) => {
                setPlaying(false)
                setTime(clamp(Number(e.target.value), 0, replay.duration))
              }}
            />
            <div className="flex justify-between text-[8px] text-[#848e93]">
              <span>00:0{replay.hitAt} · DECOY HIT</span>
              <span>00:0{replay.freezeAt} · VAULT FROZEN</span>
              <span>00:0{replay.shareAt} · NETWORK SYNCED</span>
            </div>
          </div>
          <select
            aria-label="Replay speed"
            className="rounded border border-[#2b2f33] bg-transparent p-1 text-[10px]"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
        </section>
      </div>

      <aside
        className="flex flex-col overflow-auto border-l border-[#2b2f33] bg-gradient-to-br from-[#1c2024] to-[#161a1e]"
        aria-label="Selected object inspector"
      >
        <div className="border-b border-[#2b2f33] p-5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold tracking-[2px] text-[#939a9f]">
              {isThreat && s.hit ? `INCIDENT ${replay.caseLabel}` : 'OBJECT INSPECTOR'}
            </span>
            <span className={`rounded border px-2 py-1 text-[9px] tracking-wide ${statusCls}`}>{status}</span>
          </div>
          <h2 className="mb-2 mt-4 text-[22px] font-normal tracking-tight">
            {isThreat && s.hit ? (masked ? 'Flagged interaction' : 'Decoy interaction') : label(c)}
          </h2>
          <div className="text-[11px] text-[#939a9f]">
            Exchange {c.exchange} / {label(c)}
          </div>
          <label htmlFor="objects" className="mt-4 block text-[9px] font-semibold tracking-[1.4px] text-[#939a9f]">
            INSPECT AN OBJECT
          </label>
          <select
            id="objects"
            className="mt-2 w-full rounded border border-[#2b2f33] bg-[#171c20] p-2 text-[10px]"
            value={c.key}
            onChange={(e) => choose(cells.find((x) => x.key === e.target.value)!, true)}
          >
            {objects.map((o) => (
              <option key={o.key} value={o.key}>
                {label(o)} · Exchange {o.exchange}
              </option>
            ))}
            {c.kind === 'terrain' ? <option value={c.key}>{label(c)}</option> : null}
          </select>
        </div>

        <section className="border-b border-[#2b2f33] p-5">
          <div className="mb-3 flex justify-between text-[9px]">
            <span className="font-semibold tracking-[1.4px] text-[#939a9f]">OBJECT DETAILS</span>
            <span className="font-mono text-[#a39a8b]">{replay.source} / demo</span>
          </div>
          <dl className="grid grid-cols-[90px_minmax(0,1fr)] gap-3 text-[11px] [&_dd]:text-right [&_dt]:text-[#939a9f]">
            <dt>Object</dt>
            <dd>{label(c)}</dd>
            <dt>Exchange</dt>
            <dd>
              {EXCHANGES.find((e) => e.id === c.exchange)!.name} / {c.exchange}
            </dd>
            <dt>Reference</dt>
            <dd className="font-mono">
              {masked && c.kind === 'decoy'
                ? '••••••••'
                : `DEMO-${c.kind.toUpperCase()}-${String(c.index).padStart(3, '0')}`}
            </dd>
            <dt>Available quota</dt>
            <dd className="font-mono">
              {!c.served
                ? 'No telemetry'
                : c.kind === 'terrain'
                  ? 'Not an account'
                  : `${(frozen ? 0 : c.quota).toFixed(2)} ETH`}
            </dd>
            <dt>Signal</dt>
            <dd className="text-[#efb85c]">
              {!c.served
                ? 'Not connected'
                : c.kind === 'terrain'
                  ? 'Decorative terrain'
                  : isThreat && s.hit
                    ? 'Unauthorized withdrawal'
                    : frozen
                      ? 'Quota restricted'
                      : 'No local alert'}
            </dd>
          </dl>
        </section>

        <section className="border-b border-[#2b2f33] p-5">
          <div className="mb-3 text-[9px] font-semibold tracking-[1.4px] text-[#939a9f]">
            INCIDENT {replay.caseLabel} · RESPONSE
          </div>
          <ol className="space-y-4">
            {steps.map(([done, title, sub]) => (
              <li key={title} className="flex gap-3">
                <span
                  className={`grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full border text-[10px] ${done ? 'border-[#a5b9ad] bg-[#a5b9ad] text-[#171e1b]' : 'border-[#41494c] text-[#687174]'}`}
                >
                  {done ? '✓' : '·'}
                </span>
                <div>
                  <strong className={`block text-[11px] font-normal ${done ? '' : 'text-[#737d82]'}`}>{title}</strong>
                  <small className="mt-1 block font-mono text-[9px] text-[#939a9f]">{sub}</small>
                </div>
              </li>
            ))}
          </ol>
          <div
            role="status"
            className="mt-4 border-l-2 border-[#a69163] pl-3 text-[10px] leading-relaxed text-[#b7bebc]"
          >
            {notice}
          </div>
        </section>

        <div className="mt-auto p-5">
          <button
            type="button"
            className={`${btn} flex w-full justify-between`}
            onClick={() => choose(ctx.threat, true)}
          >
            Locate incident <span>↗</span>
          </button>
          <p className="mt-3 text-[9px] leading-relaxed text-[#818c91]">
            All exchanges, balances and events are synthetic.
            <br />
            Terrain is decorative. Vault height identifies Hot / Warm / Cold; a restricted hot vault sinks.
          </p>
        </div>
      </aside>
    </div>
  )
}

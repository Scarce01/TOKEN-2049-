import { describe, expect, test } from 'bun:test'
import type { Address, Hex } from 'viem'
import { Kind } from '../../../packages/shared/src/index'
import {
  type Baseline,
  type CusumState,
  DEFAULT_CUSUM,
  discounted,
  log2milli,
  recompute,
  shouldWrite,
  step,
} from '../src/logic/cusum'
import {
  assetValue,
  backlog,
  checkpointActions,
  isClean,
  type OrgView,
  opsEoaCheck,
  type Params,
  reconcile,
  refillActions,
  topUpActions,
} from '../src/logic/patrol'

const ORG: Hex = '0xae4676874fd6398fe5f19869ae4c627651b922a81f7c8cd078dbbb12444b012d'
const HOT: Address = '0x1111111111111111111111111111111111111111'
const WARM: Address = '0x2222222222222222222222222222222222222222'
const QUSD: Address = '0x6666666666666666666666666666666666666666'
const T = 1_760_000_040n
const word = (m: bigint, v: bigint) => (m << 224n) | v

function org(over: Partial<OrgView> = {}): OrgView {
  return {
    orgId: ORG,
    alert: 0,
    deployedMinute: 0n,
    tokens: [QUSD],
    reqRing: Array(32).fill(0n),
    verdictRing: Array(32).fill(0n),
    hot: {
      vault: HOT,
      frozenUntil: 0n,
      configHash: `0x${'01'.repeat(32)}`,
      balances: [10_000n],
      quotas: [3_000n],
      caps: [5_000n],
      lastEpochs: [T / 60n - 3n],
      extOutTotals: [500n],
      fundedTotals: [10_500n],
    },
    warm: {
      vault: WARM,
      frozenUntil: 0n,
      configHash: `0x${'02'.repeat(32)}`,
      balances: [20_000n],
      quotas: [0n],
      caps: [0n],
      lastEpochs: [0n],
      extOutTotals: [0n],
      fundedTotals: [20_000n],
    },
    hotOutRings: [Array(32).fill(0n)],
    assets: [{ safeBlock: 100n, set: true, value: 0n }],
    hotCheckpoints: [{ minute: 0n, alarm: false, gap: false, S: 0n }],
    ...over,
  }
}

const P: Params = {
  chainId: 84532n,
  freezeDuration: 7200n,
  alertTtlConfirmed: 7200n,
  alertTtlL2: 7200n,
  coldDelayTight: 259200n,
  threatTtl: 259200n,
  backlogAge: 900n,
  backlogMax: 5n,
  backlogAlertTtl: 1800n,
}

describe('asset conservation (D26, D61, D65)', () => {
  test('V is unchanged by execute, sweep, topUp and fund', () => {
    const o = org()
    const v0 = assetValue(o, 0)
    // execute 100: hot balance -100, extOut +100
    expect(assetValue(org({ hot: { ...o.hot, balances: [9_900n], extOutTotals: [600n] } }), 0)).toBe(v0)
    // topUp 1000 warm -> hot: internal, no stats
    expect(
      assetValue(org({ hot: { ...o.hot, balances: [11_000n] }, warm: { ...o.warm, balances: [19_000n] } }), 0),
    ).toBe(v0)
    // fund 50 into hot: balance +50, funded +50
    expect(assetValue(org({ hot: { ...o.hot, balances: [10_050n], fundedTotals: [10_550n] } }), 0)).toBe(v0)
  })

  test('V unchanged or up: no action', () => {
    expect(reconcile(P, org(), org(), 120n, T, {})).toEqual([])
  })

  test('anchor sees V drop, SAFE does not: soft tightening only (QUOTA_ZERO + L2)', () => {
    const stolen = org({ hot: { ...org().hot, balances: [9_000n] } })
    const r = reconcile(P, stolen, org(), 120n, T, {})
    expect(r[0]!.actions.map((a) => a.kind)).toEqual([Kind.QUOTA_ZERO, Kind.ALERT])
  })

  test('SAFE sees it too: confirmed pack', () => {
    const stolen = org({ hot: { ...org().hot, balances: [9_000n] } })
    const r = reconcile(P, stolen, stolen, 120n, T, {})
    expect(r[0]!.actions.map((a) => a.kind)).toEqual([
      Kind.FREEZE,
      Kind.QUOTA_ZERO,
      Kind.SWEEP,
      Kind.ALERT,
      Kind.COLD_DELAY,
      Kind.THREAT,
    ])
  })

  test('first run after deploy: no checkpoint, no comparison', () => {
    const fresh = org({ assets: [{ safeBlock: 0n, set: false, value: 0n }], hot: { ...org().hot, balances: [1n] } })
    expect(reconcile(P, fresh, fresh, 120n, T, {})).toEqual([])
  })

  test('config drift freezes that vault (D37)', () => {
    const r = reconcile(P, org(), org(), 120n, T, { [HOT.toLowerCase()]: `0x${'99'.repeat(32)}` })
    expect(r[0]!.actions.map((a) => a.kind)).toEqual([Kind.FREEZE])
  })

  test('checkpoint written every run, but never below the high-water mark', () => {
    expect(checkpointActions(org(), 130n)).toHaveLength(1)
    expect(checkpointActions(org({ hot: { ...org().hot, balances: [1n] } }), 130n)).toEqual([])
    expect(checkpointActions(org(), 100n)).toEqual([])
  })

  test('ops EOA drop beyond gas budget -> L2', () => {
    expect(opsEoaCheck(10n ** 16n, 10n ** 16n - 10n ** 14n, 10n ** 15n, T, 7200n)).toEqual([])
    expect(opsEoaCheck(10n ** 16n, 10n ** 15n, 10n ** 15n, T, 7200n)[0]!.kind).toBe(Kind.ALERT)
  })
})

describe('quota refill (D10, D24, D25)', () => {
  test('refill r_max per missed epoch, capped by cap - quota', () => {
    const a = refillActions(org(), T, 60n, [1_000n], [false])
    expect(a).toHaveLength(1)
    expect(a[0]!.kind).toBe(Kind.QUOTA_REFILL)
  })

  test('CUSUM alarm halves the refill (soft action only)', () => {
    const o = org({ hot: { ...org().hot, quotas: [0n], caps: [100_000n] } })
    const full = refillActions(o, T, 60n, [1_000n], [false])
    const half = refillActions(o, T, 60n, [1_000n], [true])
    expect(full[0]!.data).not.toBe(half[0]!.data)
  })

  test('LATEST clean but FINALIZED not (and the reverse): no refill', () => {
    const clean = org()
    const dirty = org({ alert: 4 })
    const both = (a: OrgView, b: OrgView) => isClean(a, T, 0n, 5n) && isClean(b, T, 0n, 5n)
    expect(both(clean, dirty)).toBe(false)
    expect(both(dirty, clean)).toBe(false)
    expect(both(clean, clean)).toBe(true)
    expect(isClean(org({ warm: { ...org().warm, frozenUntil: T + 1n } }), T, 0n, 5n)).toBe(false)
  })

  test('topUp only when hot is below target', () => {
    expect(topUpActions(org(), [8_000n])).toEqual([])
    expect(topUpActions(org(), [12_000n])[0]!.kind).toBe(Kind.TOPUP)
  })
})

describe('backlog (D62)', () => {
  test('requests without verdicts older than BACKLOG_AGE count; recent ones and pre-deploy minutes do not', () => {
    const am = T / 60n
    const req = Array(32).fill(0n)
    const ver = Array(32).fill(0n)
    req[Number((am - 20n) % 32n)] = word(am - 20n, 8n)
    ver[Number((am - 20n) % 32n)] = word(am - 20n, 2n)
    req[Number((am - 2n) % 32n)] = word(am - 2n, 9n) // too recent
    expect(backlog(org({ reqRing: req, verdictRing: ver }), am, 15n)).toBe(6n)
    expect(backlog(org({ reqRing: req, verdictRing: ver, deployedMinute: am - 10n }), am, 15n)).toBe(0n)
    expect(isClean(org(), T, 6n, 5n)).toBe(false)
  })
})

describe('CUSUM (D55, D58)', () => {
  const baseline: Baseline[] = Array.from({ length: 168 }, (_, h) => ({ mu: h % 24 < 8 ? 3000n : 6000n, sigma: 1500n }))
  const p = DEFAULT_CUSUM(baseline)

  test('integer log2 is monotonic and exact at powers of two', () => {
    expect(log2milli(0n)).toBe(0n)
    expect(log2milli(1023n)).toBe(10_000n)
    expect(log2milli(1_000_000n) >= log2milli(999_999n)).toBe(true)
    expect(log2milli(1_100_000n) > log2milli(1_000_000n)).toBe(true)
  })

  test('checkpoint + recompute equals per-minute, including planned ops that expire midway', () => {
    const m0 = 29_000_000n
    const ring = Array(32).fill(0n)
    for (let i = 0n; i < 30n; i++) ring[Number((m0 + i) % 32n)] = word(m0 + i, (i * 7919n) % 50_000n)
    const ops = [
      { windowStart: (m0 + 5n) * 60n, windowEnd: (m0 + 12n) * 60n, registeredMinute: m0 + 3n, perMinute: 20_000n },
    ]
    // per-minute
    let s: CusumState = { minute: m0 - 1n, S: 0n, alarm: false, gap: false }
    for (let m = m0; m < m0 + 30n; m++) s = recompute(p, s, ring, m, ops)
    // checkpoint every 10
    let c: CusumState = { minute: m0 - 1n, S: 0n, alarm: false, gap: false }
    for (const stop of [m0 + 9n, m0 + 19n, m0 + 29n]) c = recompute(p, c, ring, stop, ops)
    expect({ S: c.S, alarm: c.alarm, minute: c.minute }).toEqual({ S: s.S, alarm: s.alarm, minute: s.minute })
  })

  test('same outflow judged differently by hour of week', () => {
    const night = step(p, 0n, 100_000n, 0n) // hour 0: low baseline
    const day = step(p, 0n, 100_000n, 10n * 60n) // hour 10: high baseline
    expect(night.S > day.S).toBe(true)
  })

  test('planned op discounts the minute down to zero, not below; registration minute bounds it', () => {
    const ops = [{ windowStart: 600n, windowEnd: 1200n, registeredMinute: 15n, perMinute: 500n }]
    expect(discounted(300n, 12n, ops)).toBe(300n) // before registration
    expect(discounted(300n, 16n, ops)).toBe(0n)
    expect(discounted(900n, 16n, ops)).toBe(400n)
  })

  test('minutes the ring no longer covers mark a gap', () => {
    const ring = Array(32).fill(0n)
    ring[0] = word(320n, 5n) // slot 0 now holds minute 320; minute 288 is gone
    const r = recompute(p, { minute: 287n, S: 0n, alarm: false, gap: false }, ring, 290n, [])
    expect(r.gap).toBe(true)
  })

  test('write every 10 minutes or when the alarm flips', () => {
    const a = { minute: 100n, S: 0n, alarm: false, gap: false }
    expect(shouldWrite(a, { ...a, minute: 105n })).toBe(false)
    expect(shouldWrite(a, { ...a, minute: 110n })).toBe(true)
    expect(shouldWrite(a, { ...a, minute: 101n, alarm: true })).toBe(true)
  })
})

// Patrol workflow (cron). Trigger indices are fixed (sim-runner relies on them):
// 0 ping, 1 native decoys, 2 epoch (threshold commit/reveal), 3 quota (refill, topUp, CUSUM,
// ASSET_CHECKPOINT, backlog), 4 reconcile (asset conservation, config drift, ops EOAs),
// 5 verify-edge (HTTP trigger: Trek proposes traced edges, CRE verifies them and writes derived THREATs).
// Every cron read uses the anchor block latest - ANCHOR_LAG (rule 5); config can pin it for DET.
import { cre, type HTTPPayload, type Runtime } from '@chainlink/cre-sdk'
import {
  type Address,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  hexToBytes,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toHex,
} from 'viem'
import { z } from 'zod'
import {
  type Action,
  act,
  encodeReport,
  QuorumLensAbi,
  QuorumReceiverAbi,
  ThreatRegistryAbi,
} from '../../packages/shared/src/index'
import { baseConfig, lower } from '../common/config'
import {
  anchorHeader,
  b64,
  bytesToHex,
  callAt,
  evmFor,
  type Header,
  protoBigIntToBigint,
  secret,
  taggedHeader,
  writeReport,
} from '../common/cre'
import { epochOf, thresholdCommitment, thresholdNonce, thresholdOf } from '../common/threshold'
import { type CusumState, DEFAULT_CUSUM, type PlannedOp, recompute, shouldWrite } from './src/logic/cusum'
import { checkDecoys, parsePatrolDecoys } from './src/logic/decoys'
import { decideEdges, parseEdgePayload, type ReceiptView, summarize } from './src/logic/edges'
import {
  backlog,
  checkpointActions,
  isClean,
  opsEoaCheck,
  type Params,
  type OrgView as PView,
  reconcile,
  refillActions,
  topUpActions,
} from './src/logic/patrol'

const range = z.object({ tMin: z.string(), tMax: z.string() })

export const configSchema = baseConfig.extend({
  schedule: z.string(),
  quorumLens: z.string(),
  anchorLag: z.number(),
  windowBlocks: z.number(), // N for the window check: >= 3 x the real execution interval
  enablePing: z.boolean(),
  enableDecoys: z.boolean(),
  fixedAnchorBlock: z.number().optional(), // DET runs only
  /** Phase 5: hidden threshold commit/reveal per epoch. */
  epoch: z.object({ epochLen: z.number(), thresholds: z.record(z.string(), range) }).optional(),
  /** Phase 6: quota, reconcile, CUSUM. Arrays follow the order of `tokens`. */
  phase6: z
    .object({
      quotaPeriod: z.number(),
      rMax: z.array(z.string()),
      topUpTargets: z.array(z.string()),
      alertTtlL2: z.number(),
      backlogAgeSec: z.number(),
      backlogMax: z.number(),
      backlogAlertTtl: z.number(),
      expectedConfigHash: z.record(z.string(), z.string()),
      opsEoas: z.array(z.object({ address: z.string(), gasBudgetWei: z.string() })),
      cusum: z.object({
        // one 168-slot baseline per token, same order as `tokens` (log2 x 1000 units)
        baselines: z.array(z.array(z.object({ mu: z.number(), sigma: z.number() })).length(168)),
        k: z.number(),
        h: z.number(),
        // Shewhart spike rule (36_phase6.md 6.3): per token, same order as `tokens`; "0" = off
        spikeMax: z.array(z.string()).optional(),
        spikeHold: z.number().optional(),
      }),
    })
    .optional(),
  /** docs/36 6.4 verify-edge. Absent = trigger 5 is registered but returns 'verify-edge disabled'. */
  verifyEdge: z
    .object({
      threatRegistry: z.string(),
      multicall3: z.string(),
      maxEdges: z.number().int().min(1).max(12),
      derivedTtl: z.number().int().positive(), // seconds; docs/36 6.4: derived entries live 24 h
      minAmounts: z.array(z.string()), // per token, same order as `tokens`: blunts dusting
      authorizedKeys: z.array(z.object({ type: z.literal('KEY_TYPE_ECDSA_EVM'), publicKey: z.string() })),
    })
    .optional(),
})
export type Config = z.infer<typeof configSchema>

type AddrView = { addr: Address; native: bigint }
// biome-ignore lint/suspicious/noExplicitAny: decoded Lens tuple, mapped field by field below
type Raw = any

function toView(o: Raw): PView {
  const v = (x: Raw) => ({
    vault: x.vault as Address,
    frozenUntil: BigInt(x.frozenUntil),
    configHash: x.configHash as Hex,
    balances: x.balances as bigint[],
    quotas: x.quotas as bigint[],
    caps: x.caps as bigint[],
    lastEpochs: (x.lastEpochs as bigint[]).map(BigInt),
    extOutTotals: x.extOutTotals as bigint[],
    fundedTotals: x.fundedTotals as bigint[],
  })
  return {
    orgId: o.orgId,
    alert: Number(o.alert),
    deployedMinute: BigInt(o.deployedMinute),
    tokens: o.tokens,
    reqRing: o.reqRing,
    verdictRing: o.verdictRing,
    hot: v(o.hot),
    warm: v(o.warm),
    hotOutRings: o.hotOutRings,
    assets: (o.assets as Raw[]).map((a) => ({ safeBlock: BigInt(a.safeBlock), set: a.set, value: BigInt(a.value) })),
    hotCheckpoints: (o.hotCheckpoints as Raw[]).map((c) => ({
      minute: BigInt(c.minute),
      alarm: c.alarm,
      gap: c.gap,
      S: BigInt(c.S),
    })),
  }
}

function view(runtime: Runtime<Config>, at: bigint, addrs: Address[] = []): { orgs: PView[]; addrs: AddrView[] } {
  const c = runtime.config
  const evm = evmFor(c.chainName)
  const orgIds = c.orgs.map((o) => o.orgId)
  const [orgs, a] = callAt(runtime, evm, c.quorumLens as Address, QuorumLensAbi, 'patrolView', [orgIds, addrs], at) as [
    Raw[],
    AddrView[],
  ]
  return { orgs: orgs.map(toView), addrs: a }
}

function send(runtime: Runtime<Config>, orgId: Hex, caseId: Hex, issuedAt: bigint, actions: Action[], tag: string) {
  const c = runtime.config
  if (actions.length === 0) return
  const org = c.orgs.find((o) => o.orgId.toLowerCase() === orgId.toLowerCase())!
  const report = encodeReport({ chainId: BigInt(c.chainId), orgId, caseId, issuedAt, actions })
  writeReport(runtime, evmFor(c.chainName), org.receiver as Address, report, BigInt(c.reportGasLimit), tag)
}

function params(c: Config): Params {
  return {
    chainId: BigInt(c.chainId),
    freezeDuration: BigInt(c.freezeDuration),
    alertTtlConfirmed: BigInt(c.alertTtlConfirmed),
    alertTtlL2: BigInt(c.phase6?.alertTtlL2 ?? 7200),
    coldDelayTight: BigInt(c.coldDelayTight),
    threatTtl: BigInt(c.threatTtl),
    backlogAge: BigInt(c.phase6?.backlogAgeSec ?? 900),
    backlogMax: BigInt(c.phase6?.backlogMax ?? 5),
    backlogAlertTtl: BigInt(c.phase6?.backlogAlertTtl ?? 1800),
  }
}

const caseOf = (label: string, orgId: Hex, n: bigint) =>
  keccak256(encodeAbiParameters(parseAbiParameters('string, bytes32, uint256'), [label, orgId, n]))

/** 0: PING (phase 1 path check). */
function onPing(runtime: Runtime<Config>): string {
  const c = runtime.config
  const evm = evmFor(c.chainName)
  const anchor = anchorHeader(runtime, evm, c.anchorLag, c.fixedAnchorBlock)
  const note = toHex(anchor.number, { size: 32 })
  const caseId = keccak256(encodeAbiParameters(parseAbiParameters('string, uint256'), ['ping', anchor.number]))
  for (const org of c.orgs) {
    const before = callAt(
      runtime,
      evm,
      org.receiver as Address,
      QuorumReceiverAbi,
      'lastPing',
      [],
      anchor.number,
    ) as Hex
    runtime.log(`ping org=${org.orgId.slice(0, 10)} lastPing=${before} note=${note}`)
    send(runtime, org.orgId as Hex, caseId, anchor.timestamp, [act.ping(note)], 'patrol ping')
  }
  return `ping ${c.orgs.length}`
}

/** 1: native-coin decoys; floor and window checks (32_phase2.md 2.5). */
function onDecoys(runtime: Runtime<Config>): string {
  const c = runtime.config
  const evm = evmFor(c.chainName)
  const decoys = parsePatrolDecoys(secret(runtime, 'PATROL_DECOYS'))
  if (decoys.length === 0) return 'no decoys'
  const anchor = anchorHeader(runtime, evm, c.anchorLag, c.fixedAnchorBlock)
  const addrs = decoys.map((d) => d.address)
  const balAnchor = view(runtime, anchor.number, addrs).addrs.map((a) => a.native)
  let balPrev: bigint[] | null = null
  try {
    balPrev = view(runtime, anchor.number - BigInt(c.windowBlocks), addrs).addrs.map((a) => a.native)
  } catch {
    runtime.log('[warn] window state unreadable; floor check only')
  }
  const trips = checkDecoys({
    chainId: BigInt(c.chainId),
    anchorBlock: anchor.number,
    anchorTime: anchor.timestamp,
    decoys,
    balAnchor,
    balPrev,
    orgs: c.orgs.map((o) => ({ orgId: o.orgId as Hex, hot: o.hotVault as Address, warm: o.warmVault as Address })),
    tokens: c.tokens.map((t) => t.address as Address),
    freezeDuration: BigInt(c.freezeDuration),
    alertTtl: BigInt(c.alertTtlConfirmed),
    coldDelay: BigInt(c.coldDelayTight),
    threatTtl: BigInt(c.threatTtl),
  })
  for (const t of trips) {
    runtime.log(`decoy tripped (${t.reason}) case=${t.caseId.slice(0, 10)}`)
    send(runtime, t.orgId, t.caseId, anchor.timestamp, t.actions, `patrol case=${t.caseId.slice(0, 10)}`)
  }
  return `decoys checked=${decoys.length} tripped=${trips.length}`
}

/** 2: commit this epoch's hidden threshold, reveal the previous one (both idempotent on chain). */
function onEpoch(runtime: Runtime<Config>): string {
  const c = runtime.config
  if (!c.epoch) return 'epoch disabled'
  const evm = evmFor(c.chainName)
  const anchor = anchorHeader(runtime, evm, c.anchorLag, c.fixedAnchorBlock)
  const k = hexToBytes(secret(runtime, 'QUORUM_K') as Hex)
  const e = epochOf(anchor.timestamp, BigInt(c.epoch.epochLen))
  const actions: Action[] = []
  for (const token of Object.keys(c.epoch.thresholds).sort()) {
    const r = c.epoch.thresholds[token]!
    const rg = { tMin: BigInt(r.tMin), tMax: BigInt(r.tMax) }
    const t = token as Address
    actions.push(act.thresholdCommit(e, t, thresholdCommitment(thresholdOf(k, e, t, rg), thresholdNonce(k, e, t))))
    if (e > 0n)
      actions.push(act.thresholdReveal(e - 1n, t, thresholdOf(k, e - 1n, t, rg), thresholdNonce(k, e - 1n, t)))
  }
  for (const o of c.orgs) {
    send(runtime, o.orgId as Hex, caseOf('epoch', o.orgId as Hex, e), anchor.timestamp, actions, `patrol epoch=${e}`)
  }
  return `epoch ${e}`
}

/** 3: loosening path. Refill / topUp only when anchor and FINALIZED are both clean (D10). */
function onQuota(runtime: Runtime<Config>): string {
  const c = runtime.config
  const p6 = c.phase6
  if (!p6) return 'quota disabled'
  const evm = evmFor(c.chainName)
  const anchor = anchorHeader(runtime, evm, c.anchorLag, c.fixedAnchorBlock)
  const safe: Header = taggedHeader(runtime, evm, 'safe')
  const fin: Header = taggedHeader(runtime, evm, 'finalized')
  const A = view(runtime, anchor.number).orgs
  const S = view(runtime, safe.number).orgs
  const F = view(runtime, fin.number).orgs
  const p = params(c)
  const anchorMinute = anchor.timestamp / 60n
  const cusumFor = (ti: number) => ({
    ...DEFAULT_CUSUM((p6.cusum.baselines[ti] ?? []).map((b) => ({ mu: BigInt(b.mu), sigma: BigInt(b.sigma) }))),
    k: BigInt(p6.cusum.k),
    h: BigInt(p6.cusum.h),
    spikeMax: BigInt(p6.cusum.spikeMax?.[ti] ?? '0'),
    spikeHold: BigInt(p6.cusum.spikeHold ?? 20000),
  })
  // planned ops whose window may overlap the recompute range (expired ones included)
  const rawOps = callAt(
    runtime,
    evm,
    c.quorumLens as Address,
    QuorumLensAbi,
    'plannedOps',
    [anchorMinute / 60n - 25n, anchorMinute / 60n],
    anchor.number,
  ) as Raw[]
  const ops = rawOps.map((o) => ({
    vault: (o.vault as string).toLowerCase(),
    token: (o.token as string).toLowerCase(),
    op: {
      windowStart: BigInt(o.windowStart),
      windowEnd: BigInt(o.windowEnd),
      registeredMinute: BigInt(o.registeredMinute),
      perMinute: BigInt(o.perMinute),
    } as PlannedOp,
  }))

  let wrote = 0
  A.forEach((a, i) => {
    const f = F[i]!
    const s = S[i]!
    const actions: Action[] = []
    const blA = backlog(a, anchorMinute, p.backlogAge / 60n)
    const blF = backlog(f, fin.timestamp / 60n, p.backlogAge / 60n)
    // backlog is tightening: the anchor view is enough
    if (blA > p.backlogMax) actions.push(act.alert(1, anchor.timestamp + p.backlogAlertTtl))

    const halve: boolean[] = []
    a.tokens.forEach((token, ti) => {
      const cp = a.hotCheckpoints[ti] ?? { minute: 0n, alarm: false, gap: false, S: 0n }
      const prev: CusumState = { minute: cp.minute, S: cp.S, alarm: cp.alarm, gap: cp.gap }
      const tokOps = ops
        .filter((o) => o.vault === a.hot.vault.toLowerCase() && o.token === token.toLowerCase())
        .map((o) => o.op)
      const next = recompute(cusumFor(ti), prev, a.hotOutRings[ti] ?? [], anchorMinute - 1n, tokOps)
      halve.push(next.alarm)
      if (shouldWrite(prev, next))
        actions.push(act.patrolState(a.hot.vault, token, next.minute, next.S, next.alarm, next.gap))
    })

    const clean = isClean(a, anchor.timestamp, blA, p.backlogMax) && isClean(f, fin.timestamp, blF, p.backlogMax)
    if (clean) {
      actions.push(...refillActions(a, anchor.timestamp, BigInt(p6.quotaPeriod), p6.rMax.map(BigInt), halve))
      actions.push(...topUpActions(a, p6.topUpTargets.map(BigInt)))
    }
    actions.push(...checkpointActions(s, safe.number))
    if (actions.length) {
      send(runtime, a.orgId, caseOf('quota', a.orgId, anchor.number), anchor.timestamp, actions, 'patrol quota')
      wrote++
    }
  })
  return `quota reports=${wrote}`
}

/** 4: tightening only, never reads logs; a failed read takes no action (D61). */
function onReconcile(runtime: Runtime<Config>): string {
  const c = runtime.config
  const p6 = c.phase6
  if (!p6) return 'reconcile disabled'
  const evm = evmFor(c.chainName)
  const anchor = anchorHeader(runtime, evm, c.anchorLag, c.fixedAnchorBlock)
  const safe = taggedHeader(runtime, evm, 'safe')
  const opsAddrs = p6.opsEoas.map((o) => o.address as Address)
  let A: { orgs: PView[]; addrs: AddrView[] }
  let S: { orgs: PView[]; addrs: AddrView[] }
  try {
    A = view(runtime, anchor.number, opsAddrs)
    S = view(runtime, safe.number, opsAddrs)
  } catch {
    runtime.log('[warn] patrolView failed; no action')
    return 'no-op'
  }
  let prevOps: AddrView[] | null = null
  try {
    prevOps = view(runtime, anchor.number - BigInt(c.windowBlocks), opsAddrs).addrs
  } catch {}
  const p = params(c)
  let n = 0
  A.orgs.forEach((a, i) => {
    const expected = p6.expectedConfigHash as Record<string, Hex>
    for (const r of reconcile(p, a, S.orgs[i]!, safe.number, anchor.timestamp, expected)) {
      send(runtime, a.orgId, r.caseId, anchor.timestamp, r.actions, `patrol reconcile case=${r.caseId.slice(0, 10)}`)
      n++
    }
  })
  if (prevOps) {
    const first = c.orgs[0]!
    p6.opsEoas.forEach((o, j) => {
      const acts = opsEoaCheck(
        prevOps![j]!.native,
        A.addrs[j]!.native,
        BigInt(o.gasBudgetWei),
        anchor.timestamp,
        p.alertTtlL2,
      )
      if (acts.length) {
        send(
          runtime,
          first.orgId as Hex,
          caseOf('ops-eoa', first.orgId as Hex, anchor.number),
          anchor.timestamp,
          acts,
          'patrol ops-eoa',
        )
        n++
      }
    })
  }
  return `reconcile cases=${n}`
}

const MULTICALL3 = parseAbi([
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
])

/**
 * 5: verify-edge (docs/36 6.4). Trek (untrusted, off chain) proposes up to 12 traced edges per call. Reads: anchor
 * header, one receipt per distinct tx, one Multicall3 call at the anchor (which parents are listed, which parent
 * evidences are valid). Writes one report of derived THREATs (tightening only) to the named org's Receiver.
 */
function onVerifyEdge(runtime: Runtime<Config>, payload: HTTPPayload): string {
  const c = runtime.config
  const ve = c.verifyEdge
  if (!ve) return 'verify-edge disabled'
  const body = parseEdgePayload(new TextDecoder().decode(payload.input), ve.maxEdges)
  const org = c.orgs.find((o) => lower(o.orgId) === body.orgId)
  if (!org) throw new Error('verify-edge: orgId is not one of ours')
  const evm = evmFor(c.chainName)
  const anchor = anchorHeader(runtime, evm, c.anchorLag, c.fixedAnchorBlock)

  const receipts = new Map<string, ReceiptView>()
  for (const tx of [...new Set(body.edges.map((e) => e.txHash))].sort()) {
    const r = evm.getTransactionReceipt(runtime, { hash: b64(tx) }).result().receipt
    receipts.set(
      tx,
      r
        ? {
            status: r.status,
            blockNumber: r.blockNumber ? protoBigIntToBigint(r.blockNumber) : 0n,
            logs: r.logs.map((l) => ({
              address: bytesToHex(l.address),
              topics: l.topics.map((t) => bytesToHex(t)),
              data: bytesToHex(l.data),
              index: l.index,
            })),
          }
        : null,
    )
  }

  const reg = ve.threatRegistry as Address
  const parents = [...new Set(body.edges.map((e) => e.parent))].sort()
  const evs = [...new Set(body.edges.map((e) => e.parentEvidence))].sort()
  const calls = [
    ...parents.map((a) => ({
      target: reg,
      allowFailure: false,
      callData: encodeFunctionData({ abi: ThreatRegistryAbi, functionName: 'isSuspect', args: [a] }),
    })),
    ...evs.map((h) => ({
      target: reg,
      allowFailure: false,
      callData: encodeFunctionData({ abi: ThreatRegistryAbi, functionName: 'evidenceExpiresAt', args: [h] }),
    })),
  ]
  const res = callAt(runtime, evm, ve.multicall3 as Address, MULTICALL3, 'aggregate3', [calls], anchor.number) as {
    success: boolean
    returnData: Hex
  }[]
  const suspects = new Set<string>()
  const evidence = new Set<string>()
  parents.forEach((a, i) => {
    const d = res[i]?.returnData ?? '0x'
    if (decodeFunctionResult({ abi: ThreatRegistryAbi, functionName: 'isSuspect', data: d })) suspects.add(a)
  })
  evs.forEach((h, j) => {
    const d = res[parents.length + j]?.returnData ?? '0x'
    const exp = decodeFunctionResult({ abi: ThreatRegistryAbi, functionName: 'evidenceExpiresAt', data: d }) as bigint
    if (exp > anchor.timestamp) evidence.add(h)
  })

  const decided = decideEdges({
    chainId: BigInt(c.chainId),
    edges: body.edges,
    receipts: body.edges.map((e) => receipts.get(e.txHash) ?? null),
    suspectsOnChain: suspects,
    evidenceOnChain: evidence,
    anchorNumber: anchor.number,
    anchorTime: anchor.timestamp,
    ttl: BigInt(ve.derivedTtl),
    minAmount: new Map(c.tokens.map((t, i) => [lower(t.address), BigInt(ve.minAmounts[i] ?? '0')])),
    protectedAddrs: new Set(c.orgs.flatMap((o) => [o.receiver, o.hotVault, o.warmVault, o.coldVault]).map(lower)),
  })
  runtime.log(`verify-edge ${summarize(decided.results)}`)
  if (decided.threats.length === 0) return 'verify-edge written=0'
  const caseId = keccak256(
    encodeAbiParameters(parseAbiParameters('string, bytes32, bytes32[]'), [
      'verify-edge',
      org.orgId as Hex,
      decided.threats.map((t) => t.evidenceHash),
    ]),
  )
  send(
    runtime,
    org.orgId as Hex,
    caseId,
    anchor.timestamp,
    decided.threats.map((t) => act.threat(t)),
    'patrol verify-edge',
  )
  return `verify-edge written=${decided.threats.length}`
}

export function initWorkflow(c: Config) {
  const cron = new cre.capabilities.CronCapability()
  const http = new cre.capabilities.HTTPCapability()
  // all six are always registered so trigger indices stay fixed; disabled ones return early
  const gate = (on: boolean, f: (r: Runtime<Config>) => string) => (r: Runtime<Config>) => (on ? f(r) : 'disabled')
  return [
    cre.handler(cron.trigger({ schedule: c.schedule }), gate(c.enablePing, onPing)),
    cre.handler(cron.trigger({ schedule: c.schedule }), gate(c.enableDecoys, onDecoys)),
    cre.handler(cron.trigger({ schedule: '0 0 * * * *' }), onEpoch),
    cre.handler(cron.trigger({ schedule: c.schedule }), onQuota),
    cre.handler(cron.trigger({ schedule: c.schedule }), onReconcile),
    cre.handler(http.trigger({ authorizedKeys: c.verifyEdge?.authorizedKeys ?? [] }), onVerifyEdge),
  ]
}

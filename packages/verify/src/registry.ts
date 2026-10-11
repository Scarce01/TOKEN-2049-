// Check registry: each D item (40_verification.md section 3) maps to concrete checks.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from '@quorum/shared/deployments'
import { bunTests, forge, paths, type Suite } from './runners'
import * as st from './static'

export type Status = 'pass' | 'fail' | 'not-yet' | 'waived'
export type SubResult = { type: string; name: string; status: Status; evidence: string }
export type Ctx = {
  forge: () => Suite
  wu: () => Suite
  shared: () => Suite
  db: () => Suite
  svc: () => Suite
  keeper: () => Suite
  notifier: () => Suite
  env: string
}

export type Sub = (c: Ctx) => SubResult | SubResult[]
export type Item = { id: string; title: string; phases: number[]; checks: Sub[] }

export const U =
  (...names: string[]): Sub =>
  (c) =>
    names.map((n) => {
      const s = c.forge()
      if (!s.ran) return { type: 'U', name: n, status: 'fail', evidence: s.error ?? 'forge did not run' }
      const o = s.get(n)
      return {
        type: n.startsWith('invariant') ? 'INV' : 'U',
        name: n,
        // a registered local test that no longer exists (renamed or deleted) is a failure, not a pending item
        status: o === 'pass' ? 'pass' : 'fail',
        evidence: o === 'missing' ? 'forge: test not found (renamed or removed)' : `forge ${o}`,
      }
    })

const suiteCheck =
  (type: string, pick: (c: Ctx) => Suite, ...names: string[]): Sub =>
  (c) =>
    names.map((n) => {
      const s = pick(c)
      if (!s.ran) return { type, name: n, status: 'fail', evidence: s.error ?? 'suite did not run' }
      const o = s.get(n)
      return {
        type,
        name: n,
        status: o === 'pass' ? 'pass' : 'fail',
        evidence: o === 'missing' ? 'bun test: test not found (renamed or removed)' : `bun test ${o}`,
      }
    })
export const WU = (...n: string[]) => suiteCheck('WU', (c) => c.wu(), ...n)
export const SH = (...n: string[]) => suiteCheck('U', (c) => c.shared(), ...n)
export const DB = (...n: string[]) => suiteCheck('DB', (c) => c.db(), ...n)
export const KEEPER = (...n: string[]) => suiteCheck('U', (c) => c.keeper(), ...n)
export const NOTIFIER = (...n: string[]) => suiteCheck('U', (c) => c.notifier(), ...n)
const SVC = (...n: string[]) => suiteCheck('U', (c) => c.svc(), ...n)

export const ST =
  (name: string, f: () => st.Result): Sub =>
  () => {
    try {
      const r = f()
      return { type: 'ST', name, status: r.notYet ? 'not-yet' : r.ok ? 'pass' : 'fail', evidence: r.evidence }
    } catch (e) {
      return { type: 'ST', name, status: 'fail', evidence: String(e).slice(0, 200) }
    }
  }

/** Testnet / CRE checks: pass only with a recorded scene result in reports/scenes/<name>.json. */
export const E2E =
  (name: string, type = 'E2E'): Sub =>
  () => {
    try {
      const r = JSON.parse(readFileSync(join(repoRoot, 'reports', 'scenes', `${name}.json`), 'utf8')) as {
        ok: boolean
        summary?: string
      }
      return { type, name, status: r.ok ? 'pass' : 'fail', evidence: r.summary ?? 'scene result' }
    } catch {
      return { type, name, status: 'not-yet', evidence: 'needs testnet deployment and CRE login (scene not run yet)' }
    }
  }

/** D36 on the live DON: decoy touch to the first FREEZE, measured by analysis/don_bench (reports/don/don_benchmark.json). */
export const donTrap: Sub = () => {
  const name = 'trap touch to freeze on the DON'
  try {
    const r = JSON.parse(readFileSync(join(repoRoot, 'reports', 'don', 'don_benchmark.json'), 'utf8')) as {
      trap?: { trigger_tx?: string; freeze_tx?: string; decoy_touch_to_freeze_s?: number }
    }
    const s = r.trap?.decoy_touch_to_freeze_s
    if (s === undefined)
      return { type: 'DON', name, status: 'not-yet', evidence: 'no trap probe in reports/don/don_benchmark.json' }
    return {
      type: 'DON',
      name,
      status: s <= 60 ? 'pass' : 'fail',
      evidence: `${s} s on Base Sepolia, trigger ${r.trap!.trigger_tx}, freeze ${r.trap!.freeze_tx} (one sample)`,
    }
  } catch {
    return { type: 'DON', name, status: 'not-yet', evidence: 'reports/don/don_benchmark.json missing' }
  }
}

/** A scene result when one was recorded, otherwise the fallback evidence. */
const sceneOr =
  (name: string, fallback: Sub): Sub =>
  (ctx) => {
    const r = E2E(name)(ctx) as SubResult
    return r.status === 'not-yet' ? fallback(ctx) : r
  }

const srcHas = (file: string, re: RegExp) => re.test(readFileSync(join(repoRoot, file), 'utf8'))

export const ITEMS: Item[] = [
  {
    id: 'D01',
    title: 'Trap path never goes through the exchange backend',
    phases: [2],
    checks: [ST('workflows and exchange-api isolated', st.backendIsolation), E2E('s2_wipe')],
  },
  {
    id: 'D02',
    title: 'Decoy wallet token outflow = confirmed',
    phases: [2],
    checks: [
      WU('A: decoy wallet outflow is a full confirmed pack with the recipient as suspect (D02)'),
      E2E('s1_trap'),
    ],
  },
  {
    id: 'D03',
    title: 'Native decoy drained -> confirmed within one interval',
    phases: [2, 6],
    checks: [
      WU(
        'balance below floor trips a confirmed pack (D03)',
        'drop inside the window while still above floor trips (D03 second check)',
      ),
      E2E('probe_native'),
    ],
  },
  {
    id: 'D06',
    title: 'Paying a decoy address = confirmed; strangers paying it do nothing',
    phases: [2, 3],
    checks: [
      WU(
        'B: our vault paying a decoy address tightens with suspect 0',
        'stranger paying a decoy address does nothing (D06)',
      ),
      E2E('stranger_transfer'),
    ],
  },
  {
    id: 'D08',
    title: 'All six confirmed actions take effect',
    phases: [2],
    checks: [U('test_confirmedPackTightensEverything'), E2E('s1_trap_status')],
  },
  {
    id: 'D09',
    title: 'Freeze has a term, only extends, extension needs two',
    phases: [2, 3],
    checks: [U('test_freezeOnlyExtends', 'test_extendFreezeNeedsTwoOfficers', 'invariant_I3_freezeMonotonic')],
  },
  {
    id: 'D10',
    title: 'Tighten on LATEST, loosen on FINALIZED, on-chain backstop',
    phases: [2, 6],
    checks: [
      U('test_noLooseningWhenConfirmedOrFrozen'),
      ST('Trap and Cosign triggers use LATEST; Cosign has one handler', () => {
        const trap = srcHas('workflows/trap/workflow.ts', /CONFIDENCE_LEVEL_LATEST/)
        const cos = readFileSync(join(repoRoot, 'workflows/cosign/workflow.ts'), 'utf8')
        const one = (cos.match(/cre\.handler\(/g) ?? []).length === 1 && /CONFIDENCE_LEVEL_LATEST/.test(cos)
        return { ok: trap && one, evidence: `trap LATEST=${trap}, cosign single LATEST handler=${one}` }
      }),
      WU('quota handler skips when either LATEST or FINALIZED is unclean'),
    ],
  },
  {
    id: 'D11',
    title: 'Alert ratchet',
    phases: [1, 3],
    checks: [U('test_alertRatchet', 'test_lowerAlertTwoOfficersAndQueue')],
  },
  {
    id: 'D12',
    title: 'Shared list: evidence, dedupe, mark only, expiry',
    phases: [2, 5],
    checks: [
      U('test_threatDedupAndCount', 'test_threatZeroSuspectSkippedQuietly', 'test_threatOwnVaultRejected'),
      ST('ThreatRegistry has no remove/block', st.threatRegistryNoRemove),
      U('test_threatMerkleProofRequired'),
    ],
  },
  {
    id: 'D13',
    title: 'Second exchange: same address to manual, follow level <= L1',
    phases: [4],
    checks: [WU('network follow level only records (max 1)'), E2E('s4_hop')],
  },
  {
    id: 'D14.1',
    title: 'Gate 1 txHash',
    phases: [3],
    checks: [WU('gate 1: tampered txHash rejects 11 (D14.1)'), E2E('forge_fields')],
  },
  {
    id: 'D14.2',
    title: 'Gate 2 Safe tx / token / vault',
    phases: [3, 6],
    checks: [WU('gate 2: Safe tx, foreign vault, unlisted token (D14.2)'), E2E('s6_bybit')],
  },
  {
    id: 'D14.3',
    title: 'Gate 3 signer / fields / expiry',
    phases: [3],
    checks: [WU('gate 3: wrong signer, no key, field mismatch, expired (D14.3)'), E2E('s3_forge')],
  },
  {
    id: 'D14.4',
    title: 'Gate 4 decoys before gates; list hit -> PENDING',
    phases: [3, 4],
    checks: [
      WU(
        'decoy account fires before gate 3, even with a forged signature (D14.4)',
        'gate 4: shared list -> PENDING 42, publicReason 0',
      ),
      E2E('forge_decoy'),
    ],
  },
  {
    id: 'D14.5',
    title: 'Gate 5 approved + amount <= deposit, re-checked on chain',
    phases: [3, 5],
    checks: [
      U('test_sameBlockOverDepositDowngraded'),
      WU('gate 5: approved + amount over deposit -> PENDING 51 (D14.5)'),
      E2E('same_block'),
    ],
  },
  {
    id: 'D15',
    title: 'PENDING reasons indistinguishable outside',
    phases: [3, 5],
    checks: [
      WU('PENDING verdicts are indistinguishable: publicReason 0, expiresAt 0, same sealed length (D15)'),
      U('test_pendingAndRejectUnusable'),
    ],
  },
  {
    id: 'D16',
    title: 'Verdict bound to txHash, single use, expiring, written once',
    phases: [1, 3],
    checks: [
      U(
        'test_verdictWrittenOnce',
        'test_approveUsableOnce',
        'test_expiredApproveUnusable',
        'test_txHashBindsRequestIdAndUser',
        'invariant_I2_verdictImmutable',
      ),
    ],
  },
  {
    id: 'D17',
    title: 'Vaults only transfer (no delegatecall/selfdestruct/callcode)',
    phases: [1],
    checks: [ST('bytecode scan', st.bytecodeScan)],
  },
  {
    id: 'D18',
    title: 'Sweep only to cold; TOPUP only to sibling hot',
    phases: [2, 6],
    checks: [U('invariant_I1_onlyLegitOutflows', 'test_topUpNotExternalOut', 'test_receiverOnlyActions')],
  },
  {
    id: 'D19',
    title: 'Receiver obeys only Forwarder + whitelisted workflow + allowed kinds; SIM guard',
    phases: [1],
    checks: [
      U(
        'test_rejectsNonForwarder',
        'test_prodRejectsWrongOwner',
        'test_prodRejectsWrongName',
        'test_metadata62And64BothDecode',
        'test_simRequiresSimOperator',
        'test_trapCannotSendVerdict',
        'test_rejectsWrongChain',
        'test_staleReportOnlyTightens',
      ),
    ],
  },
  {
    id: 'D20',
    title: 'No owner backdoor; deployer powerless; initialize once',
    phases: [1],
    checks: [
      ST('access manifest', st.accessManifest),
      U(
        'test_deployerHasNoConfigPower',
        'test_initializeOnlyOnce',
        'invariant_I7_noBackdoor',
        'test_oneSignatureCannotQueue',
        'test_queueWaitExecute',
        'test_oneOfficerCancels',
      ),
    ],
  },
  {
    id: 'D24',
    title: 'Quota bucket: r_max, epoch, cap',
    phases: [6],
    checks: [U('test_refillRules', 'invariant_I6_quotaBucket')],
  },
  {
    id: 'D27',
    title: 'Fail slow: CRE down, manual lane still works',
    phases: [3, 6],
    checks: [U('test_slowLaneAfterFreezeExpiry', 'test_manualNeedsTwoAndDelay'), E2E('stop_cre')],
  },
  {
    id: 'D28',
    title: 'Decoys indistinguishable (declared boundary)',
    phases: [1, 2, 5],
    checks: [DB('no column name hints at decoys'), E2E('seed_acceptance')],
  },
  {
    id: 'D29',
    title: 'Decoy list never leaks',
    phases: [1, 2, 4, 8],
    checks: [
      DB(
        'anon cannot read quorum_index.traps',
        'exchange_a_app cannot read traps',
        'logged-in non-officer sees no traps',
        'officer sees traps',
        'ponder_svc cannot read traps',
        'console_svc cannot update traps',
        'console_svc cannot write ponder_quorum',
        'authenticated users cannot touch ponder_quorum',
        'config.toml does not expose quorum_index, ponder_quorum or exchange schemas',
      ),
      ST('bundle scan', st.bundleScan),
    ],
  },
  {
    id: 'D30',
    title: 'Workflow determinism',
    phases: [1, 2, 3, 4, 5, 6],
    checks: [
      ST('workflow lint', st.workflowLint),
      ST('no --limits none', st.noLimitsNone),
      WU('deterministic: same facts, same actions', 'deterministic: same event twice gives identical bytes (D30)'),
      SH('deterministic: same input twice gives identical bytes'),
      E2E('det_patrol', 'DET'),
    ],
  },
  {
    id: 'D33',
    title: 'Only moves this exchange own funds',
    phases: [2],
    checks: [U('invariant_I1_onlyLegitOutflows')],
  },
  {
    id: 'D34',
    title: 'Backend sees only APPROVE/REJECT/PENDING + case id',
    phases: [3],
    checks: [ST('exchange-api imports no seal/unseal', st.backendIsolation)],
  },
  {
    id: 'D35',
    title: 'Manual lane: two + queue + one veto; funded first key queued',
    phases: [3],
    checks: [
      U(
        'test_manualNeedsTwoAndDelay',
        'test_manualCancelledByOne',
        'test_officerCancelsQueuedRegistration',
        'test_registerQueuedWithDeposit',
      ),
    ],
  },
  { id: 'D36', title: 'Trap to freeze under a minute', phases: [2], checks: [sceneOr('measure_trap', donTrap)] },
  {
    id: 'D38',
    title: 'Non-EVM multi-chain reconciliation',
    phases: [6],
    checks: [
      () => ({
        type: 'ST',
        name: 'waived',
        status: 'waived',
        evidence: 'STATUS design changes: D38 out of 36h scope (XRP decoy only)',
      }),
    ],
  },
  { id: 'D41', title: 'Every request gets a verdict', phases: [3], checks: [E2E('load_normal')] },
  { id: 'D47', title: 'Console current state from chain', phases: [2], checks: [E2E('console_without_indexer')] },
  {
    id: 'D48',
    title: 'Inconsistent sources never act',
    phases: [5, 6],
    checks: [WU('receipt must contain the exact log (D48)')],
  },
  { id: 'D59', title: 'Console chain reads cached per block', phases: [2], checks: [E2E('console_rpc_budget')] },
  {
    id: 'D62',
    title: 'Backend cannot flood Cosign; every request ends with a verdict',
    phases: [3, 6],
    checks: [U('test_bucketPerOrg', 'test_resubmitRules', 'test_verdictRingCountsBySubmitMinute')],
  },
  {
    id: 'D63',
    title: 'Reorg or new requestId never pays twice',
    phases: [3],
    checks: [U('test_orphanedVerdictIgnored', 'test_userNoncePaysOnce', 'test_signerNotKeyDowngraded')],
  },
  { id: 'D57', title: 'Every latency step measured', phases: [2, 3], checks: [E2E('latency_breakdown')] },
  { id: 'D45', title: 'Extractable after trigger', phases: [2], checks: [E2E('race')] },
  {
    id: 'D32',
    title: 'Every number has a source type',
    phases: [2],
    checks: [
      ST('Metric component requires source', () => ({
        ok: srcHas('apps/console/components/Metric.tsx', /source: Source/),
        evidence: 'Metric props.source is a required typed field',
      })),
    ],
  },
  { id: 'D56', title: 'Normal load: no dropped requests', phases: [3], checks: [E2E('load_normal_rate')] },
  { id: 'D60', title: 'Daily data volume within budget', phases: [3], checks: [E2E('db_volume')] },
  {
    id: 'sim-runner',
    title: 'Mode B runner priority and dedupe (supports D36 / D56)',
    phases: [2],
    checks: [
      SVC(
        'Trap beats Patrol beats Cosign; Cosign floods cannot starve Trap',
        'simulate args keep production limits (no --limits)',
      ),
    ],
  },
]

export function mkCtx(env: string): Ctx {
  const memo = <T>(f: () => T) => {
    let v: T | undefined
    return () => {
      if (v === undefined) v = f()
      return v
    }
  }
  return {
    env,
    forge: memo(forge),
    wu: memo(() => bunTests(paths.workflows)),
    shared: memo(() => bunTests(paths.shared)),
    db: memo(() => bunTests(paths.verify, ['--timeout', '60000', 'test/db'])),
    svc: memo(() => bunTests(paths.simRunner)),
    keeper: memo(() => bunTests(paths.keeper)),
    notifier: memo(() => bunTests(paths.notifier)),
  }
}

export function itemStatus(subs: SubResult[]): Status {
  if (subs.some((s) => s.status === 'fail')) return 'fail'
  if (subs.length && subs.every((s) => s.status === 'waived')) return 'waived'
  if (subs.some((s) => s.status === 'not-yet')) return 'not-yet'
  return 'pass'
}

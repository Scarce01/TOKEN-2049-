// Phase 4 to 6 checks. Merged into ITEMS by D id (an entry here replaces the earlier one with the same id).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from '@quorum/shared/deployments'
import { DB, E2E, type Item, KEEPER, NOTIFIER, SH, ST, type Sub, U, WU } from './registry'
import * as st from './static'

/** Offline analysis result in analysis/out/<name>.json (local; decoy labels never leave the machine). */
// biome-ignore lint/suspicious/noExplicitAny: analysis JSON
type Json = any
const OFF =
  (name: string, judge: (j: Json) => { ok: boolean; ev: string }): Sub =>
  () => {
    try {
      const j = JSON.parse(readFileSync(join(repoRoot, 'analysis', 'out', `${name}.json`), 'utf8'))
      const r = judge(j)
      return { type: 'OFF', name, status: r.ok ? 'pass' : 'fail', evidence: r.ev }
    } catch {
      return { type: 'OFF', name, status: 'not-yet', evidence: `run analysis (analysis/out/${name}.json missing)` }
    }
  }

const pct = (x: number) => `${(x * 100).toFixed(2)}%`

export const ITEMS_P456: Item[] = [
  {
    id: 'D10',
    title: 'Tighten on LATEST, loosen on FINALIZED, on-chain backstop',
    phases: [2, 6],
    checks: [
      U('test_noLooseningWhenConfirmedOrFrozen'),
      ST('Trap and Cosign triggers use LATEST; Cosign has one handler', () => {
        const trap = /CONFIDENCE_LEVEL_LATEST/.test(readFileSync(join(repoRoot, 'workflows/trap/workflow.ts'), 'utf8'))
        const cos = readFileSync(join(repoRoot, 'workflows/cosign/workflow.ts'), 'utf8')
        const one = (cos.match(/cre\.handler\(/g) ?? []).length === 1 && /CONFIDENCE_LEVEL_LATEST/.test(cos)
        return { ok: trap && one, evidence: `trap LATEST=${trap}, cosign single LATEST handler=${one}` }
      }),
      WU('LATEST clean but FINALIZED not (and the reverse): no refill'),
    ],
  },
  {
    id: 'D12',
    title: 'Shared list: evidence, dedupe, mark only, expiry, Merkle proof, live parent',
    phases: [2, 5],
    checks: [
      U('test_threatDedupAndCount', 'test_threatZeroSuspectSkippedQuietly', 'test_threatOwnVaultRejected'),
      ST('ThreatRegistry has no remove/block', st.threatRegistryNoRemove),
      U(
        'test_merkleProofVerifies',
        'test_threatNeedsValidProof',
        'test_derivedNeedsLiveParent',
        'test_sameEvidenceDoesNotRenew',
        'test_leafCountPowerOfTwo',
        'test_decoyLeafVector',
      ),
      SH('tree proofs verify, a flipped byte fails, leaf matches DecoyCommit.leafOf vector'),
    ],
  },
  {
    id: 'D21',
    title: 'Hidden threshold derived per epoch, committed, revealed and checked',
    phases: [5],
    checks: [
      U('test_thresholdCommitRevealViaReports', 'test_onlyReceiverCommits'),
      WU('hidden threshold: deterministic per epoch and token, inside the range, changes across epochs'),
      E2E('threshold_two_epochs'),
    ],
  },
  {
    id: 'D22',
    title: 'SPRT thresholds; weak signals only delay or go manual',
    phases: [5],
    checks: [
      WU(
        'threshold hug alone: 7560 capped to 6801 -> L2, delayed D2 (D05)',
        'new account + new address are capped together at 1500 -> L0',
        'L2: new recipient -> delayed D2 even for a small amount; L3: everything delayed D3',
      ),
    ],
  },
  {
    id: 'D23',
    title: 'Encrypted score rewritten on every verdict; deterministic; no nonce reuse',
    phases: [5],
    checks: [
      WU(
        'same event twice: identical ciphertext; another requestId: different ciphertext',
        'decrypting before and after: L2 = decay(L1) + lambda (D23)',
        'REJECT (gates 1 to 3) writes no score: forged requests cannot push a user up (D23)',
      ),
    ],
  },
  {
    id: 'D24',
    title: 'Quota bucket: r_max, epoch, cap',
    phases: [6],
    checks: [
      U('test_refillRules', 'invariant_I6_quotaBucket'),
      WU('refill r_max per missed epoch, capped by cap - quota'),
    ],
  },
  {
    id: 'D25',
    title: 'CUSUM only slows refill, never blocks',
    phases: [6],
    checks: [WU('CUSUM alarm halves the refill (soft action only)')],
  },
  {
    id: 'D26',
    title: 'Reconciliation by asset conservation; ops EOAs',
    phases: [6],
    checks: [WU('V is unchanged by execute, sweep, topUp and fund', 'ops EOA drop beyond gas budget -> L2')],
  },
  {
    id: 'D28',
    title: 'Decoys indistinguishable (declared boundary)',
    phases: [1, 2, 5],
    checks: [
      DB('no column name hints at decoys'),
      E2E('seed_acceptance'),
      OFF('decoy_auc_a_60', (j) => ({
        ok: j.target_le_0_65 === true,
        ev: `top-${j.top}: logistic ${j.logistic.auc.toFixed(3)}, GB ${j.gradient_boosting.auc.toFixed(3)}, upper bound ${j.auc_upper_bound.toFixed(3)} (target <= 0.65)`,
      })),
    ],
  },
  {
    id: 'D37',
    title: 'Config drift freezes',
    phases: [6],
    checks: [WU('config drift freezes that vault (D37)'), E2E('config_drift')],
  },
  {
    id: 'D39',
    title: 'Hit probability: formula vs Monte Carlo within 1 pp',
    phases: [5],
    checks: [
      OFF('hit_probability', (j) => ({
        ok: j.D39_pass === true,
        ev: `formula ${pct(j.formula)}, MC ${pct(j.monte_carlo)} (${j.runs} runs), diff ${j.abs_diff_pp.toFixed(3)} pp`,
      })),
    ],
  },
  {
    id: 'D42',
    title: 'Delayed release: L1 D1; over cap, L2 new address D2; L3 D3; all auto-release (docs/47)',
    phases: [5],
    checks: [
      WU(
        'L1: cap halves and APPROVE carries notBefore = block time + L1_DELAY (D42)',
        'L2: new recipient -> delayed D2 even for a small amount; L3: everything delayed D3',
        'L0: amount over T_e -> APPROVE delayed D2 (code 71); under -> APPROVE now',
        'a delayed APPROVE stays valid for VERDICT_TTL after notBefore',
        'shared list, deposit and price problems stay PENDING (not auto-paid)',
      ),
      U('test_executeRespectsNotBefore'),
    ],
  },
  {
    id: 'D48',
    title: 'Inconsistent sources never act',
    phases: [5, 6],
    checks: [
      WU(
        'receipt must contain the exact log (D48)',
        'gate 6: stale price -> PENDING 62; second source mismatch -> PENDING 61 (D48)',
      ),
    ],
  },
  {
    id: 'D50',
    title: 'Fixed point matches float reference',
    phases: [5, 6],
    checks: [WU('decay after 24 h follows gamma = 0.9 per hour; fixed point within 1 milli-nat of float (D50)')],
  },
  {
    id: 'D52',
    title: 'Attacker strategy simulations have results',
    phases: [5],
    checks: [
      OFF('adversary_sim', (j) => ({
        ok: Array.isArray(j) && j.length === 3 && j.every((r: { runs: number }) => r.runs >= 1000),
        ev: Array.isArray(j)
          ? j.map((r: { strategy: number; hit_rate: number }) => `s${r.strategy} hit ${pct(r.hit_rate)}`).join(', ')
          : '',
      })),
    ],
  },
  {
    id: 'D53',
    title: 'Score is explainable (lambda per signal in sealedReason)',
    phases: [5],
    checks: [WU('decrypting before and after: L2 = decay(L1) + lambda (D23)')],
  },
  {
    id: 'D55',
    title: 'CUSUM by hour of week; planned ops excluded',
    phases: [6],
    checks: [
      WU(
        'same outflow judged differently by hour of week',
        'planned op discounts the minute down to zero, not below; registration minute bounds it',
      ),
    ],
  },
  {
    id: 'D58',
    title: 'CUSUM checkpoint + recompute equals per-minute',
    phases: [6],
    checks: [
      WU(
        'checkpoint + recompute equals per-minute, including planned ops that expire midway',
        'minutes the ring no longer covers mark a gap',
      ),
      U('test_patrolStateMinuteMustIncrease', 'test_outRingAcrossMinutes'),
    ],
  },
  {
    id: 'D61',
    title: 'Reconcile reads no logs; anchor-only shortfall is soft',
    phases: [6],
    checks: [
      WU(
        'anchor sees V drop, SAFE does not: soft tightening only (QUOTA_ZERO + L2)',
        'SAFE sees it too: confirmed pack',
        'first run after deploy: no checkpoint, no comparison',
      ),
    ],
  },
  {
    id: 'D62',
    title: 'Backend cannot flood Cosign; every request ends with a verdict',
    phases: [3, 6],
    checks: [
      U('test_bucketPerOrg', 'test_resubmitRules', 'test_verdictRingCountsBySubmitMinute'),
      WU('requests without verdicts older than BACKLOG_AGE count; recent ones and pre-deploy minutes do not'),
    ],
  },
  {
    id: 'D64',
    title: 'Concurrent requests cannot overwrite the score',
    phases: [5],
    checks: [
      U(
        'test_scoreCompareAndSwap',
        'test_scoreConflictSkipsVerdict',
        'test_scoreRerunIsQuiet',
        'test_verdictBeforeScoreSkipsBothButTightens',
      ),
    ],
  },
  {
    id: 'D65',
    title: 'Asset conservation checkpoint is trustworthy',
    phases: [6],
    checks: [
      U('test_assetCheckpointHighWater', 'test_assetCheckpointWrongOrgRejected', 'test_assetResetNeedsTwoAndDelay'),
      WU('checkpoint written every run, but never below the high-water mark'),
    ],
  },
  // Items the 2026-10-05 reviews found unregistered (cli.ts now fails any D item missing here).
  {
    id: 'D04',
    title: 'Decoy account: backend sees only PENDING, chain gets a confirmed pack',
    phases: [3],
    checks: [
      WU(
        'decoy: confirmed pack then VERDICT PENDING',
        'decoy account fires before gate 3, even with a forged signature (D14.4)',
      ),
      E2E('forge_decoy'),
    ],
  },
  {
    id: 'D05',
    title: 'Fake threshold fingerprint is a strong signal: L2, no on-chain tightening',
    phases: [5],
    checks: [WU('threshold hug alone: 7560 capped to 6801 -> L2, delayed D2 (D05)'), E2E('probe_threshold')],
  },
  { id: 'D07', title: 'Decoy credentials used = confirmed (P2)', phases: [6], checks: [E2E('use_api_keys')] },
  {
    id: 'D14.6',
    title: 'Gate 6: source mismatch or stale price -> PENDING',
    phases: [5],
    checks: [WU('gate 6: stale price -> PENDING 62; second source mismatch -> PENDING 61 (D48)'), E2E('stale_price')],
  },
  {
    id: 'D14.7',
    title: 'Gate 7: hidden cap x level',
    phases: [5],
    checks: [
      WU(
        'L0: amount over T_e -> APPROVE delayed D2 (code 71); under -> APPROVE now',
        'L1: cap halves and APPROVE carries notBefore = block time + L1_DELAY (D42)',
        'L2: new recipient -> delayed D2 even for a small amount; L3: everything delayed D3',
      ),
      E2E('l2_new_recipient'),
    ],
  },
  {
    id: 'D31',
    title: 'Tracing excludes exchanges, DEXs, bridges and our contracts',
    phases: [6],
    checks: [E2E('trace_exclusion')],
  },
  { id: 'D43', title: 'Timeline starts at the first probe transfer', phases: [4], checks: [E2E('s5_timeline')] },
  {
    id: 'D44',
    title: 'Fingerprint and weak-signal false-pending rate on normal users',
    phases: [5],
    checks: [E2E('load_normal_fingerprint')],
  },
  { id: 'D46', title: 'AWS alerts actually fire', phases: [8], checks: [E2E('aws_alerts')] },
  { id: 'D49', title: 'Ops traffic replay trips decoys 0 times', phases: [6], checks: [E2E('ops_replay')] },
  {
    id: 'D51',
    title: 'Tracing backtest: recall reported, identical across sources',
    phases: [6],
    checks: [E2E('trace_bybit')],
  },
  {
    id: 'D54',
    title: 'False positives reported as delays per 10k, added wait, manual reviews per day',
    phases: [6],
    checks: [
      OFF('false_positive_a', (j) => {
        const ok = ['delayed_per_10k', 'added_wait_avg_seconds_for_delayed', 'manual_reviews_per_day'].every(
          (k) => typeof j[k] === 'number',
        )
        return { ok, ev: ok ? `three metrics present (source ${j.source})` : 'a metric is missing' }
      }),
    ],
  },
  {
    id: 'D102',
    title: 'docs/47 R2: large to a new address is delayed; shadow rules only log',
    phases: [5],
    checks: [
      WU('R2 large to a new address: enforce delays, shadow only records, known address is untouched (docs/47)'),
      U(
        'test_largeNewFloorDelaysEvenIfCreSaysNow',
        'test_largeNewNoFloorForKnownRecipient',
        'test_largeNewKeepsLongerCreDelay',
        'test_largeNewOffWhenZero',
        'test_setLargeNewMinOnlyTimelock',
        'test_recipientRecorded',
      ),
      E2E('fork_prevention_e2e'),
    ],
  },
  {
    id: 'D103',
    title: 'One officer HOLDs one approved withdrawal (capped, expires, cooldown); two officers cancel',
    phases: [5],
    checks: [
      U(
        'test_oneOfficerHoldsUntilExpiry',
        'test_holdCappedAtHoldMax',
        'test_holdCooldownStopsRelocking',
        'test_holdOnlyUnusedApprove',
        'test_cancelNeedsTwoOfficers',
      ),
      E2E('fork_prevention_e2e'),
    ],
  },
  {
    id: 'D112',
    title:
      'R7 protected lane: during a freeze, only a mature recipient + small amount + budget R gets through; SWEEP leaves a reserve; off by default; per-token params, never-paid is never mature (docs/47 R7, audit 2026-10-07)',
    phases: [6],
    checks: [
      U(
        'test_laneOffByDefaultFreezeBlocksMatureSmall',
        'test_laneLetsMatureSmallThroughDuringFreeze',
        'test_newRecipientBlockedEvenSmall',
        'test_largeAmountBlockedInLane',
        'test_budgetExhaustsThenBlocks',
        'test_budgetRefillsPerMinute',
        'test_sweepLeavesReserve',
        'test_manualStillBlockedByFreeze',
        'test_matureAgeIsPerToken',
        'test_enabledLaneRejectsZeroMatureAge',
        'test_reserveBoundedByCapAndOffWhenLaneOff',
        'test_neverPaidRecipientNotMatureEvenAfterLongWait',
      ),
    ],
  },
  {
    id: 'D113',
    title:
      'Tracing on chain: CRE verify-edge writes a derived THREAT only for a verified transfer out of a listed suspect (docs/36 6.4)',
    phases: [6],
    checks: [
      WU(
        'two hops in one batch: the child of a verified edge can be the parent of the next',
        'a real transfer from an unlisted address cannot flag anyone (compromised tracer)',
        'every mismatch has its own reason',
        'the same edge twice in a batch is written once',
      ),
      E2E('fork_trace_e2e'),
    ],
  },
  {
    id: 'D104',
    title: 'Hourly and daily outflow windows; caps change only through the timelock',
    phases: [6],
    checks: [U('test_hourWindowCapsOutflow', 'test_dayWindowCapsOutflow', 'test_setWindowCapsOnlyTimelock')],
  },
  {
    id: 'D105',
    title: 'A delayed APPROVE pays out when due without the exchange: independent keeper; backend retries',
    phases: [5],
    checks: [
      KEEPER(
        'due: APPROVE, unused, past notBefore, before expiry, not held',
        'too early or held: wait and retry later',
        'used, cancelled, expired, PENDING or REJECT: drop',
      ),
      E2E('fork_prevention_e2e'),
    ],
  },
  {
    id: 'D111',
    title:
      'Key rotation needs both keys; recovery alone waits RECOVERY_DELAY, a second factor shortens or cancels it (docs/47 3.7, audit High 3)',
    phases: [5],
    checks: [
      U(
        'test_rotateNeedsCurrentAndNewKey',
        'test_recoveryAloneWaitsRecoveryDelay',
        'test_approveRecoveryNeedsARegisteredFactor',
        'test_factorShortensRecovery',
        'test_factorOrCurrentKeyCancelsRecovery',
        'test_factorAfterDepositWaitsAndKeyCanCancel',
        'test_factorNeedsBothSignaturesAndOnlyOne',
      ),
    ],
  },
  {
    id: 'D109',
    title: 'Passkey paying a never-paid address waits passkeyNewDelay; wallets do not (docs/47 3.6)',
    phases: [5],
    checks: [
      U('test_passkeyRegistersSignsAndGetsPaid', 'test_walletNewRecipientHasNoPasskeyFloor'),
      E2E('fork_prevention_e2e'),
    ],
  },
  {
    id: 'D110',
    title: 'A key change blocks queued approvals signed by the old key; first payment time is recorded (docs/47 3.6)',
    phases: [5],
    checks: [
      U(
        'test_keyChangeBlocksQueuedApprove',
        'test_withoutKeyChangeQueuedApprovePays',
        'test_firstPaymentTimestampsRecipient',
      ),
    ],
  },
  {
    id: 'D108',
    title:
      'Notifier: the user hears what the chain says, independent of the exchange; it cannot see the decoy list (docs/47 3.5)',
    phases: [5],
    checks: [
      NOTIFIER(
        'delayed APPROVE: amount, recipient, minutes left, how to cancel',
        'immediate APPROVE, PENDING and REJECT each get their own message',
        'held, cancelled by user, cancelled by officers, paid',
        'events for unknown requests produce nothing',
      ),
      DB(
        'notifier_svc cannot read traps',
        'notifier_svc can read notify_channels but not write them',
        'exchange_a_app and anon cannot read notify_channels',
      ),
    ],
  },
  {
    id: 'D107',
    title:
      'Passkey (P-256 / WebAuthn) keys register, sign withdrawals and get paid; bad assertions give signer 0 (docs/47 3.4)',
    phases: [5],
    checks: [
      U(
        'test_passkeyRegistersSignsAndGetsPaid',
        'test_passkeyWrongChallengeGivesSignerZero',
        'test_passkeyHighSRejected',
        'test_malformedBlobGivesSignerZeroWithoutRevert',
        'test_passkeyWrongKeyIdOnRegisterRejected',
        'test_keyIdVector',
      ),
      SH('p256 key id equals forge (docs/47 3.4)', 'software passkey blob round-trips the Auth layout'),
      E2E('fork_prevention_e2e'),
    ],
  },
  {
    id: 'D106',
    title: 'User cancels their own queued withdrawal with the registered key (docs/47 3.3)',
    phases: [5],
    checks: [
      U(
        'test_userCancelsOwnDelayedApprove',
        'test_userCancelWrongKeyRejected',
        'test_userCancelExpiredSignature',
        'test_userCancelOnlyUnusedApproveAndOnce',
        'test_userCancelSignatureBoundToOneWithdrawal',
        'test_cancelDigestVector',
      ),
      SH('cancel digest equals forge (docs/47 3.3)'),
      E2E('fork_prevention_e2e'),
    ],
  },
  {
    id: 'D20',
    title: 'No owner backdoor; deployer powerless; initialize once; Receiver obeys only its OfficerDesk',
    phases: [1],
    checks: [
      U(
        'test_deployerHasNoConfigPower',
        'test_initializeOnlyOnce',
        'invariant_I7_noBackdoor',
        'test_oneSignatureCannotQueue',
        'test_queueWaitExecute',
        'test_oneOfficerCancels',
        'test_deskPrimitivesRejectNonDesk',
        'test_deskSetOnceAtInitialize',
        'test_signatureForReceiverDomainFailsOnDesk',
        'test_deskHasNoOwnerOrConfig',
      ),
      ST('access manifest', st.accessManifest),
    ],
  },
]

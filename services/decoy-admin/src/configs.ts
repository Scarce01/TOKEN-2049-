// Writes workflows/{trap,cosign,patrol}/config.staging.json from the deployment and local secrets.
// These files are gitignored: the trap config holds plaintext decoy addresses (log filters need them).
import { join } from 'node:path'
import type { DecoyFile } from '@quorum/datasets/src/gen-keys'
import { type Deployment, readJson, repoRoot, secretsDir, writeJson } from '@quorum/offchain'
import { CRE_CHAIN_NAME, decoyTag, ORGS, Params } from '@quorum/shared'
import { type Hex, hexToBytes } from 'viem'
import { nownodesUrlFor } from '../../../workflows/trap/src/logic/nownodes'

export function genWorkflowConfigs(d: Deployment): void {
  const decoys = readJson<DecoyFile>(join(secretsDir, 'decoys.local.json'), {})
  const sealKeys = readJson<string[]>(join(secretsDir, 'officer-seal-pubkeys.json'), [])
  const orgs = [d.orgA, d.orgB].map((o) => ({
    orgId: o.orgId,
    receiver: o.receiver,
    hotVault: o.hotVault,
    warmVault: o.warmVault,
    coldVault: o.coldVault,
  }))
  const base = {
    chainName:
      d.chainId === 31337 ? 'anvil-devnet' : d.chainId === 11155111 ? 'ethereum-testnet-sepolia' : CRE_CHAIN_NAME,
    chainId: d.chainId,
    orgs,
    tokens: [
      { address: d.qUSD, decimals: 6 },
      { address: d.qETH, decimals: 18 },
    ],
    reportGasLimit: Params.REPORT_GAS_LIMIT.toString(),
    freezeDuration: Params.FREEZE_DURATION,
    alertTtlConfirmed: Params.ALERT_TTL_CONFIRMED,
    coldDelayTight: Params.COLD_DELAY_TIGHT,
    threatTtl: Params.THREAT_TTL,
  }
  const wf = (name: string) => join(repoRoot, 'workflows', name, 'config.staging.json')

  const kFile = readJson<{ k: Hex }>(join(secretsDir, 'quorum_k.local.json'), { k: '0x' as Hex })
  const k = kFile.k === '0x' ? null : hexToBytes(kFile.k)
  const decoyProofs: Record<string, { i: number; path: string[] }> = {}
  const decoyWallets: { address: string; orgId: string; i?: number; path?: string[] }[] = []
  const decoyAddresses: { address: string; orgId: string }[] = []
  for (const [o, v] of Object.entries(decoys)) {
    for (const w of v.wallets) {
      const x = w as { i?: number; path?: string[] }
      decoyWallets.push({
        address: w.address,
        orgId: ORGS[o as 'a' | 'b'],
        ...(x.path ? { i: x.i, path: x.path } : {}),
      })
    }
    for (const a of v.accounts) {
      const x = a as { i?: number; path?: string[]; userIdHash?: Hex }
      if (k && x.path && x.userIdHash) decoyProofs[decoyTag(k, 'acct', x.userIdHash)] = { i: x.i!, path: x.path }
    }
    for (const a of v.addresses) decoyAddresses.push({ address: a.address, orgId: ORGS[o as 'a' | 'b'] })
  }
  // The fork demo (packages/offchain/scripts/fork-demo/setup.ts) commits its own org A decoy and saves the proof in
  // secrets/fork-demo.local.json. Keep it in the trap config, but only while that proof belongs to this deployment's
  // DecoyCommit (a redeploy makes it stale; setup.ts then commits a new one).
  const demo = readJson<{
    wallets?: { address: string; decoy?: boolean }[]
    proof?: { i: number; path: string[]; decoyCommit: string }
  } | null>(join(secretsDir, 'fork-demo.local.json'), null)
  const demoDecoy = demo?.wallets?.find((w) => w.decoy)
  if (demoDecoy && demo?.proof && demo.proof.decoyCommit.toLowerCase() === d.decoyCommit.toLowerCase()) {
    if (!decoyWallets.some((w) => w.address.toLowerCase() === demoDecoy.address.toLowerCase()))
      decoyWallets.push({ address: demoDecoy.address, orgId: ORGS.a, i: demo.proof.i, path: demo.proof.path })
  }
  const protectedAddrs = [
    d.requestBoard,
    d.depositVault,
    d.keyRegistry,
    ...orgs.flatMap((o) => [o.receiver, o.hotVault, o.warmVault, o.coldVault]),
  ]
  writeJson(wf('trap'), {
    ...base,
    decoyWallets,
    decoyAddresses,
    protectedAddrs,
    nownodesRpcUrl: nownodesUrlFor(d.chainId),
  })
  writeJson(wf('cosign'), {
    ...base,
    requestBoard: d.requestBoard,
    quorumLens: d.quorumLens,
    verdictTtl: Params.VERDICT_TTL,
    phase5: {
      usdToken: d.qUSD,
      priceDecimals: 8,
      maxPriceAge: 3600,
      epochLen: 3600,
      l1Delay: Params.L1_DELAY,
      d2Delay: Params.D2_DELAY,
      d3Delay: Params.D3_DELAY,
      // docs/47 R2, shadow first: measure false delays before enforcing. L_pub above the hidden cap range.
      largeNew: {
        mode: 'shadow',
        delay: Params.LARGE_NEW_DELAY,
        minAmount: { [d.qETH]: (4n * 10n ** 18n).toString(), [d.qUSD]: '5000000000' },
      },
      thresholds: {
        [d.qETH]: { tMin: (10n ** 18n).toString(), tMax: (3n * 10n ** 18n).toString() },
        [d.qUSD]: { tMin: '500000000', tMax: '2000000000' },
      },
      fakeThresholdToken: d.qETH, // risk_config advertises 5 qETH
      gammaPpm: 900000,
    },
    officerSealKeys: sealKeys,
    decoyProofs,
  })
  // CUSUM baseline: real Binance-14 H0 (public_onchain, BigQuery 2026-09) shifted to demo size
  // (scale is assumed); falls back to the synthetic baseline, then to a flat one.
  const flat = Array.from({ length: 168 }, () => ({ mu: 0, sigma: 1000 }))
  const h0 = readJson<{
    cusum_baseline_binance14: { stable: string; eth: string }
    demo_scaling: { stable: { mu_offset_milli: number }; eth: { mu_offset_milli: number } }
  } | null>(join(repoRoot, 'datasets', 'public', 'h0_binance_2026-09.json'), null)
  const parse = (s: string, off: number) =>
    s.split(',').map((p) => {
      const [mu, sigma] = p.split(':').map(Number)
      return { mu: Math.max(0, (mu ?? 0) + off), sigma: sigma ?? 1000 }
    })
  const synth = readJson<{ tokens: Record<string, { mu: number; sigma: number }[]> } | null>(
    join(repoRoot, 'datasets', 'out', 'cusum-baseline-a.json'),
    null,
  )
  const bl = h0
    ? {
        tokens: {
          qUSD: parse(h0.cusum_baseline_binance14.stable, h0.demo_scaling.stable.mu_offset_milli),
          qETH: parse(h0.cusum_baseline_binance14.eth, h0.demo_scaling.eth.mu_offset_milli),
        },
      }
    : synth
  const opsEoas = readJson<Record<string, { address: string }[]>>(join(secretsDir, 'ops-eoas.local.json'), {})
  writeJson(wf('patrol'), {
    ...base,
    epoch: {
      epochLen: 3600,
      thresholds: {
        [d.qETH]: { tMin: (10n ** 18n).toString(), tMax: (3n * 10n ** 18n).toString() },
        [d.qUSD]: { tMin: '500000000', tMax: '2000000000' },
      },
    },
    phase6: {
      quotaPeriod: Params.QUOTA_PERIOD,
      rMax: ['1000000000', (3n * 10n ** 17n).toString()],
      topUpTargets: ['8000000000', (2n * 10n ** 18n).toString()],
      alertTtlL2: Params.ALERT_TTL_L2,
      backlogAgeSec: Params.BACKLOG_AGE,
      backlogMax: Params.BACKLOG_MAX,
      backlogAlertTtl: Params.BACKLOG_ALERT_TTL,
      // filled after deploy with each vault's configHash(); empty means drift is not checked yet
      expectedConfigHash: {},
      opsEoas: Object.values(opsEoas)
        .flat()
        .map((e) => ({ address: e.address, gasBudgetWei: (2n * 10n ** 15n).toString() })),
      cusum: { baselines: [bl?.tokens.qUSD ?? flat, bl?.tokens.qETH ?? flat], k: 500, h: 5000 },
    },
    schedule: '0 * * * * *',
    quorumLens: d.quorumLens,
    anchorLag: Params.ANCHOR_LAG,
    windowBlocks: 90,
    enablePing: true,
    enableDecoys: true,
    // docs/36 6.4 verify-edge (patrol trigger 5). Multicall3 is at the same address on Base and Ethereum Sepolia;
    // the plain anvil devnet has none, so verify-edge stays off there. authorizedKeys: a DON deployment needs at least
    // one (CRE refuses an HTTP trigger without one): the addresses that sign Trek's requests, from VERIFY_EDGE_SIGNERS.
    ...(d.chainId === 31337
      ? {}
      : {
          verifyEdge: {
            threatRegistry: d.threatRegistry,
            multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
            maxEdges: 12,
            derivedTtl: 24 * 3600,
            minAmounts: ['1000000', (10n ** 15n).toString()], // 1 qUSD, 0.001 qETH (same order as tokens)
            authorizedKeys: (process.env.VERIFY_EDGE_SIGNERS ?? '')
              .split(',')
              .map((x) => x.trim())
              .filter((x) => /^0x[0-9a-fA-F]{40}$/.test(x))
              .map((publicKey) => ({ type: 'KEY_TYPE_ECDSA_EVM' as const, publicKey })),
          },
        }),
  })
}

// Multi-angle judgement of one attack window (docs/49 section 8). Pure: input is indexed chain events, output is
// one entry per independent angle. Nothing is assumed: an angle with no data says "na" and why, and the
// second source is never shown as agreeing when it could not look (CLAUDE.md rule 8).

export type Ev = {
  block: number
  time: number
  tx: string
  contract: string
  org: string | null
  event: string
  args: Record<string, unknown>
}
export type Angle = {
  key: 'cre' | 'nownodes' | 'flow' | 'assets' | 'network'
  title: string
  status: 'flag' | 'clear' | 'na'
  summary: string
  source: string
  tx?: string
  block?: number
}
export type Env = { fork: boolean; chainId: number; orgCount: number; cusumH: bigint }

const ALERT = ['Normal', 'L1', 'L2', 'L3', 'CONFIRMED']
const big = (v: unknown) => {
  try {
    return BigInt(String(v ?? 0))
  } catch {
    return 0n
  }
}

/** window: events from the attack's start block on; before: earlier AssetCheckpoint events (the baseline). */
export function judge(org: string, window: Ev[], before: Ev[], env: Env) {
  const measured = env.fork ? 'testnet fork, measured' : 'Base Sepolia, measured'
  const mine = window.filter((e) => e.org === org)
  const angles: Angle[] = []

  // 1. decoy tripwire: the CRE trap report and what the receiver did with it
  const acts = mine.filter((e) => ['AlertSet', 'FreezeSet', 'QuotaZeroed', 'Swept', 'ThreatAdded'].includes(e.event))
  const alert = mine.filter((e) => e.event === 'AlertSet').map((e) => Number(big(e.args.level)))
  const shared = mine.find((e) => e.event === 'ThreatAdded')
  const tripped = shared !== undefined || alert.some((l) => l >= 3)
  const parts = [
    alert.length ? `alert ${ALERT[Math.max(...alert)] ?? Math.max(...alert)}` : '',
    mine.some((e) => e.event === 'FreezeSet') ? 'vault frozen' : '',
    mine.some((e) => e.event === 'QuotaZeroed') ? 'hot quota 0' : '',
    mine.some((e) => e.event === 'Swept') ? 'swept to cold' : '',
    shared ? 'threat shared' : '',
  ].filter(Boolean)
  angles.push({
    key: 'cre',
    title: 'Decoy tripwire (CRE)',
    status: tripped ? 'flag' : 'clear',
    summary: tripped ? `CRE report applied on chain: ${parts.join(', ')}` : 'No trap report in this window',
    source: `CRE workflow report, ${measured}`,
    ...(acts[0] ? { tx: acts[0].tx, block: acts[0].block } : {}),
  })

  // 2. second source: a public node can only vouch for transactions that exist on a public chain
  angles.push({
    key: 'nownodes',
    title: 'Second source (NOWNodes)',
    status: 'na',
    summary: env.fork
      ? 'Local fork: the transaction exists only on this machine, a public node cannot see it'
      : `No NOWNodes access for chain ${env.chainId} on the current key; the trap acts on the CRE receipt`,
    source: env.fork ? 'not applicable to a local fork' : 'NOWNodes account setting',
  })

  // 3. flow anomaly: Patrol CUSUM on the org's hot-vault outflow
  const cusum = mine.filter((e) => e.event === 'PatrolStateUpdated')
  if (!cusum.length) {
    angles.push({
      key: 'flow',
      title: 'Flow anomaly (Patrol CUSUM)',
      status: 'na',
      summary: 'No Patrol checkpoint in this window yet',
      source: `PatrolStateUpdated, ${measured}`,
    })
  } else {
    const maxS = cusum.reduce((m, e) => (big(e.args.S) > m ? big(e.args.S) : m), 0n)
    const alarm = cusum.find((e) => e.args.alarm === true || e.args.alarm === 'true')
    const last = alarm ?? cusum[cusum.length - 1]!
    angles.push({
      key: 'flow',
      title: 'Flow anomaly (Patrol CUSUM)',
      status: alarm ? 'flag' : 'clear',
      summary: alarm
        ? `CUSUM alarm: S ${maxS} reached h ${env.cusumH}`
        : `Outflow normal: S max ${maxS} of h ${env.cusumH} over ${cusum.length} checkpoints`,
      source: `PatrolStateUpdated, ${measured}; h is the Patrol default (assumed)`,
      tx: last.tx,
      block: last.block,
    })
  }

  // 4. asset conservation: org assets per token at the latest checkpoint vs the last one before the window
  const now = new Map<string, Ev>()
  const base = new Map<string, Ev>()
  for (const e of mine.filter((x) => x.event === 'AssetCheckpoint')) now.set(String(e.args.token).toLowerCase(), e)
  for (const e of before.filter((x) => x.org === org && x.event === 'AssetCheckpoint'))
    base.set(String(e.args.token).toLowerCase(), e)
  const deltas = [...now.entries()]
    .filter(([t]) => base.has(t))
    .map(([t, e]) => big(e.args.assetValue) - big(base.get(t)!.args.assetValue))
  if (!deltas.length) {
    angles.push({
      key: 'assets',
      title: 'Asset conservation (Patrol)',
      status: 'na',
      summary: 'No asset checkpoint on both sides of the attack yet',
      source: `AssetCheckpoint, ${measured}`,
    })
  } else {
    const down = deltas.filter((d) => d < 0n).length
    const last = [...now.values()].sort((a, b) => b.block - a.block)[0]!
    angles.push({
      key: 'assets',
      title: 'Asset conservation (Patrol)',
      status: down ? 'flag' : 'clear',
      summary: down
        ? `Assets fell on ${down} of ${deltas.length} tokens since the attack began`
        : `Assets held on all ${deltas.length} tokens: nothing left the vaults`,
      source: `AssetCheckpoint, ${measured}`,
      tx: last.tx,
      block: last.block,
    })
  }

  // 5. network: the attacker is now on the shared registry, so every other exchange's Cosign blocks it
  const threats = window.filter((e) => e.event === 'ThreatAdded')
  angles.push({
    key: 'network',
    title: 'Cross-exchange (ThreatRegistry)',
    status: threats.length ? 'flag' : 'clear',
    summary: threats.length
      ? `Attacker listed ${threats.length === 1 ? 'once' : `${threats.length} times`}; ${
          env.orgCount === 2 ? 'the other exchange rejects' : `the other ${env.orgCount - 1} exchanges reject`
        } it at Cosign gate 4`
      : 'Nothing new on the shared registry',
    source: `ThreatAdded, ${measured}`,
    ...(threats[0] ? { tx: threats[0].tx, block: threats[0].block } : {}),
  })

  const applicable = angles.filter((a) => a.status !== 'na').length
  const flagged = angles.filter((a) => a.status === 'flag').length
  return {
    org,
    angles,
    flagged,
    applicable,
    verdict: `${flagged} of ${applicable} independent angles flag this attack`,
  }
}

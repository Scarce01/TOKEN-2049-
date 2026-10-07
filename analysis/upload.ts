// Writes offline analysis results to quorum_index.metrics (source = assumed) and datasets.sim_runs.
// Decoy labels never leave the machine; only aggregate AUC numbers are written.
// Usage: DATABASE_URL=... bun analysis/upload.ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

const out = join(import.meta.dir, 'out')
const read = (n: string) => (existsSync(join(out, n)) ? JSON.parse(readFileSync(join(out, n), 'utf8')) : null)
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL not set')
const sql = postgres(url, { max: 1, onnotice: () => {} })
const runId = `offline-${new Date().toISOString().slice(0, 10)}`

type M = { name: string; value: number; unit?: string; notes: string }
const metrics: M[] = []

const hp = read('hit_probability.json')
if (hp) {
  metrics.push({
    name: 'decoy_hit_probability_m200_d10_k20',
    value: hp.formula,
    unit: 'probability',
    notes: 'formula, proposal 6 A',
  })
  metrics.push({
    name: 'decoy_hit_probability_mc_diff_pp',
    value: hp.abs_diff_pp,
    unit: 'pp',
    notes: `vs ${hp.runs} Monte Carlo runs (D39)`,
  })
}
const adv = read('adversary_sim.json')
if (adv) {
  for (const r of adv) {
    metrics.push({
      name: `adversary_s${r.strategy}_hit_rate_k${r.k}`,
      value: r.hit_rate,
      unit: 'probability',
      notes: `${r.runs} runs, synthetic population`,
    })
    if (r.mean_probes_before_first_hit)
      metrics.push({
        name: `adversary_s${r.strategy}_probes_to_first_hit`,
        value: r.mean_probes_before_first_hit,
        unit: 'probes',
        notes: 'mean over hits',
      })
    await sql`insert into datasets.sim_runs (strategy, params, result) values (${`s${r.strategy}`}, ${sql.json({ runs: r.runs, k: r.k })}, ${sql.json(r)})`
  }
}
for (const top of ['60', 'all']) {
  const auc = read(`decoy_auc_a_${top}.json`)
  if (auc) {
    metrics.push({
      name: `decoy_auc_logistic_top${top}`,
      value: auc.logistic.auc,
      unit: 'AUC',
      notes: 'synthetic accounts, 5-fold CV',
    })
    metrics.push({
      name: `decoy_auc_upper_bound_top${top}`,
      value: auc.auc_upper_bound,
      unit: 'AUC',
      notes: 'bootstrap 95% upper, target <= 0.65',
    })
  }
}
for (const m of metrics) {
  await sql`insert into quorum_index.metrics (run_id, name, value, unit, source, notes)
            values (${runId}, ${m.name}, ${m.value}, ${m.unit ?? null}, 'assumed', ${m.notes})`
}
await sql.end()
console.log(`wrote ${metrics.length} metrics (source assumed) and ${adv?.length ?? 0} sim_runs`)

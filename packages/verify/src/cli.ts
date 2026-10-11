#!/usr/bin/env bun
// pnpm verify:design [--phase N|all] [--env local|testnet|aws]
// Writes reports/design-conformance.md and .json (40_verification.md section 5).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from '@quorum/shared/deployments'
import { ITEMS, itemStatus, mkCtx, type SubResult } from './registry'
import { ITEMS_P456 } from './registry-p456'

const flag = (k: string) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const phaseArg = flag('phase')
const phase = phaseArg === undefined || phaseArg === 'all' ? undefined : Number(phaseArg)
if (phase !== undefined && !Number.isInteger(phase)) throw new Error(`--phase must be a number or all, got ${phaseArg}`)
const env = flag('env') ?? 'local'
const ctx = mkCtx(env)

const rows: { id: string; title: string; phases: number[]; status: string; subs: SubResult[]; gating: boolean }[] = []
// later entries replace earlier ones with the same D id
const merged = new Map(ITEMS.map((i) => [i.id, i]))
for (const i of ITEMS_P456) merged.set(i.id, i)
for (const it of [...merged.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))) {
  const subs = it.checks.flatMap((c) => {
    const r = c(ctx)
    return Array.isArray(r) ? r : [r]
  })
  // An item gates this run when it belongs to the requested phase or an earlier one.
  const gating = phase === undefined ? true : it.phases.some((p) => p <= phase)
  rows.push({ id: it.id, title: it.title, phases: it.phases, status: itemStatus(subs), subs, gating })
}

// Every D item in 40_verification.md must be registered; an unregistered one fails (rule 10).
const doc = readFileSync(join(repoRoot, 'docs', '40_verification.md'), 'utf8')
for (const m of doc.matchAll(/^\| (D\d+(?:\.\d+)?) \| ([^|]+)\|.*\| ([^|]*) \|\s*$/gm)) {
  if (merged.has(m[1]!)) continue
  const phases = [...m[3]!.matchAll(/\d+/g)].map((x) => Number(x[0]))
  const gating = phase === undefined ? true : phases.some((p) => p <= phase)
  const subs: SubResult[] = [
    { type: 'REG', name: 'registered', status: 'fail', evidence: 'not registered in packages/verify' },
  ]
  rows.push({ id: m[1]!, title: m[2]!.trim(), phases, status: 'fail', subs, gating })
}
rows.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))

const gatingRows = rows.filter((r) => r.gating)
const failed = gatingRows.filter((r) => r.status === 'fail')
const notYet = gatingRows.filter((r) => r.status === 'not-yet')

let md = `# Design conformance report\n\n- Generated: ${new Date().toISOString()}\n- Phase: ${phase ?? 'all'}\n- Env: ${env}\n`
md += `- Gating items: ${gatingRows.length}, pass ${gatingRows.filter((r) => r.status === 'pass').length}, fail ${failed.length}, not-yet ${notYet.length}, waived ${gatingRows.filter((r) => r.status === 'waived').length}\n\n`
md += '| D | Requirement | Phases | Status | Evidence |\n| --- | --- | --- | --- | --- |\n'
for (const r of rows) {
  const ev = r.subs.map((s) => `${s.type} ${s.name}: ${s.status} (${s.evidence})`).join('<br>')
  md += `| ${r.id} | ${r.title} | ${r.phases.join(', ')} | ${r.status}${r.gating ? '' : ' (later phase)'} | ${ev.replace(/\|/g, '/')} |\n`
}
mkdirSync(join(repoRoot, 'reports'), { recursive: true })
writeFileSync(join(repoRoot, 'reports', 'design-conformance.md'), md)
writeFileSync(
  join(repoRoot, 'reports', 'design-conformance.json'),
  `${JSON.stringify({ phase, env, rows }, null, 2)}\n`,
)

for (const r of rows)
  console.log(`${r.status.padEnd(8)} ${r.id.padEnd(10)} ${r.title}${r.gating ? '' : '  (later phase)'}`)
console.log(`\nfail ${failed.length}, not-yet ${notYet.length} (gating). Report: reports/design-conformance.md`)
process.exit(failed.length > 0 ? 1 : 0)

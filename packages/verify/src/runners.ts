// Runs each test suite once and exposes pass/fail by test name.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from '@quorum/shared/deployments'

export type Outcome = 'pass' | 'fail' | 'missing'
export type Suite = { ran: boolean; error?: string; get(name: string): Outcome }

function suite(results: Map<string, boolean>, ran: boolean, error?: string): Suite {
  return {
    ran,
    error,
    get(name) {
      // match by exact or suffix (forge: "test/X.t.sol:Contract.test_name", bun: "describe > name")
      for (const [k, v] of results)
        if (k === name || k.endsWith(`.${name}`) || k.endsWith(` > ${name}`) || k.endsWith(name))
          return v ? 'pass' : 'fail'
      return 'missing'
    },
  }
}

export function forge(): Suite {
  const p = Bun.spawnSync(['forge', 'test', '--json'], {
    cwd: join(repoRoot, 'contracts'),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const text = p.stdout.toString()
  const results = new Map<string, boolean>()
  try {
    const j = JSON.parse(text.slice(text.indexOf('{'))) as Record<
      string,
      { test_results: Record<string, { status: string }> }
    >
    for (const [contract, s] of Object.entries(j)) {
      const cname = contract.split(':').pop()
      for (const [t, r] of Object.entries(s.test_results))
        results.set(`${cname}.${t.replace(/\(.*\)$/, '')}`, r.status === 'Success')
    }
    // forge --json reports one entry per invariant suite; read invariant results from text output
    const inv = Bun.spawnSync(['forge', 'test', '--match-test', 'invariant_'], {
      cwd: join(repoRoot, 'contracts'),
      stdout: 'pipe',
    }).stdout.toString()
    for (const m of inv.matchAll(/\[(PASS|FAIL)[^\]]*\]\s+(invariant_\w+)/g))
      results.set(`InvariantsTest.${m[2]}`, m[1] === 'PASS')
    return suite(results, true)
  } catch (e) {
    return suite(results, false, `forge output unreadable: ${String(e).slice(0, 120)}`)
  }
}

/** bun test with a JUnit report; names are "file > describe > test". */
export function bunTests(cwd: string, args: string[] = []): Suite {
  const report = join(cwd, '.verify-junit.xml')
  const p = Bun.spawnSync(['bun', 'test', ...args, '--reporter=junit', `--reporter-outfile=${report}`], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  })
  const results = new Map<string, boolean>()
  if (!existsSync(report)) return suite(results, false, p.stderr.toString().slice(0, 200))
  const xml = readFileSync(report, 'utf8')
  const re = /<testcase name="([^"]+)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const name = m[1]!
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
    const body = m[3] ?? ''
    results.set(name, !/<failure|<error/.test(body))
  }
  return suite(results, true)
}

export const paths = {
  workflows: join(repoRoot, 'workflows'),
  shared: join(repoRoot, 'packages', 'shared'),
  verify: join(repoRoot, 'packages', 'verify'),
  trapSync: join(repoRoot, 'services', 'trap-sync'),
  simRunner: join(repoRoot, 'services', 'sim-runner'),
  keeper: join(repoRoot, 'services', 'keeper'),
  notifier: join(repoRoot, 'services', 'notifier'),
}

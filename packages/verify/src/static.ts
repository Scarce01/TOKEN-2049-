// ST checks: access manifest, bytecode scan, workflow lint, forbidden limits flags, backend imports.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { repoRoot } from '@quorum/shared/deployments'

/** notYet: the check could not run on this machine (reported as not-yet, never as pass). */
export type Result = { ok: boolean; evidence: string; notYet?: boolean }
const out = join(repoRoot, 'contracts', 'out')

function abiOf(c: string) {
  return JSON.parse(readFileSync(join(out, `${c}.sol`, `${c}.json`), 'utf8'))
}

/** D20: actual non-view functions == manifest, contract by contract. */
export function accessManifest(): Result {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'verify', 'access_manifest.json'), 'utf8')) as Record<
    string,
    Record<string, string>
  >
  const problems: string[] = []
  for (const [c, fns] of Object.entries(manifest)) {
    if (c.startsWith('_')) continue
    const actual = (
      abiOf(c).abi as { type: string; name: string; stateMutability: string; inputs: { type: string }[] }[]
    )
      .filter((x) => x.type === 'function' && x.stateMutability !== 'view' && x.stateMutability !== 'pure')
      .map((x) => `${x.name}(${x.inputs.map((i) => i.type).join(',')})`)
    for (const f of actual) if (!(f in fns)) problems.push(`${c}.${f} not in manifest`)
    for (const f of Object.keys(fns)) if (!actual.includes(f)) problems.push(`${c}.${f} in manifest but gone`)
  }
  return {
    ok: problems.length === 0,
    evidence: problems.length ? problems.join('; ') : 'manifest matches every non-view function',
  }
}

/** D12 static part: ThreatRegistry has no remove/block/delete style function. */
export function threatRegistryNoRemove(): Result {
  const names = (abiOf('ThreatRegistry').abi as { type: string; name: string }[])
    .filter((x) => x.type === 'function')
    .map((x) => x.name)
  const bad = names.filter((n) => /remove|delete|block|ban|clear|unset/i.test(n))
  return { ok: bad.length === 0, evidence: bad.length ? `found ${bad.join(',')}` : `functions: ${names.join(', ')}` }
}

/**
 * D17: disassemble deployed bytecode, skip PUSH data and the trailing CBOR metadata, look for
 * DELEGATECALL (f4), SELFDESTRUCT (ff), CALLCODE (f2).
 */
export function scanOpcodes(hex: string): string[] {
  const code = Buffer.from(hex.replace(/^0x/, ''), 'hex')
  // CBOR metadata: last 2 bytes are its length
  const metaLen = code.length >= 2 ? code.readUInt16BE(code.length - 2) + 2 : 0
  let end = metaLen > 0 && metaLen < code.length ? code.length - metaLen : code.length
  // solc ends executable code with INVALID (0xfe); via-IR then appends 32-byte constants before
  // the metadata. The data region starts at the earliest top-level 0xfe whose tail is whole words.
  for (let i = 0; i < end; i++) {
    const op = code[i]!
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f
    else if (op === 0xfe && (end - i - 1) % 32 === 0 && end - i - 1 <= 32 * 32) {
      end = i
      break
    }
  }
  const found: string[] = []
  for (let i = 0; i < end; i++) {
    const op = code[i]!
    if (op >= 0x60 && op <= 0x7f) {
      i += op - 0x5f
      continue
    }
    if (op === 0xf4) found.push(`DELEGATECALL@${i}`)
    if (op === 0xff) found.push(`SELFDESTRUCT@${i}`)
    if (op === 0xf2) found.push(`CALLCODE@${i}`)
  }
  return found
}

export function bytecodeScan(): Result {
  const targets = [
    'QuorumVault',
    'ColdVault',
    'QuorumReceiver',
    'RequestBoard',
    'DepositVault',
    'KeyRegistry',
    'ThreatRegistry',
    'ConfigTimelock',
    'DecoyCommit',
    'PatrolState',
  ]
  const problems: string[] = []
  for (const c of targets) {
    const hits = scanOpcodes(abiOf(c).deployedBytecode.object)
    if (hits.length) problems.push(`${c}: ${hits.slice(0, 3).join(',')}`)
  }
  return {
    ok: problems.length === 0,
    evidence: problems.length ? problems.join('; ') : `no f4/ff/f2 in ${targets.join(', ')}`,
  }
}

function walk(dir: string, filter: (p: string) => boolean, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.next' || n === 'out' || n === 'lib' || n.startsWith('.')) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, filter, acc)
    else if (filter(p)) acc.push(p)
  }
  return acc
}

const BANNED: [RegExp, string][] = [
  [/\bDate\.now\s*\(/, 'Date.now'],
  [/\bnew Date\s*\(/, 'new Date'],
  [/node:crypto|from ['"]crypto['"]/, 'node:crypto'],
  [/\bfetch\s*\(/, 'fetch'],
  [/process\.env/, 'process.env'],
  [/Promise\.race|Promise\.any/, 'Promise.race/any'],
  [/\bparseFloat\s*\(|Math\.random\s*\(/, 'float/random'],
  [/from ['"]ethers['"]/, 'ethers'],
]

/** D30 lint: workflow code (and the shared code it imports) avoids non-deterministic APIs; reads pin a block. */
export function workflowLint(): Result {
  const files = [
    ...walk(join(repoRoot, 'workflows'), (p) => p.endsWith('.ts') && !p.includes(`${'test'}`) && !p.endsWith('.d.ts')),
    ...['constants', 'ids', 'eip712', 'report', 'seal', 'ring'].map((n) =>
      join(repoRoot, 'packages', 'shared', 'src', `${n}.ts`),
    ),
  ]
  const problems: string[] = []
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return
      for (const [re, name] of BANNED) if (re.test(line)) problems.push(`${relative(repoRoot, f)}:${i + 1} ${name}`)
      // every callContract / headerByNumber names a block (the anchor-latest read is the one allowed exception)
      if (/\.(callContract|headerByNumber|balanceAt)\(/.test(line)) {
        const window = lines.slice(Math.max(0, i - 1), i + 4).join(' ')
        if (!/blockNumber\s*:/.test(window) && !/lint-allow:/.test(lines[i - 1] ?? '')) {
          problems.push(`${relative(repoRoot, f)}:${i + 1} EVM read without explicit block`)
        }
      }
    })
  }
  return {
    ok: problems.length === 0,
    evidence: problems.length ? problems.slice(0, 8).join('; ') : `${files.length} files clean`,
  }
}

/** D30: nobody turns production limits off when measuring. */
export function noLimitsNone(): Result {
  const files = walk(
    repoRoot,
    (p) =>
      /\.(ts|sh|json|ya?ml|md)$/.test(p) && !p.includes(`${'docs'}`) && !p.includes('verify') && !p.includes('reports'),
  )
  const hits = files.filter((f) => /--limits\s+none|"limits"\s*:\s*"none"/.test(readFileSync(f, 'utf8')))
  return {
    ok: hits.length === 0,
    evidence: hits.length ? hits.map((h) => relative(repoRoot, h)).join(', ') : 'no --limits none anywhere',
  }
}

/** D01 static + D34: exchange-api imports no seal/unseal, no decoy data, no Quorum decision logic. */
export function backendIsolation(): Result {
  const files = walk(join(repoRoot, 'apps', 'exchange-api', 'src'), (p) => p.endsWith('.ts'))
  const problems: string[] = []
  for (const f of files) {
    const s = readFileSync(f, 'utf8')
    if (/\b(unseal|seal|decoyTag|unpackTags)\b/.test(s))
      problems.push(`${relative(repoRoot, f)} uses seal/decoy helpers`)
    if (/quorum_index|decoys\.local|workflows\//.test(s))
      problems.push(`${relative(repoRoot, f)} references Quorum-side data`)
  }
  const wf = walk(join(repoRoot, 'workflows'), (p) => p.endsWith('.ts'))
  for (const f of wf) {
    const s = readFileSync(f, 'utf8')
    const code = s
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*)/.test(l))
      .join('\n')
    if (/exchange-api|supabase|postgres/i.test(code))
      problems.push(`${relative(repoRoot, f)} references the backend or the database`)
  }
  return {
    ok: problems.length === 0,
    evidence: problems.length ? problems.join('; ') : 'exchange-api and workflows are isolated',
  }
}

/**
 * D29 BUNDLE: no decoy address, userIdHash or label in built frontends, the backend, any tracked file or
 * any commit in git history; no DB secret in bundles or the backend. Without the local decoy list it is
 * not-yet (it cannot check), never pass.
 */
export function bundleScan(): Result {
  let needles: string[] = []
  const labels: string[] = []
  try {
    const f = JSON.parse(readFileSync(join(repoRoot, 'secrets', 'decoys.local.json'), 'utf8')) as Record<
      string,
      {
        accounts: { userIdHash?: string }[]
        wallets: { address: string; label?: string }[]
        addresses: { address: string; label?: string }[]
      }
    >
    for (const o of Object.values(f)) {
      for (const a of o.accounts) if (a.userIdHash) needles.push(a.userIdHash.toLowerCase().slice(2))
      for (const w of [...o.wallets, ...o.addresses]) {
        needles.push(w.address.toLowerCase().slice(2))
        if (w.label) labels.push(w.label.toLowerCase())
      }
    }
  } catch {
    return { ok: false, notYet: true, evidence: 'no secrets/decoys.local.json on this machine; scan not run' }
  }
  needles = needles.filter(Boolean)
  if (needles.length === 0)
    return { ok: false, notYet: true, evidence: 'decoy list is empty (run decoy-admin first); scan not run' }
  // actual secret values from the environment (never the public key prefixes libraries mention)
  const secrets = [process.env.SUPABASE_SECRET_KEY, process.env.CONSOLE_DATABASE_URL, process.env.SUPABASE_DB_URL]
    .filter((x): x is string => !!x && x.length > 12)
    .map((x) => x.toLowerCase())
  const roots = [
    join(repoRoot, 'apps', 'console', '.next', 'static'),
    join(repoRoot, 'apps', 'user-app', '.next', 'static'),
    join(repoRoot, 'apps', 'exchange-api', 'src'),
  ]
  const hits: string[] = []
  for (const r of roots) {
    let files: string[] = []
    try {
      files = walk(r, () => true)
    } catch {
      continue
    }
    for (const f of files) {
      const s = readFileSync(f, 'utf8').toLowerCase()
      for (const n of [...needles, ...labels])
        if (s.includes(n)) hits.push(`${relative(repoRoot, f)} contains a decoy identifier`)
      for (const sec of secrets) if (s.includes(sec)) hits.push(`${relative(repoRoot, f)} contains a server secret`)
    }
  }
  // Every tracked file and every commit ever made (a decoy that was committed once stays readable).
  const git = (args: string[]) =>
    Bun.spawnSync(['git', ...args], { cwd: repoRoot, stdout: 'pipe', stderr: 'pipe' })
      .stdout.toString()
      .toLowerCase()
  const tracked = git(['grep', '-I', '-n', '-i', '-F', ...[...needles, ...labels].flatMap((n) => ['-e', n])])
  for (const line of tracked.split('\n').filter(Boolean).slice(0, 5))
    hits.push(`tracked file ${line.split(':')[0]} contains a decoy identifier`)
  const history = git(['log', '--all', '-p', '--no-color', '--no-ext-diff'])
  for (const n of [...needles, ...labels]) if (history.includes(n)) hits.push('git history contains a decoy identifier')
  return {
    ok: hits.length === 0,
    evidence: hits.length
      ? [...new Set(hits)].slice(0, 5).join('; ')
      : `${needles.length} decoy identifiers and ${labels.length} labels, none in bundles, backend, tracked files or git history`,
  }
}

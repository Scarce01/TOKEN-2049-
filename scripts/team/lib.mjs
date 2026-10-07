// Shared helpers for the team scripts. Only needs node and the gh CLI.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

process.on('uncaughtException', (e) => {
  console.error(`error: ${e.message}`)
  process.exit(2)
})

export const team = JSON.parse(readFileSync(new URL('../../.github/team.json', import.meta.url), 'utf8'))
export const repo = process.env.GITHUB_REPOSITORY ?? 'Scarce01/TOKEN-2049-beta'

export const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
export const lines = (s) => s.split('\n').filter(Boolean)
export const gh = (args) => JSON.parse(sh('gh', args) || 'null')

export const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
export const has = (name) => process.argv.includes(`--${name}`)

export const interfaceFiles = (files) => files.filter((f) => team.interfaces.some((p) => f.startsWith(p)))

// "contracts", "apps/console", "services/indexer": a short area name for display.
export const areaOf = (f) => {
  const [a, b] = f.split('/')
  return ['apps', 'services', 'packages'].includes(a) && b ? `${a}/${b}` : a
}
export const areasOf = (files) => [...new Set(files.map(areaOf))].sort()

export const me = () => {
  if (flag('me')) return flag('me')
  try {
    return sh('gh', ['api', 'user', '-q', '.login'])
  } catch {
    throw new Error('not logged in to gh: run `gh auth login`')
  }
}

export const ensureLabel = (name, color, description) => {
  try {
    sh('gh', ['label', 'create', name, '--repo', repo, '--color', color, '--description', description])
  } catch {} // already exists
}

export const areasLabel = (files, max = 4) => {
  const a = areasOf(files)
  return a.length > max ? `${a.slice(0, max).join('、')} 等 ${a.length} 处` : a.join('、')
}

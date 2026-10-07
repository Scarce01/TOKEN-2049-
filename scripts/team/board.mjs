// Central team board: one pinned GitHub issue (label "board") that is rewritten, never committed.
//   node scripts/team/board.mjs            print
//   node scripts/team/board.mjs --publish  update the issue (CI does this)
import { areasLabel, ensureLabel, gh, has, interfaceFiles, repo, sh, team } from './lib.mjs'

const list = (args) => gh(['pr', 'list', '--repo', repo, ...args]) ?? []
const open = list(['--state', 'open', '--json', 'number,title,author,files,isDraft,headRefName,headRefOid,updatedAt'])
const merged = list(['--state', 'merged', '--limit', '30', '--json', 'number,title,author,mergedAt,files'])
const since = Date.now() - 24 * 3600 * 1000
const recent = merged.filter((p) => Date.parse(p.mergedAt) > since)
const handoffs =
  gh(['issue', 'list', '--repo', repo, '--label', 'handoff', '--state', 'open', '--json', 'number,title,assignees']) ??
  []

// REST check-runs (needs only checks: read); the GraphQL statusCheckRollup needs more permissions.
const ci = (p) => {
  let c = []
  try {
    c =
      gh([
        'api',
        `repos/${repo}/commits/${p.headRefOid}/check-runs`,
        '--jq',
        '[.check_runs[] | {status, conclusion}]',
      ]) ?? []
  } catch {
    return 'CI 未知'
  }
  if (!c.length) return '无 CI'
  if (c.some((x) => x.conclusion === 'failure')) return 'CI 失败'
  if (c.some((x) => x.status !== 'completed')) return 'CI 进行中'
  return c.every((x) => ['success', 'skipped', 'neutral'].includes(x.conclusion)) ? 'CI 通过' : 'CI 失败'
}
const behind = (p) => {
  try {
    return gh(['api', `repos/${repo}/compare/main...${p.headRefName}`, '--jq', '.behind_by']) ?? 0
  } catch {
    return '?'
  }
}

const md = ['# 团队看板', `\n自动生成，请勿手改。最近更新：${new Date().toISOString().slice(0, 16)}Z`]

md.push(`\n## 待合并的 PR（${open.length}）`)
for (const p of open) {
  const files = p.files.map((f) => f.path)
  md.push(
    `- #${p.number} @${p.author.login}${p.isDraft ? '（草稿）' : ''}：${p.title}｜${ci(p)}｜落后 main ${behind(p)}｜${areasLabel(files) || '-'}${interfaceFiles(files).length ? '｜**改接口**' : ''}`,
  )
}
if (!open.length) md.push('- 无')

// Two open PRs editing the same file are a conflict waiting to happen.
const owners = new Map()
for (const p of open) for (const f of p.files) owners.set(f.path, [...(owners.get(f.path) ?? []), p])
const clashes = [...owners].filter(([, ps]) => ps.length > 1)
if (clashes.length) {
  md.push(`\n## 同一个文件被多个 PR 改（${clashes.length}）`)
  for (const [f, ps] of clashes) md.push(`- \`${f}\`：${ps.map((p) => `#${p.number} @${p.author.login}`).join('、')}`)
}

md.push(`\n## 过去 24 小时已合并（${recent.length}）`)
for (const p of recent) {
  const files = p.files.map((f) => f.path)
  md.push(`- #${p.number} @${p.author.login}：${p.title}${interfaceFiles(files).length ? '｜**改了接口**' : ''}`)
}
if (!recent.length) md.push('- 无')

md.push(`\n## 未处理的留言（${handoffs.length}）`)
for (const h of handoffs) {
  md.push(
    `- #${h.number} ${h.title}${h.assignees.length ? `｜@${h.assignees.map((a) => a.login).join(' @')}` : '｜所有人'}`,
  )
}
if (!handoffs.length) md.push('- 无')

md.push(`\n接口文件：${team.interfaces.map((f) => `\`${f}\``).join('、')}`)
const body = md.join('\n')

if (!has('publish')) {
  console.log(body)
} else {
  ensureLabel('board', '0e8a16', 'Auto-generated team board')
  const existing = gh(['issue', 'list', '--repo', repo, '--label', 'board', '--state', 'open', '--json', 'number'])?.[0]
  if (existing) sh('gh', ['issue', 'edit', String(existing.number), '--repo', repo, '--body', body])
  else sh('gh', ['issue', 'create', '--repo', repo, '--title', 'Team board', '--label', 'board', '--body', body])
  console.log('board updated')
}

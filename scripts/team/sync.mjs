// Run at the start of a session (human, Claude or GPT): what changed on main that touches what I am working on?
//   node scripts/team/sync.mjs
import { areasLabel, gh, interfaceFiles, lines, me, repo, sh, team } from './lib.mjs'

const user = me()
sh('git', ['fetch', '-q', 'origin', 'main'])
const head = sh('git', ['rev-parse', 'HEAD'])
const base = sh('git', ['merge-base', head, 'origin/main'])
const behind = Number(sh('git', ['rev-list', '--count', `${head}..origin/main`]))
const branch = sh('git', ['branch', '--show-current']) || '(detached)'

// Files I have changed: on my branch since it left main, plus uncommitted work.
const mine = new Set([
  ...lines(sh('git', ['diff', '--name-only', `${base}..${head}`])),
  ...lines(sh('git', ['diff', '--name-only', 'HEAD'])),
  ...lines(sh('git', ['ls-files', '--others', '--exclude-standard'])),
])

const out = [`# Sync：@${user}，分支 \`${branch}\`，已改 ${mine.size} 个文件`]

const commits = lines(sh('git', ['log', '--format=%h\t%an\t%s', `${base}..origin/main`]))
const rows = []
for (const c of commits) {
  const [sha, author, subject] = c.split('\t')
  const files = lines(sh('git', ['show', '--name-only', '--format=', sha]))
  const iface = interfaceFiles(files)
  const overlap = files.filter((f) => mine.has(f))
  rows.push({ sha, author, subject, iface, overlap })
}
const important = rows.filter((r) => r.iface.length || r.overlap.length)

out.push(
  behind === 0
    ? '\n**你的分支已包含 main 的全部提交。**'
    : `\n**你落后 main ${behind} 个提交**，其中 ${important.length} 个需要注意：`,
)
for (const r of important) {
  const tag = [
    r.overlap.length ? `和你改的文件重叠：${r.overlap.slice(0, 3).join(', ')}` : '',
    r.iface.length ? `接口变更：${r.iface.slice(0, 3).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('；')
  out.push(`- \`${r.sha}\` ${r.author}：${r.subject}（${tag}）`)
}
const others = rows.length - important.length
if (others > 0) out.push(`- 另有 ${others} 个提交与你无关`)
if (important.length) {
  out.push('\n要做：`git fetch && git rebase origin/main`，然后确认你的代码和上面的改动对得上。')
}

// Messages for me (assigned) and for everyone (unassigned).
const hs =
  gh([
    'issue',
    'list',
    '--repo',
    repo,
    '--label',
    'handoff',
    '--state',
    'open',
    '--json',
    'number,title,author,assignees',
  ]) ?? []
const forMe = hs.filter((h) => h.assignees.some((a) => a.login === user))
const forAll = hs.filter((h) => h.assignees.length === 0)
out.push(`\n## 发给你的留言（${forMe.length}）`)
for (const h of forMe) out.push(`- #${h.number} ${h.title}（来自 @${h.author.login}）`)
if (!forMe.length) out.push('- 无')
if (forAll.length) {
  out.push(`\n## 发给所有人的留言（${forAll.length}）`)
  for (const h of forAll) out.push(`- #${h.number} ${h.title}`)
}

// Other people's open PRs: flag overlap with my files.
const prs =
  gh(['pr', 'list', '--repo', repo, '--state', 'open', '--json', 'number,title,author,files,isDraft,headRefName']) ?? []
const theirs = prs.filter((p) => p.author.login !== user)
out.push(`\n## 别人打开的 PR（${theirs.length}）`)
for (const p of theirs) {
  const files = p.files.map((f) => f.path)
  const overlap = files.filter((f) => mine.has(f))
  out.push(
    `- #${p.number} @${p.author.login}${p.isDraft ? '（草稿）' : ''}：${p.title}｜${areasLabel(files) || '-'}${overlap.length ? `｜**和你重叠：${overlap.slice(0, 3).join(', ')}**` : ''}`,
  )
}
if (!theirs.length) out.push('- 无')

out.push(`\n接口文件：${team.interfaces.join(', ')}`)
const board = gh(['issue', 'list', '--repo', repo, '--label', 'board', '--state', 'open', '--json', 'url'])?.[0]
if (board) out.push(`团队看板：${board.url}`)
console.log(out.join('\n'))

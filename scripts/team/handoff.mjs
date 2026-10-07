// Leave a message for a teammate (or everyone); it shows up in their next sync.
//   node scripts/team/handoff.mjs --to <github-login|all> --title "..." --body "..." [--interface]
import { ensureLabel, flag, has, me, repo, sh } from './lib.mjs'

const to = flag('to')
const title = flag('title')
const body = flag('body') ?? ''
if (!to || !title) {
  console.error('usage: handoff.mjs --to <github-login|all> --title "..." [--body "..."] [--interface]')
  process.exit(2)
}
const from = me()

ensureLabel('handoff', '1d76db', 'Message from one teammate to another')
ensureLabel('interface', 'd93f0b', 'Asks for an interface change')

const everyone = to === 'all'
const text = `来自 @${from}${everyone ? '，发给所有人' : `，发给 @${to}`}\n\n${body}\n\n---\n处理完请在这里说明做了什么，然后关闭这个 issue。`
const url = sh('gh', [
  'issue',
  'create',
  '--repo',
  repo,
  '--title',
  `[${everyone ? 'all' : to}] ${title}`,
  '--body',
  text,
  '--label',
  'handoff',
  ...(has('interface') ? ['--label', 'interface'] : []),
  ...(everyone ? [] : ['--assignee', to]),
])
console.log(url)

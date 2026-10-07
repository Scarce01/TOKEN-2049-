---
name: sync
description: Start-of-session team sync. Shows what changed on main that touches the files you are working on, messages left for you by teammates, and other people's open PRs that overlap with yours. Run at the start of every session and before opening a PR.
---

Run `node scripts/team/sync.mjs` (needs `gh auth login`; it reads your GitHub login).

Then, in Chinese and briefly:
1. If behind main and any commit overlaps the user's files or changed an interface: tell the user to `git fetch && git rebase origin/main`, and name which of their files are affected (Grep; do not guess).
2. Read each message addressed to the user (`gh issue view <n>`), summarize what is asked, and propose a plan. Do not start work that changes an interface before `docs/10_interfaces.md` is updated first.
3. If another person's open PR overlaps the user's files, say who, so they can talk before conflicts pile up.

Do not modify anything during sync.

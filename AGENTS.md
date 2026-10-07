# Instructions for GPT / Codex agents

Same project and same rules as `CLAUDE.md`. Read that file first; it is the source of truth. This file only covers how your agent coordinates with the other four people and their agents. There are no fixed roles; each person just picks up an area.

## At the start of every session

```bash
git fetch && node scripts/team/sync.mjs
```

(needs `gh auth login`.) Summarize the result to the user in Chinese: what changed on main that touches their files, messages for them, other people's PRs that overlap. If an interface changed or files overlap, rebase before continuing: `git rebase origin/main`.

## When your work depends on someone else

Do not edit files someone else is changing. Find who (`gh pr list --json author,files`, `git log -5 -- <file>`), then send a message:

```bash
node scripts/team/handoff.mjs --to <github-login|all> --title "<short>" --body "<what, where, why>" [--interface]
```

Write it so the other agent understands without your context. It shows up in their next sync.

## Changing an interface

Interface files are listed under `interfaces` in `.github/team.json`. Order: update `docs/10_interfaces.md`, add a line to `docs/STATUS.md` (接口变更记录), change the code, regenerate the ABI (`forge build && pnpm abi && pnpm exec biome format --write packages/shared/src/abi.ts`), then send a message to everyone who consumes it.

## Before opening a PR

Never push to `main`. Work on a branch, rebase on `origin/main`, open a PR. CI and the review agents (alignment, security) comment on it.

The pinned issue labeled `board` ("Team board") shows everyone's open PRs, files that several PRs edit at once, and pending messages.

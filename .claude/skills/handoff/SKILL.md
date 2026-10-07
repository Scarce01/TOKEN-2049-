---
name: handoff
description: Leave a message or request for a teammate (or everyone), for example when your work needs a change in something they own, or you changed something they use. Creates a GitHub issue assigned to them; it appears in their next sync.
---

Use when your task depends on something someone else is changing, or you changed something they consume.

1. Find who: `gh pr list --json author,files` and `git log --format=%an -5 -- <file>` show who is working on or last touched it. If unclear, ask the user, or send to `all`.
2. Write the message so it stands alone: what you need, which file or symbol, why, and what you will do on your side. Their agent has none of your context.
3. If it changes an interface, update `docs/10_interfaces.md` first (or say you will), and add `--interface`.
4. Run: `node scripts/team/handoff.mjs --to <github-login|all> --title "<short>" --body "<details>" [--interface]`
5. Tell the user the issue URL. Do not edit someone else's in-progress files to work around the dependency.

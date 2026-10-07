// Builds the evidence page from demo/solana-history.json.
// Usage (repo root): bun solana/scripts/history.ts && bun solana/site/build.ts
//   -> solana/site/dist/index.html (full document, for any static host such as Vercel)
//   -> solana/site/dist/artifact.html (body only, for a claude.ai artifact)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const here = import.meta.dir
const root = join(here, '..', '..')
const data = readFileSync(join(root, 'demo', 'solana-history.json'), 'utf8').trim().replace(/</g, '\\u003c')
const page = readFileSync(join(here, 'page.html'), 'utf8').replace('__DATA__', data)
mkdirSync(join(here, 'dist'), { recursive: true })
writeFileSync(join(here, 'dist', 'artifact.html'), page)
writeFileSync(
  join(here, 'dist', 'index.html'),
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n${page}\n</body>\n</html>\n`,
)
console.log('solana/site/dist/index.html, solana/site/dist/artifact.html')

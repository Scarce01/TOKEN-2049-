// Pure parser for `cre workflow simulate` output (USER LOG lines, result, error lines).

export function parseCre(out: string): { logs: string[]; result?: string; errors: string[] } {
  const lines = out.split(/\r?\n/)
  const logs = lines.filter((l) => l.includes('[USER LOG]')).map((l) => l.slice(l.indexOf('[USER LOG]') + 11).trim())
  const at = lines.findIndex((l) => l.includes('Workflow Simulation Result'))
  const result = at >= 0 ? lines[at + 1]?.trim().replace(/^"|"$/g, '') : undefined
  const errors = lines.filter((l) => /\berror\b|failed|panic/i.test(l) && !l.includes('[USER LOG]')).slice(-6)
  return { logs, result, errors }
}

/** Report tx hashes from writeReport log lines (`<tag> report ok tx=0x...`), first occurrence order. */
export function reportTxs(logs: string[]): `0x${string}`[] {
  return [...new Set(logs.flatMap((l) => l.match(/report ok tx=(0x[0-9a-fA-F]{64})/)?.[1] ?? []))] as `0x${string}`[]
}

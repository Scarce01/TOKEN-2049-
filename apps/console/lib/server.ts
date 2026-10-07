// Server-only helpers: deployment, console_svc DB, officer verification.
import 'server-only'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Deployment } from '@quorum/shared/deployments'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

export function deployment(): Deployment {
  const name = process.env.DEPLOY_NAME ?? 'base-sepolia'
  return JSON.parse(readFileSync(join(process.cwd(), '..', '..', 'deployments', `${name}.json`), 'utf8'))
}

let _sql: ReturnType<typeof postgres> | undefined
export function sql() {
  if (!_sql) {
    const url = process.env.CONSOLE_DATABASE_URL
    if (!url) throw new Error('CONSOLE_DATABASE_URL not set')
    _sql = postgres(url, { max: 4, onnotice: () => {} })
  }
  return _sql
}

export type Officer = { id: string; email: string; claims: Record<string, unknown> }

/** Verifies the Supabase session token and the officer claim (app_metadata.role, set with the service key). */
export async function requireOfficer(req: Request): Promise<Officer | Response> {
  const token = req.headers.get('authorization')?.replace(/^Bearer /, '')
  if (!token) return new Response('unauthorized', { status: 401 })
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const { data, error } = await sb.auth.getUser(token)
  if (error || !data.user) return new Response('unauthorized', { status: 401 })
  if (data.user.app_metadata?.role !== 'officer') return new Response('forbidden', { status: 403 })
  const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'))
  return { id: data.user.id, email: data.user.email ?? '', claims }
}

export const json = (v: unknown, status = 200) =>
  new Response(
    JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  )

import postgres from 'postgres'
import { env, SCHEMA } from './env'

export const sql = postgres(env.databaseUrl, { max: 5, onnotice: () => {} })
export const T = (table: string) => sql(`${SCHEMA}.${table}`)

export async function audit(actor: string, action: string, payload: unknown) {
  await sql`insert into ${T('audit_log')} (actor, action, payload) values (${actor}, ${action}, ${sql.json(payload as never)})`
}

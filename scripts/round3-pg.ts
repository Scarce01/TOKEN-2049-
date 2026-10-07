#!/usr/bin/env bun
// Local Postgres for GET /admin/hot-wallets when Docker and the Supabase CLI are unavailable.
// PGlite speaks the Postgres wire protocol on 127.0.0.1:54329. Data stays in .tmp/.
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

const root = join(import.meta.dir, '..')
const dataDir = join(root, '.tmp', 'round3-pgdata')
mkdirSync(dataDir, { recursive: true })

const db = new PGlite(dataDir)
await db.exec(readFileSync(join(import.meta.dir, 'sql', 'exchange_hot_wallets.sql'), 'utf8'))

const server = new PGLiteSocketServer({
  db,
  port: 54329,
  host: '127.0.0.1',
  maxConnections: 20,
})
await server.start()
console.log('exchange db listening on 127.0.0.1:54329')
setInterval(() => {}, 1 << 30)

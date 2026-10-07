// Unified server for the Observatory app: ONE process that fronts the whole stack on ONE origin.
// It serves the built UI (dist/) and reverse-proxies every backend, and it starts each backend as a child
// process only if that port is not already up (so it never double-starts a running fork, bridge or decoygen).
//
//   Prerequisite (one-time, the shared fork): anvil fork on :8545, contracts deployed, fork-demo setup.ts run.
//   Then:   cd apps/observatory && pnpm build && bun serve.ts          # serves + proxies + starts app servers
//           PORT=8080 bun serve.ts                                      # pick a different port
//
// Routes (one origin):  /  -> built UI (dist)    /rpc -> anvil 8545    /bridge -> fork bridge 8790
//                       /decoygen -> decoygen 8791 (SSE ok)    /history -> indexer 42069 (time series, SSE ok)
// Backends it supervises (spawn if the port is free): PGlite 54329, exchange-api 8797, decoygen 8791, fork bridge 8790,
// indexer 42069 (Ponder on the fork, PGlite in services/indexer/.ponder; DEPLOY_NAME picks the deployment).
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..') // apps/observatory -> repo root
const DIST = join(import.meta.dir, 'dist')
const PORT = Number(process.env.PORT ?? 8443)
const BUN = process.execPath
// QUORUM_NET=public: the PROD deployment on public Base Sepolia. The DON runs Patrol, Trap and Cosign there, so the
// fork-only backends (exchange DB and API, decoygen, fork bridge) are not started; build with the same QUORUM_NET.
const PUBLIC = process.env.QUORUM_NET === 'public'
const RPC_UPSTREAM = PUBLIC ? 'https://sepolia.base.org' : 'http://127.0.0.1:8545'

const up = async (port: number) => {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD', signal: AbortSignal.timeout(400) })
    return true
  } catch {
    // a listening socket that rejects HEAD still throws a non-connection error; treat connect-refused as down
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(400) })
      return true
    } catch (e) {
      return !/ECONNREFUSED|Unable to connect|Failed to connect/i.test(String(e))
    }
  }
}

const children: { name: string; proc: ReturnType<typeof Bun.spawn> }[] = []
let shuttingDown = false
async function ensure(name: string, port: number, cmd: string[], opts: { cwd?: string; env?: Record<string, string>; respawn?: boolean } = {}) {
  if (await up(port)) {
    console.log(`[serve] ${name} already up on :${port}, reusing`)
    return
  }
  console.log(`[serve] starting ${name} on :${port}`)
  const spawn = () => {
    const proc = Bun.spawn(cmd, { cwd: opts.cwd ?? ROOT, env: { ...process.env, PORT: String(port), ...opts.env }, stdout: 'inherit', stderr: 'inherit' })
    children.push({ name, proc })
    // the indexer exits on purpose after a fork reset and must come back on a fresh database
    if (opts.respawn)
      proc.exited.then(() => {
        if (shuttingDown) return
        console.log(`[serve] ${name} exited, restarting`)
        setTimeout(spawn, 1000)
      })
  }
  spawn()
  for (let i = 0; i < 60; i++) {
    if (await up(port)) return
    await Bun.sleep(500)
  }
  console.warn(`[serve] ${name} did not come up on :${port} within 30s (continuing)`)
}

// one shared PATH so `cre` (the fork bridge) and its `bun`/`python` children resolve on Windows and POSIX
const BRIDGE_ENV = { PATROL_TICK_S: process.env.PATROL_TICK_S ?? '60' }

async function startBackends() {
  if (!PUBLIC) {
    await ensure('exchange-db (PGlite)', 54329, [BUN, 'scripts/round3-pg.ts'])
    await ensure('exchange-api', 8797, [BUN, '--env-file=apps/exchange-api/.env.fork', 'apps/exchange-api/src/index.ts'])
    await ensure('decoygen', 8791, ['python', 'analysis/decoygen/serve.py', '--org', 'a', '--tick', '30'])
    await ensure('fork bridge', 8790, [BUN, 'packages/offchain/scripts/fork-demo/bridge.ts'], { env: BRIDGE_ENV })
  }
  // Ponder runs on Node; a snapshot every block on the fork (blocks only exist when something happens there)
  await ensure('indexer', 42069, ['node', 'node_modules/ponder/dist/esm/bin/ponder.js', 'start', '--schema', 'ponder_quorum', '-H', '127.0.0.1'], {
    cwd: join(ROOT, 'services', 'indexer'),
    env: {
      DEPLOY_NAME: process.env.DEPLOY_NAME ?? (PUBLIC ? 'base-sepolia' : 'base-sepolia-fork'),
      PONDER_RPC_URL_1: process.env.PONDER_RPC_URL_1 ?? RPC_UPSTREAM,
      // public chain: a block every 2 s, so snapshot every 30 (about a minute)
      PONDER_SNAPSHOT_EVERY: process.env.PONDER_SNAPSHOT_EVERY ?? (PUBLIC ? '30' : '1'),
    },
    respawn: true,
  })
}

const CT: Record<string, string> = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon', woff2: 'font/woff2', map: 'application/json' }

/** Reverse-proxy to a local backend, streaming the response (so SSE passes through). */
async function proxy(req: Request, base: string, path: string): Promise<Response> {
  const search = new URL(req.url).search
  const headers = new Headers(req.headers)
  headers.delete('host') // a remote upstream (public RPC) must see its own host, not localhost
  const init: RequestInit & { duplex?: string } = { method: req.method, headers, redirect: 'manual' }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body
    init.duplex = 'half'
  }
  try {
    const r = await fetch(base + path + search, init)
    const h = new Headers(r.headers)
    h.delete('content-encoding')
    return new Response(r.body, { status: r.status, headers: h })
  } catch (e) {
    return new Response(JSON.stringify({ error: `backend unavailable: ${String(e)}` }), { status: 502, headers: { 'content-type': 'application/json' } })
  }
}

async function serveStatic(path: string): Promise<Response> {
  const rel = path === '/' ? 'index.html' : path.replace(/^\//, '')
  let file = Bun.file(join(DIST, rel))
  if (!(await file.exists())) file = Bun.file(join(DIST, 'index.html')) // SPA fallback
  const ext = rel.split('.').pop() ?? 'html'
  return new Response(file, { headers: { 'content-type': CT[ext] ?? 'application/octet-stream' } })
}

if (!existsSync(DIST)) {
  console.error(`[serve] no build at ${DIST}. Run: cd apps/observatory && pnpm build`)
  process.exit(1)
}

await startBackends()

const server = Bun.serve({
  port: PORT,
  idleTimeout: 0, // SSE + long patrol/attack polling
  async fetch(req) {
    const path = new URL(req.url).pathname
    if (path === '/rpc' || path.startsWith('/rpc/')) return proxy(req, RPC_UPSTREAM, path.replace(/^\/rpc/, '') || '/')
    if (path.startsWith('/bridge')) return proxy(req, 'http://127.0.0.1:8790', path.replace(/^\/bridge/, '') || '/')
    if (path.startsWith('/decoygen')) return proxy(req, 'http://127.0.0.1:8791', path)
    if (path.startsWith('/history')) return proxy(req, 'http://127.0.0.1:42069', path)
    return serveStatic(path)
  },
})
console.log(`[serve] Observatory on http://localhost:${server.port}  (${PUBLIC ? 'public Base Sepolia, DON' : 'fork'}; UI + /rpc + /bridge + /decoygen + /history on one origin)`)

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    shuttingDown = true
    console.log('\n[serve] shutting down; stopping child servers it started')
    for (const c of children) try { c.proc.kill() } catch {}
    process.exit(0)
  })
}

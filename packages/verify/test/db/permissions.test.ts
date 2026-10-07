// DB permission checks (31_phase1.md 1.2, D28 database part, D29 database part).
// Uses SET ROLE from the local superuser connection; privileges are identical to logging in as the role.
import { afterAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

const url = process.env.SUPABASE_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres'
const sql = postgres(url, { max: 1, onnotice: () => {} })

/** Runs `query` as `role` (optionally with JWT claims) inside a rolled-back transaction. */
async function as(role: string, query: string, claims?: object): Promise<'ok' | 'denied'> {
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`)
      if (claims) await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`
      await tx.unsafe(query)
      throw new Error('__rollback__')
    })
  } catch (e) {
    const msg = String((e as Error).message)
    if (msg === '__rollback__') return 'ok'
    if (/permission denied|row-level security|must be owner/i.test(msg)) return 'denied'
    throw e
  }
  return 'ok'
}

/** RLS hides rows rather than raising: count visible rows. */
async function visibleRows(role: string, table: string, claims?: object): Promise<number> {
  let n = -1
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`)
      if (claims) await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`
      const r = await tx.unsafe(`select count(*)::int as n from ${table}`)
      n = r[0]?.n as number
      throw new Error('__rollback__')
    })
  } catch (e) {
    if (String((e as Error).message) !== '__rollback__') return -1
  }
  return n
}

const OFFICER = { role: 'authenticated', app_metadata: { role: 'officer' } }
const USER = { role: 'authenticated', app_metadata: {} }

describe('setup', () => {
  test('a trap row exists for RLS checks', async () => {
    await sql`insert into quorum_index.traps (org_id, label, kind, chain, ref) values ('test', 'perm-test', 'address', 'base-sepolia', '0xperm') on conflict do nothing`
    expect(Number((await sql`select count(*) from quorum_index.traps`)[0]?.count)).toBeGreaterThan(0)
  })
})

describe('anon key (bundled in the Console frontend)', () => {
  for (const t of ['quorum_index.traps', 'quorum_index.metrics', 'quorum_index.officer_signatures']) {
    test(`anon cannot read ${t}`, async () => expect(await as('anon', `select * from ${t}`)).toBe('denied'))
  }
  test('anon cannot read exchange_a.users', async () =>
    expect(await as('anon', 'select * from exchange_a.users')).toBe('denied'))
  test('anon cannot use ponder_quorum', async () =>
    expect(await as('anon', 'create table ponder_quorum.x(i int)')).toBe('denied'))
})

describe('untrusted exchange roles', () => {
  test('exchange_a_app cannot read traps', async () =>
    expect(await as('exchange_a_app', 'select * from quorum_index.traps')).toBe('denied'))
  test('exchange_a_app cannot read datasets', async () =>
    expect(await as('exchange_a_app', 'select * from datasets.synthetic_accounts')).toBe('denied'))
  test('exchange_a_app cannot read exchange_b', async () =>
    expect(await as('exchange_a_app', 'select * from exchange_b.users')).toBe('denied'))
  test('exchange_a_app can use its own schema', async () =>
    expect(await as('exchange_a_app', 'select * from exchange_a.users')).toBe('ok'))
  test('exchange_b_app cannot read traps', async () =>
    expect(await as('exchange_b_app', 'select * from quorum_index.traps')).toBe('denied'))
})

describe('officers via Supabase Auth (RLS)', () => {
  test('logged-in non-officer sees no traps', async () =>
    expect(await visibleRows('authenticated', 'quorum_index.traps', USER)).toBe(0))
  test('officer sees traps', async () =>
    expect(await visibleRows('authenticated', 'quorum_index.traps', OFFICER)).toBeGreaterThan(0))
  test('officer can insert a signature; non-officer cannot', async () => {
    const q = `insert into quorum_index.officer_signatures (target_contract, action_kind, subject, value, nonce, deadline, officer, sig)
               values ('0x1', 2, '0x2', 0, 1, 1, '0x3', '0x4')`
    expect(await as('authenticated', q, OFFICER)).toBe('ok')
    expect(await as('authenticated', q, USER)).toBe('denied')
  })
  test('authenticated users cannot touch ponder_quorum', async () =>
    expect(await as('authenticated', 'create table ponder_quorum.y(i int)', OFFICER)).toBe('denied'))
})

describe('service roles', () => {
  test('ponder_svc cannot read traps', async () =>
    expect(await as('ponder_svc', 'select * from quorum_index.traps')).toBe('denied'))
  test('ponder_svc owns ponder_quorum', async () =>
    expect(await as('ponder_svc', 'create table ponder_quorum.probe(i int)')).toBe('ok'))
  test('console_svc cannot update traps', async () =>
    expect(await as('console_svc', "update quorum_index.traps set status = 'tripped'")).toBe('denied'))
  test('console_svc cannot write ponder_quorum', async () => {
    await sql.begin(async (tx) => {
      await tx.unsafe('set local role ponder_svc')
      await tx.unsafe('create table if not exists ponder_quorum.perm_probe(i int)')
    })
    expect(await as('console_svc', 'select * from ponder_quorum.perm_probe')).toBe('ok')
    expect(await as('console_svc', 'insert into ponder_quorum.perm_probe values (1)')).toBe('denied')
    expect(await as('console_svc', 'update ponder_quorum.perm_probe set i = 2')).toBe('denied')
    expect(await as('console_svc', 'delete from ponder_quorum.perm_probe')).toBe('denied')
    await sql.unsafe('drop table ponder_quorum.perm_probe')
  })
  // docs/47 3.5: the notifier may know where to deliver, never what is a decoy
  test('notifier_svc cannot read traps', async () =>
    expect(await as('notifier_svc', 'select * from quorum_index.traps')).toBe('denied'))
  test('notifier_svc can read notify_channels but not write them', async () => {
    expect(await as('notifier_svc', 'select * from quorum_index.notify_channels')).toBe('ok')
    expect(
      await as('notifier_svc', "insert into quorum_index.notify_channels (user_id_hash, url) values ('x', 'y')"),
    ).toBe('denied')
  })
  test('exchange_a_app and anon cannot read notify_channels', async () => {
    expect(await as('exchange_a_app', 'select * from quorum_index.notify_channels')).toBe('denied')
    expect(await as('anon', 'select * from quorum_index.notify_channels')).toBe('denied')
  })
  test('trap_sync_svc can update only status columns', async () => {
    expect(await as('trap_sync_svc', "update quorum_index.traps set status = 'tripped', last_checked = now()")).toBe(
      'ok',
    )
    expect(await as('trap_sync_svc', "update quorum_index.traps set ref = '0xevil'")).toBe('denied')
    expect(
      await as(
        'trap_sync_svc',
        "insert into quorum_index.traps (org_id,label,kind,chain,ref) values ('x','x','address','x','x')",
      ),
    ).toBe('denied')
  })
})

describe('PostgREST exposure', () => {
  test('config.toml does not expose quorum_index, ponder_quorum or exchange schemas', () => {
    const cfg = readFileSync(join(import.meta.dir, '..', '..', '..', '..', 'supabase', 'config.toml'), 'utf8')
    const line = cfg.match(/^schemas\s*=\s*\[(.*)\]/m)?.[1] ?? ''
    for (const s of ['quorum_index', 'ponder_quorum', 'exchange_a', 'exchange_b', 'datasets'])
      expect(line).not.toContain(s)
  })
})

describe('no decoy markers in exchange schemas (D28)', () => {
  test('no column name hints at decoys', async () => {
    const cols = await sql`select table_schema, table_name, column_name from information_schema.columns
                           where table_schema in ('exchange_a','exchange_b')`
    const bad = cols.filter((c) => /decoy|trap|honey|canary|bait|lure|fake/i.test(String(c.column_name)))
    expect(bad).toEqual([])
  })
})

afterAll(async () => {
  await sql`delete from quorum_index.traps where label = 'perm-test'`
  await sql`delete from quorum_index.officer_signatures where target_contract = '0x1'`
  await sql.end()
})

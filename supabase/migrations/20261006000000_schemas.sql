-- Quorum data layout (docs/20_data.md section 2 and 3).
-- Roles are created NOLOGIN here; scripts/db-roles.sh sets LOGIN + passwords from local .env.

-- ---------- roles ----------
do $$
declare r text;
begin
  foreach r in array array['exchange_a_app','exchange_b_app','quorum_svc','ponder_svc','trap_sync_svc','console_svc','datasets_rw']
  loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin noinherit', r);
    end if;
    -- The admin login (postgres, not a superuser on Supabase) must be a member to transfer
    -- ownership, set default privileges and run the role tests. No app role gets this.
    execute format('grant %I to current_user', r);
  end loop;
end $$;

-- ---------- schemas ----------
create schema if not exists exchange_a;
create schema if not exists exchange_b;
create schema if not exists quorum_index;
create schema if not exists datasets;
create schema if not exists ponder_quorum;

revoke all on schema exchange_a, exchange_b, quorum_index, datasets, ponder_quorum from public, anon, authenticated;

-- ---------- exchange_* (untrusted backend; no decoy markers anywhere) ----------
do $$
declare s text;
begin
  foreach s in array array['exchange_a','exchange_b']
  loop
    execute format($f$
      create table if not exists %1$I.users (
        id bigint generated always as identity primary key,
        user_id text not null unique,
        user_id_hash text not null unique,
        display_name text not null,
        kyc_level int not null default 1,
        created_at timestamptz not null default now(),
        last_active_at timestamptz
      );
      create table if not exists %1$I.balances (
        user_id text not null references %1$I.users(user_id),
        token text not null,
        available numeric(78,0) not null default 0,
        locked numeric(78,0) not null default 0,
        updated_at timestamptz not null default now(),
        primary key (user_id, token)
      );
      create table if not exists %1$I.deposits_ledger (
        id bigint generated always as identity primary key,
        user_id text not null references %1$I.users(user_id),
        token text not null,
        amount numeric(78,0) not null,
        tx_hash text not null,
        block_number bigint not null,
        created_at timestamptz not null default now()
      );
      create table if not exists %1$I.withdrawals (
        id uuid primary key default gen_random_uuid(),
        user_id text not null,
        token text not null,
        to_address text not null,
        amount numeric(78,0) not null,
        nonce numeric(78,0) not null,
        deadline bigint not null,
        request_id text unique,
        tx_hash text,
        status text not null default 'created'
          check (status in ('created','submitted','approved','rejected','pending','executed','failed','manual')),
        case_display text,
        intent jsonb,
        user_sig text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index if not exists withdrawals_status_idx on %1$I.withdrawals(status);
      create table if not exists %1$I.risk_config (
        key text primary key,
        value jsonb not null
      );
      create table if not exists %1$I.hot_wallets (
        label text primary key,
        chain text not null,
        address text not null,
        kind text not null check (kind in ('vault','eoa')),
        private_key_enc text,
        status text not null default 'active'
      );
      create table if not exists %1$I.whitelist_addresses (
        id bigint generated always as identity primary key,
        label text not null,
        address text not null,
        chain text not null
      );
      create table if not exists %1$I.api_keys (
        id bigint generated always as identity primary key,
        name text not null,
        key_hash text not null,
        scopes text[] not null default '{}'
      );
      create table if not exists %1$I.audit_log (
        id bigint generated always as identity primary key,
        actor text not null,
        action text not null,
        payload jsonb,
        created_at timestamptz not null default now()
      );
    $f$, s);
  end loop;
end $$;

-- ---------- quorum_index (defender side) ----------
create table if not exists quorum_index.traps (
  id bigint generated always as identity primary key,
  org_id text not null,
  label text not null,
  kind text not null check (kind in ('wallet_erc20','wallet_native','address','account','threshold','credential')),
  chain text not null,
  ref text not null,
  status text not null default 'armed' check (status in ('armed','tripped','n/a')),
  last_checked timestamptz,
  tripped_at timestamptz,
  tripped_tx text,
  case_id text,
  unique (org_id, kind, ref)
);

create table if not exists quorum_index.metrics (
  id bigint generated always as identity primary key,
  run_id text not null,
  name text not null,
  value double precision not null,
  unit text,
  source text not null check (source in ('testnet_measured','public_onchain','assumed')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists quorum_index.officer_signatures (
  id bigint generated always as identity primary key,
  target_contract text not null,
  action_kind int not null,
  subject text not null,
  value numeric(78,0) not null,
  nonce numeric(78,0) not null,
  deadline bigint not null,
  officer text not null,
  sig text not null,
  created_at timestamptz not null default now(),
  unique (target_contract, action_kind, subject, value, nonce, officer)
);

-- ---------- datasets ----------
create table if not exists datasets.synthetic_accounts (
  id bigint generated always as identity primary key,
  org text not null,
  user_id text not null,
  reg_days double precision not null,
  activity double precision not null,
  dep_freq double precision not null,
  wd_freq double precision not null,
  kyc_level int not null,
  balance_usd double precision not null,
  created_at timestamptz not null default now(),
  unique (org, user_id)
);
create table if not exists datasets.synthetic_withdrawals (id bigint generated always as identity primary key, org text, amount double precision, ts timestamptz);
create table if not exists datasets.hot_wallet_outflows (id bigint generated always as identity primary key, label_source text, address text, chain text, minute timestamptz, token text, amount numeric);
create table if not exists datasets.h0_withdrawals (id bigint generated always as identity primary key, address text, ts timestamptz, token text, amount numeric, first_seen_recipient boolean);
create table if not exists datasets.fbi_bybit_addresses (address text primary key, source_url text not null);
create table if not exists datasets.benign_labels (address text primary key, label text, source text not null);
create table if not exists datasets.sim_runs (id bigint generated always as identity primary key, strategy text, params jsonb, result jsonb, created_at timestamptz default now());
create table if not exists datasets.eval_runs (id bigint generated always as identity primary key, name text, params jsonb, result jsonb, created_at timestamptz default now());

-- ---------- grants ----------
-- Untrusted exchange backends: only their own schema.
grant usage on schema exchange_a to exchange_a_app;
grant select, insert, update, delete on all tables in schema exchange_a to exchange_a_app;
grant usage, select on all sequences in schema exchange_a to exchange_a_app;
grant usage on schema exchange_b to exchange_b_app;
grant select, insert, update, delete on all tables in schema exchange_b to exchange_b_app;
grant usage, select on all sequences in schema exchange_b to exchange_b_app;

-- Quorum service (sim-runner, decoy-admin, seed): quorum_index, datasets, and writes to the
-- exchange schemas (decoy-admin places decoys there). Never the reverse.
grant usage on schema quorum_index, exchange_a, exchange_b, datasets to quorum_svc;
grant select, insert, update, delete on all tables in schema quorum_index, exchange_a, exchange_b, datasets to quorum_svc;
grant usage, select on all sequences in schema quorum_index, exchange_a, exchange_b, datasets to quorum_svc;

-- trap-sync: read traps, update status columns only.
grant usage on schema quorum_index to trap_sync_svc;
grant select on quorum_index.traps to trap_sync_svc;
grant update (status, last_checked, tripped_at, tripped_tx, case_id) on quorum_index.traps to trap_sync_svc;

-- Console server routes: read-only.
grant usage on schema quorum_index to console_svc;
grant select on quorum_index.traps, quorum_index.metrics, quorum_index.officer_signatures to console_svc;

-- Ponder: owns ponder_quorum, nothing else. console_svc reads it through default privileges.
alter schema ponder_quorum owner to ponder_svc;
grant usage on schema ponder_quorum to console_svc;
alter default privileges for role ponder_svc in schema ponder_quorum grant select on tables to console_svc;

-- Datasets.
grant usage on schema datasets to datasets_rw;
grant select, insert, update, delete on all tables in schema datasets to datasets_rw;
grant usage, select on all sequences in schema datasets to datasets_rw;

-- ---------- officers (Supabase Auth) ----------
grant usage on schema quorum_index to authenticated;
grant select on quorum_index.traps, quorum_index.metrics to authenticated;
grant select, insert on quorum_index.officer_signatures to authenticated;
grant usage, select on sequence quorum_index.officer_signatures_id_seq to authenticated;

alter table quorum_index.traps enable row level security;
alter table quorum_index.metrics enable row level security;
alter table quorum_index.officer_signatures enable row level security;

create or replace function quorum_index.is_officer() returns boolean
  language sql stable
  as $$ select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'officer', false) $$;
grant execute on function quorum_index.is_officer() to authenticated;

create policy traps_officer_read on quorum_index.traps for select to authenticated using (quorum_index.is_officer());
create policy metrics_officer_read on quorum_index.metrics for select to authenticated using (quorum_index.is_officer());
create policy sigs_officer_read on quorum_index.officer_signatures for select to authenticated using (quorum_index.is_officer());
create policy sigs_officer_insert on quorum_index.officer_signatures for insert to authenticated with check (quorum_index.is_officer());

-- Service roles bypass RLS through explicit policies (they connect as themselves, not via JWT).
create policy traps_quorum_svc on quorum_index.traps for all to quorum_svc using (true) with check (true);
create policy traps_trap_sync on quorum_index.traps for select to trap_sync_svc using (true);
create policy traps_trap_sync_upd on quorum_index.traps for update to trap_sync_svc using (true) with check (true);
create policy traps_console on quorum_index.traps for select to console_svc using (true);
create policy metrics_quorum_svc on quorum_index.metrics for all to quorum_svc using (true) with check (true);
create policy metrics_console on quorum_index.metrics for select to console_svc using (true);
create policy sigs_quorum_svc on quorum_index.officer_signatures for all to quorum_svc using (true) with check (true);
create policy sigs_console on quorum_index.officer_signatures for select to console_svc using (true);

-- Realtime only for traps and officer_signatures (RLS applies).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table quorum_index.traps, quorum_index.officer_signatures;
  end if;
end $$;

-- pg_partman availability (recorded in STATUS; roadmap only).
-- select name, default_version from pg_available_extensions where name = 'pg_partman';

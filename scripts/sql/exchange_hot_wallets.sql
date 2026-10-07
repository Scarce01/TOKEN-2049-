-- Minimum schema for GET /admin/hot-wallets when full Supabase is not running.
-- Same columns as supabase/migrations/20261006000000_schemas.sql. No marker column.

create schema if not exists exchange_a;

create table if not exists exchange_a.hot_wallets (
  label text primary key,
  chain text not null,
  address text not null,
  kind text not null check (kind in ('vault', 'eoa')),
  private_key_enc text,
  status text not null default 'active'
);

create table if not exists exchange_a.audit_log (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'exchange_a_app') then
    create role exchange_a_app login password 'exchange_a_local';
  end if;
end $$;

grant usage on schema exchange_a to exchange_a_app;
grant select, insert, update, delete on all tables in schema exchange_a to exchange_a_app;
grant usage, select on all sequences in schema exchange_a to exchange_a_app;

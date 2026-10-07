-- Notifier (docs/47 3.5): per-user delivery channels, readable by a role that can see nothing else.
-- The notifier reads the chain for facts; this table only says where to deliver them.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'notifier_svc') then
    create role notifier_svc nologin noinherit;
  end if;
  execute format('grant %I to current_user', 'notifier_svc');
end $$;

create table if not exists quorum_index.notify_channels (
  user_id_hash text primary key,
  url text not null,
  created_at timestamptz not null default now()
);

grant usage on schema quorum_index to notifier_svc;
grant select on quorum_index.notify_channels to notifier_svc;
grant select, insert, update, delete on quorum_index.notify_channels to quorum_svc;

alter table quorum_index.notify_channels enable row level security;
create policy channels_notifier on quorum_index.notify_channels for select to notifier_svc using (true);
create policy channels_quorum_svc on quorum_index.notify_channels for all to quorum_svc using (true) with check (true);

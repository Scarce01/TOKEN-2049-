-- Synthetic normal withdrawals (source = assumed): enough detail for the false-positive replay (D44)
-- and the assumed CUSUM baseline until BigQuery H0 data replaces it.
alter table datasets.synthetic_withdrawals add column if not exists user_id text;
alter table datasets.synthetic_withdrawals add column if not exists token text;
alter table datasets.synthetic_withdrawals add column if not exists amount_units numeric(78,0);
alter table datasets.synthetic_withdrawals add column if not exists new_recipient boolean;
alter table datasets.synthetic_withdrawals add column if not exists source text not null default 'assumed';
create index if not exists synthetic_withdrawals_org_ts on datasets.synthetic_withdrawals (org, ts);

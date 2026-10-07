-- Outbox columns for the exchange-api workers (withdrawals rows are the outbox; workers claim
-- rows with FOR UPDATE SKIP LOCKED, so a crash never loses or double-submits a request).
do $$
declare s text;
begin
  foreach s in array array['exchange_a','exchange_b']
  loop
    execute format($f$
      alter table %1$I.withdrawals add column if not exists vault text;
      alter table %1$I.withdrawals add column if not exists user_id_hash text;
      alter table %1$I.withdrawals add column if not exists attempts int not null default 0;
      alter table %1$I.withdrawals add column if not exists next_attempt_at timestamptz not null default now();
      alter table %1$I.withdrawals add column if not exists last_sent_at timestamptz;
      alter table %1$I.withdrawals add column if not exists submit_tx text;
      alter table %1$I.withdrawals add column if not exists execute_tx text;
      alter table %1$I.withdrawals add column if not exists last_error text;
      alter table %1$I.withdrawals add column if not exists source text not null default 'user';
    $f$, s);
  end loop;
end $$;

-- Webhook replay ledger, idempotency and safer bounce handling.
-- All helpers are service-role only; no client role can read or write the ledger.

create table if not exists public.processed_webhook_events (
  event_key   text primary key check (char_length(event_key) between 1 and 320),
  kind        text not null check (kind ~ '^[a-z0-9_.:-]{1,80}$'),
  received_at timestamptz not null default now()
);

create index if not exists processed_webhook_events_received_at_idx
  on public.processed_webhook_events (received_at);

alter table public.processed_webhook_events enable row level security;
revoke all on public.processed_webhook_events from public, anon, authenticated;
grant select, insert, delete on public.processed_webhook_events to service_role;

-- Returns true only for the first delivery of an event.
create or replace function public.consume_webhook_event(p_kind text, p_event_id text)
returns boolean
language plpgsql security definer
set search_path=public set statement_timeout='5s' as $$
declare
  v_key text;
  v_inserted bigint;
begin
  if p_kind is null or p_kind !~ '^[a-z0-9_.:-]{1,80}$'
     or p_event_id is null or char_length(p_event_id) not between 1 and 256 then
    raise exception 'bad_webhook_event';
  end if;

  v_key := p_kind || ':' || p_event_id;
  insert into public.processed_webhook_events(event_key, kind)
  values (v_key, p_kind)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  return v_inserted = 1;
end $$;

revoke all on function public.consume_webhook_event(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_webhook_event(text, text) to service_role;

create or replace function public.cleanup_processed_webhook_events(
  p_older_than interval default interval '7 days'
)
returns void language sql security definer
set search_path=public set statement_timeout='30s' as $$
  delete from public.processed_webhook_events where received_at < now() - p_older_than;
$$;

revoke all on function public.cleanup_processed_webhook_events(interval)
  from public, anon, authenticated;
grant execute on function public.cleanup_processed_webhook_events(interval) to service_role;

-- Bounce intake: bound the payload and allow soft -> hard escalation.
create or replace function public.record_email_bounce(p_provider text, p_event jsonb)
returns void language plpgsql security definer
set search_path=public set statement_timeout='5s' as $$
declare
  v_recipient text;
  v_raw text;
  v_type text;
  v_event_id text;
  v_tenant uuid;
  v_provider text := left(coalesce(p_provider, ''), 40);
begin
  if p_event is null or jsonb_typeof(p_event) <> 'object'
     or pg_column_size(p_event) > 20000 then
    raise exception 'bad_request';
  end if;

  v_recipient := lower(btrim(coalesce(
    p_event->>'email', p_event->>'recipient', p_event->>'to',
    p_event#>>'{bounce,bouncedRecipients,0,emailAddress}',
    p_event#>>'{bounce,bouncedRecipients,0,email}'
  , '')));
  if char_length(coalesce(v_recipient, '')) > 254
     or v_recipient !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'bad_recipient';
  end if;

  v_raw := lower(coalesce(p_event->>'bounce_type', p_event#>>'{bounce,bounceType}', 'soft'));
  v_type := case
    when v_raw in ('hard','permanent','permanentfailure','5.1.1') then 'hard'
    when v_raw in ('complaint','spamcomplaint','abuse') then 'complaint'
    else 'soft' end;
  v_event_id := left(coalesce(p_event->>'event_id', p_event->>'id', p_event->>'message_id', ''), 120);

  select tenant_id into v_tenant from public.platform_billing_email_outbox
   where lower(recipient_email) = v_recipient
   order by created_at desc limit 1;

  insert into public.bounce_suppressions(tenant_id, provider, event_id, channel, recipient, bounce_type)
  values (v_tenant, v_provider, v_event_id, 'email', v_recipient, v_type)
  on conflict(provider, event_id, recipient) do nothing;

  -- A later hard bounce must still escalate an earlier soft bounce.
  update public.platform_billing_email_outbox
     set bounced_at = coalesce(bounced_at, now()),
         bounce_type = case
           when v_type = 'hard' then 'hard'
           when coalesce(bounce_type, 'soft') = 'hard' then 'hard'
           when v_type = 'complaint' then 'complaint'
           else coalesce(bounce_type, v_type)
         end,
         status = case when v_type = 'hard' then 'failed' else status end,
         lease_until = case when v_type = 'hard' then null else lease_until end,
         last_error = case when v_type = 'hard' then 'bounced_hard' else last_error end
   where lower(recipient_email) = v_recipient;
end $$;

revoke all on function public.record_email_bounce(text, jsonb) from public, anon, authenticated;
grant execute on function public.record_email_bounce(text, jsonb) to service_role;

do $$
begin
  if not exists(select 1 from pg_extension where extname='pg_cron') then
    raise notice 'pg_cron is not enabled; webhook ledger cleanup was not scheduled';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname='webhook-cleanup-processed-events';
  perform cron.schedule(
    'webhook-cleanup-processed-events',
    '20 4 * * *',
    'select public.cleanup_processed_webhook_events()'
  );
end $$;

notify pgrst, 'reload schema';

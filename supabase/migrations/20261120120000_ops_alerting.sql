-- Lightweight operational alerts. Everything is service-role only; the
-- hourly collector writes one alert per failing cron job per hour.

create table if not exists public.platform_alert_events (
  id         uuid primary key default gen_random_uuid(),
  source     text not null check (source ~ '^[a-z0-9_.:-]{1,80}$'),
  level      text not null check (level in ('warn','error')),
  message    text not null check (char_length(message) between 1 and 500),
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_alert_events_created_at_idx
  on public.platform_alert_events (created_at desc);
create index if not exists platform_alert_events_source_created_idx
  on public.platform_alert_events (source, created_at desc);

alter table public.platform_alert_events enable row level security;
revoke all on public.platform_alert_events from public, anon, authenticated;
grant select, insert on public.platform_alert_events to service_role;

create or replace function public.record_ops_alert(
  p_source text,
  p_level text,
  p_message text,
  p_details jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer
set search_path=public set statement_timeout='5s' as $$
declare v_id uuid;
begin
  if p_source is null or p_source !~ '^[a-z0-9_.:-]{1,80}$'
     or p_level not in ('warn','error')
     or p_message is null or char_length(btrim(p_message)) not between 1 and 500 then
    raise exception 'bad_alert';
  end if;
  insert into public.platform_alert_events(source, level, message, details)
  values (p_source, p_level, btrim(p_message),
          coalesce(p_details, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.record_ops_alert(text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_ops_alert(text, text, text, jsonb)
  to service_role;

create or replace function public.collect_cron_failures()
returns integer
language plpgsql security definer
set search_path=public set statement_timeout='30s' as $$
declare v_count integer := 0; r record;
begin
  for r in
    select j.jobname, count(*)::int as failures
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
    where d.status = 'failed' and d.start_time >= now() - interval '1 hour'
    group by j.jobname
  loop
    if not exists(
      select 1 from public.platform_alert_events a
      where a.source = 'pg_cron:' || r.jobname
        and a.created_at >= now() - interval '1 hour'
    ) then
      perform public.record_ops_alert(
        'pg_cron:' || r.jobname,
        'error',
        'Cron job failed within the last hour',
        jsonb_build_object('failures', r.failures, 'window', '1 hour')
      );
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

revoke all on function public.collect_cron_failures()
  from public, anon, authenticated;
grant execute on function public.collect_cron_failures() to service_role;

do $$
begin
  if not exists(select 1 from pg_extension where extname='pg_cron') then
    raise notice 'pg_cron is not enabled; cron failure alerts were not scheduled';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job
    where jobname='platform-collect-cron-failures-hourly';
  perform cron.schedule(
    'platform-collect-cron-failures-hourly',
    '5 * * * *',
    'select public.collect_cron_failures()'
  );
end $$;

notify pgrst, 'reload schema';

-- Scheduled maintenance for report rollups and operational archival.
-- Both helpers are security definer and are only executable by service_role / pg_cron.
-- The schedules are installed only when pg_cron is available on the project.

create or replace function public.refresh_all_booking_reports(p_days integer default 7)
returns jsonb
language plpgsql security definer
set search_path=public
set statement_timeout='5min'
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 31);
  v_tenant uuid;
  v_total integer := 0;
  v_tenants integer := 0;
begin
  for v_tenant in select id from public.tenants loop
    v_total := v_total + public.refresh_booking_report_daily(
      v_tenant, current_date - v_days, current_date
    );
    v_tenants := v_tenants + 1;
  end loop;
  return jsonb_build_object('tenants', v_tenants, 'days', v_days, 'rows_upserted', v_total);
end $$;

revoke all on function public.refresh_all_booking_reports(integer)
  from public, anon, authenticated;
grant execute on function public.refresh_all_booking_reports(integer) to service_role;

do $$
begin
  if not exists(select 1 from pg_extension where extname='pg_cron') then
    raise notice 'pg_cron is not enabled; maintenance schedules were not installed';
    return;
  end if;

  -- Recompute the last week of daily metrics shortly after midnight UTC.
  perform cron.unschedule(jobid) from cron.job where jobname='platform-refresh-booking-report-daily';
  perform cron.schedule(
    'platform-refresh-booking-report-daily',
    '20 1 * * *',
    'select public.refresh_all_booking_reports(7)'
  );

  -- Move old terminal audit jobs and notification jobs out of the hot tables weekly.
  perform cron.unschedule(jobid) from cron.job where jobname='platform-archive-old-operational-rows';
  perform cron.schedule(
    'platform-archive-old-operational-rows',
    '40 3 * * 0',
    'select public.archive_old_operational_rows(365, 1000)'
  );
end $$;

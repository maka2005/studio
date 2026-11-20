-- Fix: cron.job_run_details has no jobname column in Supabase; join cron.job.
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

notify pgrst, 'reload schema';

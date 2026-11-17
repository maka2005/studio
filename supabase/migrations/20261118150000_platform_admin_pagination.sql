-- Offset pagination for the two remaining platform lists. Signatures are
-- replaced so existing callers keep working with the new default argument.

drop function if exists public.platform_list_subscriptions(uuid, text, int);
create function public.platform_list_subscriptions(
  p_actor uuid, p_phase text default null, p_limit int default 100, p_offset int default 0
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare r jsonb;
begin
  perform public.platform_assert(p_actor);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into r from (
    select * from (
      select s.id,s.tenant_id,t.slug,t.config->>'name' as name,p.code as plan_code,s.price_kzt,
        s.price_period_months,s.status,
        public.subscription_phase(s.status,s.starts_at,s.ends_at,s.grace_ends_at) as phase,
        s.starts_at,s.ends_at,s.grace_ends_at,s.created_at
      from public.subscriptions s
      join public.tenants t on t.id=s.tenant_id
      join public.plans p on p.id=s.plan_id) y
    where p_phase is null or y.phase=p_phase
    order by y.created_at desc
    limit least(greatest(p_limit,1),500) offset greatest(p_offset,0)) x;
  return r;
end $$;

drop function if exists public.platform_notifications(uuid, int);
create function public.platform_notifications(
  p_actor uuid, p_limit int default 200, p_offset int default 0
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.platform_assert(p_actor);
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select a.id,a.action,a.tenant_id,t.slug,a.payload,a.created_at,
      exists(select 1 from public.platform_notification_reads r where r.audit_log_id=a.id and r.actor_id=p_actor) as is_read
    from public.platform_audit_logs a left join public.tenants t on t.id=a.tenant_id
    where a.action like 'price_change.%'
    order by a.created_at desc
    limit least(greatest(p_limit,1),500) offset greatest(p_offset,0)) x),'[]'::jsonb);
end $$;

revoke all on function public.platform_list_subscriptions(uuid,text,int,int),
  public.platform_notifications(uuid,int,int) from public, anon;
grant execute on function public.platform_list_subscriptions(uuid,text,int,int),
  public.platform_notifications(uuid,int,int) to authenticated, service_role;

notify pgrst, 'reload schema';

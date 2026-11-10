-- Serve the platform journal a single page at a time. The previous RPC could
-- aggregate and return up to 1,000 rows in one response.
create index if not exists platform_audit_action_created_idx
  on public.platform_audit_logs(action, created_at desc, id desc);
create index if not exists platform_audit_tenant_action_created_idx
  on public.platform_audit_logs(tenant_id, action, created_at desc, id desc);

drop function if exists public.platform_audit_list(uuid,uuid,timestamptz,timestamptz,int);
create function public.platform_audit_list(
  p_actor uuid,
  p_tenant uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_action text default null,
  p_limit int default 51,
  p_offset int default 0
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.platform_assert(p_actor);
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc) from (
    select a.id,a.actor_id,u.email as actor_email,a.action,a.tenant_id,t.slug,a.payload,a.created_at
    from public.platform_audit_logs a
      left join auth.users u on u.id=a.actor_id
      left join public.tenants t on t.id=a.tenant_id
    where (p_tenant is null or a.tenant_id=p_tenant)
      and (p_from is null or a.created_at>=p_from)
      and (p_to is null or a.created_at<p_to)
      and (nullif(p_action,'') is null or a.action=p_action)
    order by a.created_at desc, a.id desc
    limit least(greatest(p_limit,1),101)
    offset least(greatest(p_offset,0),1000000)
  ) x),'[]'::jsonb);
end $$;

revoke all on function public.platform_audit_list(uuid,uuid,timestamptz,timestamptz,text,int,int)
  from public, anon, authenticated;
grant execute on function public.platform_audit_list(uuid,uuid,timestamptz,timestamptz,text,int,int)
  to service_role;

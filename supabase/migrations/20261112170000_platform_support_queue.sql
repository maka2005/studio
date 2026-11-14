create or replace function public.platform_support_queue(
  p_actor uuid,p_status text default null,p_category text default null,p_severity text default null,
  p_search text default null,p_limit integer default 25,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare total integer; items jsonb; query_text text:=nullif(btrim(p_search),''); page_limit integer:=greatest(1,least(coalesce(p_limit,25),50)); page_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if not exists(select 1 from public.platform_admins where user_id=p_actor and role in ('owner','support') and is_active) then raise exception 'forbidden'; end if;
  select count(*)::integer into total from public.platform_tenant_cases c
    where (p_status is null or c.status=p_status)
      and (p_category is null or c.category=p_category)
      and (p_severity is null or c.severity=p_severity)
      and (query_text is null or c.subject ilike '%'||query_text||'%' or coalesce(c.custom_type,'') ilike '%'||query_text||'%'
        or exists(select 1 from public.tenants t where t.id=c.tenant_id and (coalesce(t.config->>'name','') ilike '%'||query_text||'%' or t.slug ilike '%'||query_text||'%')));
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'tenant_id',q.tenant_id,'subject',q.subject,'category',q.category,'custom_type',q.custom_type,'severity',q.severity,
    'status',q.status,'created_by_email',q.created_by_email,'updated_by_email',q.updated_by_email,'created_at',q.created_at,'updated_at',q.updated_at,
    'tenant',jsonb_build_object('id',q.org_id,'name',q.org_name,'slug',q.org_slug)) order by q.updated_at desc),'[]'::jsonb)
    into items from (
      select c.*,t.id as org_id,t.config->>'name' as org_name,t.slug as org_slug from public.platform_tenant_cases c
      join public.tenants t on t.id=c.tenant_id
      where (p_status is null or c.status=p_status)
        and (p_category is null or c.category=p_category)
        and (p_severity is null or c.severity=p_severity)
        and (query_text is null or c.subject ilike '%'||query_text||'%' or coalesce(c.custom_type,'') ilike '%'||query_text||'%'
          or coalesce(t.config->>'name','') ilike '%'||query_text||'%' or t.slug ilike '%'||query_text||'%')
      order by c.updated_at desc limit page_limit offset page_offset
    ) q;
  return jsonb_build_object('rows',items,'count',total,'limit',page_limit,'offset',page_offset);
end $$;

create or replace function public.platform_support_ticket_detail(p_actor uuid,p_ticket uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare item jsonb;
begin
  if not exists(select 1 from public.platform_admins where user_id=p_actor and role in ('owner','support') and is_active) then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'id',c.id,'tenant_id',c.tenant_id,'subject',c.subject,'category',c.category,'custom_type',c.custom_type,'severity',c.severity,
    'status',c.status,'created_by_email',c.created_by_email,'updated_by_email',c.updated_by_email,'created_at',c.created_at,'updated_at',c.updated_at,
    'tenant',jsonb_build_object('id',t.id,'name',t.config->>'name','slug',t.slug),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'event_type',e.event_type,'message',e.message,'status',e.status,'actor_email',e.actor_email,'created_at',e.created_at) order by e.created_at asc)
      from public.platform_tenant_case_events e where e.tenant_id=c.tenant_id and e.case_id=c.id),'[]'::jsonb))
    into item from public.platform_tenant_cases c join public.tenants t on t.id=c.tenant_id where c.id=p_ticket;
  if item is null then raise exception 'not_found'; end if;
  return item;
end $$;

revoke all on function public.platform_support_queue(uuid,text,text,text,text,integer,integer),public.platform_support_ticket_detail(uuid,uuid) from public,anon,authenticated;
grant execute on function public.platform_support_queue(uuid,text,text,text,text,integer,integer),public.platform_support_ticket_detail(uuid,uuid) to service_role;
notify pgrst,'reload schema';

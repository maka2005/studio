drop function if exists public.owner_support_list(text);

create function public.owner_support_list(p_slug text,p_limit integer default 10,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare
  v_tenant_id uuid;
  actor uuid:=auth.uid();
  page_limit integer:=greatest(1,least(coalesce(p_limit,10),50));
  page_offset integer:=greatest(coalesce(p_offset,0),0);
  total integer;
  result_tickets jsonb;
  result_events jsonb;
begin
  if actor is null then raise exception 'unauthorized'; end if;
  select t.id into v_tenant_id from public.tenants t
    join public.tenant_members m on m.tenant_id=t.id
    where t.slug=p_slug and m.user_id=actor and m.role in ('owner','manager','staff');
  if v_tenant_id is null then raise exception 'forbidden'; end if;

  select count(*)::integer into total from public.platform_tenant_cases c where c.tenant_id=v_tenant_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'subject',q.subject,'category',q.category,'custom_type',q.custom_type,'severity',q.severity,
    'status',q.status,'created_by_email',q.created_by_email,'updated_by_email',q.updated_by_email,
    'created_at',q.created_at,'updated_at',q.updated_at) order by q.updated_at desc),'[]'::jsonb)
    into result_tickets from (select * from public.platform_tenant_cases where tenant_id=v_tenant_id order by updated_at desc limit page_limit offset page_offset) q;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'case_id',e.case_id,'event_type',e.event_type,'message',e.message,'status',e.status,
    'actor_email',e.actor_email,'is_support',exists(select 1 from public.platform_admins a where a.user_id=e.actor_id),
    'created_at',e.created_at) order by e.created_at asc),'[]'::jsonb)
    into result_events from public.platform_tenant_case_events e
    where e.tenant_id=v_tenant_id and e.case_id in (
      select c.id from public.platform_tenant_cases c where c.tenant_id=v_tenant_id order by c.updated_at desc limit page_limit offset page_offset
    );
  return jsonb_build_object('tickets',result_tickets,'events',result_events,'count',total,'limit',page_limit,'offset',page_offset);
end $$;

revoke all on function public.owner_support_list(text,integer,integer) from public,anon;
grant execute on function public.owner_support_list(text,integer,integer) to authenticated;

create or replace function public.platform_support_ticket_detail(p_actor uuid,p_ticket uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare item jsonb;
begin
  if not exists(select 1 from public.platform_admins where user_id=p_actor and role in ('owner','support') and is_active) then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'id',c.id,'tenant_id',c.tenant_id,'subject',c.subject,'category',c.category,'custom_type',c.custom_type,'severity',c.severity,
    'status',c.status,'created_by_email',c.created_by_email,'updated_by_email',c.updated_by_email,'created_at',c.created_at,'updated_at',c.updated_at,
    'tenant',jsonb_build_object('id',t.id,'name',t.config->>'name','slug',t.slug),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'event_type',e.event_type,'message',e.message,'status',e.status,'actor_email',e.actor_email,
      'is_support',exists(select 1 from public.platform_admins a where a.user_id=e.actor_id),'created_at',e.created_at) order by e.created_at asc)
      from public.platform_tenant_case_events e where e.tenant_id=c.tenant_id and e.case_id=c.id),'[]'::jsonb))
    into item from public.platform_tenant_cases c join public.tenants t on t.id=c.tenant_id where c.id=p_ticket;
  if item is null then raise exception 'not_found'; end if;
  return item;
end $$;

notify pgrst,'reload schema';

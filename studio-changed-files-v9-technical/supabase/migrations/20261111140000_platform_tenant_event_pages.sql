-- Keep tenant detail responses small and page subscription events directly in the database.
create or replace function public.platform_tenant_card(p_actor uuid,p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare t public.tenants; r jsonb;
begin
  perform public.platform_assert(p_actor);
  select * into t from public.tenants where id=p_tenant;
  if not found then raise exception 'not_found'; end if;
  select jsonb_build_object(
    'tenant',jsonb_build_object('id',t.id,'slug',t.slug,'status',t.status,'timezone',t.timezone,'created_at',t.created_at,'config',t.config),
    'access_state',public.tenant_access_state(t.id),
    'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role,'last_sign_in_at',u.last_sign_in_at))
      from public.tenant_members m join auth.users u on u.id=m.user_id where m.tenant_id=t.id),'[]'::jsonb),
    'subscriptions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'plan_code',p.code,'plan_name',p.name,'status',s.status,
        'phase',public.subscription_phase(s.status,s.starts_at,s.ends_at,s.grace_ends_at),'starts_at',s.starts_at,'ends_at',s.ends_at,
        'grace_ends_at',s.grace_ends_at,'created_at',s.created_at) order by s.created_at desc)
      from public.subscriptions s join public.plans p on p.id=s.plan_id where s.tenant_id=t.id),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.received_at desc) from (
      select id,subscription_id,amount_kzt,period_start,period_end,method,status,received_at,confirmed_by,refund_reason,note
      from public.saas_payments where tenant_id=t.id order by received_at desc limit 100) x),'[]'::jsonb),
    'counters',jsonb_build_object(
      'staff',(select count(*) from public.tenant_members where tenant_id=t.id),
      'services',(select count(*) from public.services where tenant_id=t.id),
      'bookings_30d',(select count(*) from public.bookings where tenant_id=t.id and created_at>=now()-interval '30 days'))
  ) into r;
  return r;
end $$;

create or replace function public.platform_tenant_events(p_actor uuid,p_tenant uuid,p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb; page_limit integer:=least(greatest(p_limit,1),100);
begin
  perform public.platform_assert(p_actor);
  if p_offset<0 then raise exception 'bad_range'; end if;
  if not exists(select 1 from public.tenants where id=p_tenant) then raise exception 'not_found'; end if;
  with page as (
    select e.id,e.subscription_id,e.type,e.payload,e.actor_id,e.created_at
    from public.subscription_events e join public.subscriptions s on s.id=e.subscription_id
    where s.tenant_id=p_tenant order by e.created_at desc,e.id desc limit page_limit+1 offset p_offset
  ), visible as (
    select * from page order by created_at desc,id desc limit page_limit
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc,v.id desc) from visible v),'[]'::jsonb),
    'has_more',(select count(*)>page_limit from page)
  ) into result;
  return result;
end $$;

revoke all on function public.platform_tenant_events(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.platform_tenant_events(uuid,uuid,integer,integer) to service_role;

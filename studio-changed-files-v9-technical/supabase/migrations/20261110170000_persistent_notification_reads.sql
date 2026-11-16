-- Notification read state belongs to the user, not the browser that happened to open the page.
create table public.owner_notification_reads(
  price_change_id uuid not null references public.subscription_price_changes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key(price_change_id,user_id)
);
create table public.platform_notification_reads(
  audit_log_id uuid not null references public.platform_audit_logs(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key(audit_log_id,actor_id)
);
alter table public.owner_notification_reads enable row level security;
alter table public.platform_notification_reads enable row level security;
revoke all on public.owner_notification_reads,public.platform_notification_reads from public,anon,authenticated;

create or replace function public.owner_pending_price_change(p_slug text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare t uuid; actor uuid:=auth.uid(); result jsonb;
begin
  select id into t from public.tenants where slug=p_slug;
  if t is null or public.member_role(t) is null then raise exception 'forbidden'; end if;
  select jsonb_agg(jsonb_build_object('id',c.id,'old_price_kzt',c.old_price_kzt,'old_period_months',c.old_period_months,
    'new_price_kzt',c.new_price_kzt,'new_period_months',c.new_period_months,'effective_at',c.effective_at,'created_at',c.created_at,
    'is_read',exists(select 1 from public.owner_notification_reads r where r.price_change_id=c.id and r.user_id=actor)) order by c.created_at desc) into result
  from public.subscription_price_changes c join public.subscriptions s on s.id=c.subscription_id
  where c.tenant_id=t and c.status='pending' and s.status in ('trial','active','grace');
  return coalesce(result,'[]'::jsonb);
end $$;

create or replace function public.owner_mark_price_changes_read(p_slug text,p_ids uuid[]) returns void
language plpgsql security definer set search_path=public as $$
declare t uuid; actor uuid:=auth.uid();
begin
  select id into t from public.tenants where slug=p_slug;
  if t is null or public.member_role(t) is null then raise exception 'forbidden'; end if;
  insert into public.owner_notification_reads(price_change_id,user_id)
  select c.id,actor from public.subscription_price_changes c where c.tenant_id=t and c.status='pending' and c.id=any(coalesce(p_ids,'{}'::uuid[]))
  on conflict(price_change_id,user_id) do nothing;
end $$;

create or replace function public.platform_notifications(p_actor uuid,p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.platform_assert(p_actor);
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select a.id,a.action,a.tenant_id,t.slug,a.payload,a.created_at,
      exists(select 1 from public.platform_notification_reads r where r.audit_log_id=a.id and r.actor_id=p_actor) as is_read
    from public.platform_audit_logs a left join public.tenants t on t.id=a.tenant_id
    where a.action like 'price_change.%' order by a.created_at desc limit least(greatest(p_limit,1),500)) x),'[]'::jsonb);
end $$;

create or replace function public.platform_mark_notifications_read(p_actor uuid,p_ids uuid[]) returns void
language plpgsql security definer set search_path=public as $$
begin
  perform public.platform_assert(p_actor);
  insert into public.platform_notification_reads(audit_log_id,actor_id)
  select a.id,p_actor from public.platform_audit_logs a where a.id=any(coalesce(p_ids,'{}'::uuid[])) and a.action like 'price_change.%'
  on conflict(audit_log_id,actor_id) do nothing;
end $$;

revoke all on function public.owner_pending_price_change(text),public.owner_mark_price_changes_read(text,uuid[]),public.platform_notifications(uuid,int),public.platform_mark_notifications_read(uuid,uuid[]) from public,anon;
grant execute on function public.owner_pending_price_change(text),public.owner_mark_price_changes_read(text,uuid[]),public.platform_notifications(uuid,int),public.platform_mark_notifications_read(uuid,uuid[]) to authenticated,service_role;

-- A declined renewal ends at the end of the already paid term; it is not silently renewed.
create or replace function public.tenant_access_state(p_tenant uuid) returns text
language plpgsql stable security definer set search_path=public as $$
declare s public.subscriptions; ph text;
begin
  select * into s from public.subscriptions where tenant_id=p_tenant
    order by (status in ('trial','active','grace','suspended')) desc,created_at desc limit 1;
  if not found then return 'open'; end if;
  if s.nonrenew_at is not null and now()>=s.nonrenew_at then return 'closed'; end if;
  ph:=public.subscription_phase(s.status,s.starts_at,s.ends_at,s.grace_ends_at);
  return case when ph in ('trial','active') then 'open' when ph='grace' then 'grace' else 'closed' end;
end $$;

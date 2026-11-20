-- Corrective migration: remove stray EXECUTE grants discovered by the RLS audit.
-- All reads of cross-tenant platform data and schedule helpers must go through
-- service_role-backed Edge functions / SECURITY DEFINER RPCs.

-- P0-1: platform notification reporting must not be callable by browsers.
revoke all on function
  public.platform_notification_delivery(text, text, integer, integer),
  public.platform_notification_bounces(integer, integer)
  from public, anon, authenticated;
grant execute on function
  public.platform_notification_delivery(text, text, integer, integer),
  public.platform_notification_bounces(integer, integer)
  to service_role;

-- P0-2: platform RPCs trust p_actor, so only service_role may pass that argument.
revoke all on function
  public.platform_notifications(uuid, integer, integer),
  public.platform_mark_notifications_read(uuid, uuid[]),
  public.platform_list_subscriptions(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function
  public.platform_notifications(uuid, integer, integer),
  public.platform_mark_notifications_read(uuid, uuid[]),
  public.platform_list_subscriptions(uuid, text, integer, integer)
  to service_role;

-- P0-3: a deactivated platform admin must stop passing platform_assert().
create or replace function public.is_platform_admin(p_user uuid)
returns boolean
language sql stable security definer
set search_path=public as $$
  select p_user is not null and exists(
    select 1 from public.platform_admins where user_id=p_user and is_active
  )
$$;
revoke all on function public.is_platform_admin(uuid) from public, anon, authenticated;
grant execute on function public.is_platform_admin(uuid) to service_role;

-- P1-1: schedule helpers accept an arbitrary tenant_id by design; they are
-- internal helpers for get_slots() and must not be exposed through PostgREST.
revoke all on function
  public.effective_day_hours(uuid, date),
  public.slot_in_break(uuid, timestamp with time zone, integer)
  from public, anon, authenticated;

-- P2-1: a declined renewal closes access at nonrenew_at, not at ends_at.
create or replace function public.tenant_access_state(p_tenant uuid)
returns text
language plpgsql stable security definer
set search_path=public as $$
declare s public.subscriptions; ph text;
begin
  if exists(select 1 from public.tenants where id=p_tenant and archived_at is not null) then
    return 'closed';
  end if;
  select * into s from public.subscriptions where tenant_id=p_tenant
    order by (status in ('trial','active','grace','suspended')) desc, created_at desc limit 1;
  if not found then return 'open'; end if;
  if s.nonrenew_at is not null and now()>=s.nonrenew_at then return 'closed'; end if;
  ph:=public.subscription_phase(s.status,s.starts_at,s.ends_at,s.grace_ends_at);
  return case when ph in ('trial','active') then 'open' when ph='grace' then 'grace' else 'closed' end;
end $$;

-- P2-2: internal helper, no direct client/service access needed.
revoke all on function public.owner_tenant_owner(text)
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

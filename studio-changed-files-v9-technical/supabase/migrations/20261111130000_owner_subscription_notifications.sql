-- Surface platform subscription and failed-payment events to organization owners.
create table public.owner_billing_notification_reads (
  event_id uuid not null references public.subscription_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key(event_id,user_id)
);
alter table public.owner_billing_notification_reads enable row level security;
revoke all on public.owner_billing_notification_reads from public,anon,authenticated;

create or replace function public.audit_platform_subscription_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare tenant uuid;
begin
  if new.type not in ('suspended','resumed','expired','grace_started','extended','plan_changed','dates_changed','cancelled','payment_failed','price_change_accepted','price_change_declined') then return new; end if;
  select tenant_id into tenant from public.subscriptions where id=new.subscription_id;
  if tenant is null then return new; end if;
  insert into public.admin_audit_events(tenant_id,actor_id,entity,entity_id,action,details)
  values(tenant,new.actor_id,'subscription',new.subscription_id,new.type,coalesce(new.payload,'{}'::jsonb));
  return new;
end $$;
create trigger audit_platform_subscription_event after insert on public.subscription_events
  for each row execute function public.audit_platform_subscription_event();

create or replace function public.capture_saas_payment_failure_event() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.status='failed' and old.status is distinct from new.status and new.subscription_id is not null then
    insert into public.subscription_events(subscription_id,type,payload,actor_id)
    values(new.subscription_id,'payment_failed',jsonb_build_object('payment_id',new.id,'amount_kzt',new.amount_kzt,'reason',new.note),new.confirmed_by);
  end if;
  return new;
end $$;
create trigger capture_saas_payment_failure_event after update of status on public.saas_payments
  for each row when (new.status='failed' and old.status is distinct from new.status)
  execute function public.capture_saas_payment_failure_event();

create or replace function public.owner_billing_notifications(p_slug text,p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare tenant uuid; actor uuid:=auth.uid(); result jsonb;
begin
  tenant:=public.owner_tenant(p_slug);
  if p_limit not between 1 and 100 or p_offset<0 then raise exception 'bad_range'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into result
  from (
    select e.id,e.type as event_type,e.payload,e.created_at,
      exists(select 1 from public.owner_billing_notification_reads r where r.event_id=e.id and r.user_id=actor) as is_read
    from public.subscription_events e join public.subscriptions s on s.id=e.subscription_id
    where s.tenant_id=tenant and e.type in ('suspended','resumed','expired','grace_started','extended','plan_changed','dates_changed','cancelled','payment_failed','price_change_accepted','price_change_declined')
    order by e.created_at desc,e.id desc limit p_limit offset p_offset
  ) x;
  return result;
end $$;

create or replace function public.owner_mark_billing_notifications_read(p_slug text,p_ids uuid[]) returns void
language plpgsql security definer set search_path=public as $$
declare tenant uuid; actor uuid:=auth.uid();
begin
  tenant:=public.owner_tenant(p_slug);
  insert into public.owner_billing_notification_reads(event_id,user_id)
  select e.id,actor from public.subscription_events e join public.subscriptions s on s.id=e.subscription_id
  where s.tenant_id=tenant and e.id=any(coalesce(p_ids,'{}'::uuid[]))
    and e.type in ('suspended','resumed','expired','grace_started','extended','plan_changed','dates_changed','cancelled','payment_failed','price_change_accepted','price_change_declined')
  on conflict(event_id,user_id) do nothing;
end $$;

revoke all on function public.audit_platform_subscription_event(),public.capture_saas_payment_failure_event(),
  public.owner_billing_notifications(text,integer,integer),public.owner_mark_billing_notifications_read(text,uuid[])
  from public,anon;
revoke all on function public.owner_billing_notifications(text,integer,integer),public.owner_mark_billing_notifications_read(text,uuid[])
  from authenticated;
grant execute on function public.owner_billing_notifications(text,integer,integer),
  public.owner_mark_billing_notifications_read(text,uuid[]) to authenticated,service_role;

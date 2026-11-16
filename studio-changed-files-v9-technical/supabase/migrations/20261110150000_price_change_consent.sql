create table public.subscription_price_changes(
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions on delete cascade,
  tenant_id uuid not null references public.tenants on delete cascade,
  old_price_kzt int not null check(old_price_kzt>=0),
  old_period_months int not null check(old_period_months between 1 and 36),
  new_price_kzt int not null check(new_price_kzt>=0),
  new_period_months int not null check(new_period_months between 1 and 36),
  effective_at timestamptz not null,
  status text not null default 'pending' check(status in ('pending','accepted','declined','superseded')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  responded_by uuid,
  applied_at timestamptz
);
create index subscription_price_changes_tenant on public.subscription_price_changes(tenant_id,status,created_at desc);
alter table public.subscription_price_changes enable row level security;
revoke all on public.subscription_price_changes from public,anon,authenticated;

create or replace function public.propose_subscription_price_changes()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.price_kzt is distinct from old.price_kzt or new.period_months is distinct from old.period_months then
    update public.subscription_price_changes set status='superseded'
      where status='pending' and subscription_id in (select id from public.subscriptions where plan_id=new.id);
    insert into public.subscription_price_changes(subscription_id,tenant_id,old_price_kzt,old_period_months,new_price_kzt,new_period_months,effective_at)
    select s.id,s.tenant_id,s.price_kzt,s.price_period_months,new.price_kzt,new.period_months,
      greatest(now()+interval '30 days',coalesce(s.ends_at,now()+interval '30 days'))
    from public.subscriptions s where s.plan_id=new.id and s.status in ('trial','active','grace');
  end if;
  return new;
end $$;
create trigger plans_propose_price_change after update of price_kzt,period_months on public.plans
for each row execute function public.propose_subscription_price_changes();

create or replace function public.owner_pending_price_change(p_slug text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare t uuid; result jsonb;
begin
  select id into t from public.tenants where slug=p_slug;
  if t is null or public.member_role(t) is distinct from 'owner' then raise exception 'forbidden'; end if;
  select jsonb_agg(jsonb_build_object('id',c.id,'old_price_kzt',c.old_price_kzt,'old_period_months',c.old_period_months,
    'new_price_kzt',c.new_price_kzt,'new_period_months',c.new_period_months,'effective_at',c.effective_at,'created_at',c.created_at)
    order by c.created_at desc) into result
  from public.subscription_price_changes c join public.subscriptions s on s.id=c.subscription_id
  where c.tenant_id=t and c.status='pending' and s.status in ('trial','active','grace');
  return coalesce(result,'[]'::jsonb);
end $$;

create or replace function public.owner_respond_price_change(p_slug text,p_id uuid,p_accept boolean) returns void
language plpgsql security definer set search_path=public as $$
declare t uuid; c public.subscription_price_changes; actor uuid:=auth.uid();
begin
  select id into t from public.tenants where slug=p_slug;
  if t is null or public.member_role(t) is distinct from 'owner' then raise exception 'forbidden'; end if;
  select * into c from public.subscription_price_changes where id=p_id and tenant_id=t and status='pending' for update;
  if not found then raise exception 'not_found'; end if;
  if p_accept then
    update public.subscription_price_changes set status='accepted',responded_at=now(),responded_by=actor where id=c.id;
    insert into public.subscription_events(subscription_id,type,payload,actor_id)
      values(c.subscription_id,'price_change_accepted',jsonb_build_object('previous_price',c.old_price_kzt,'new_price',c.new_price_kzt,'effective_at',c.effective_at),actor);
  else
    update public.subscription_price_changes set status='declined',responded_at=now(),responded_by=actor where id=c.id;
    insert into public.subscription_events(subscription_id,type,payload,actor_id)
      values(c.subscription_id,'price_change_declined',jsonb_build_object('proposed_price',c.new_price_kzt),actor);
  end if;
end $$;
create or replace function public.platform_apply_accepted_price_changes() returns int
language plpgsql security definer set search_path=public as $$
declare n int;
begin
  with due as (
    select c.id,c.subscription_id,c.new_price_kzt,c.new_period_months from public.subscription_price_changes c
    where c.status='accepted' and c.applied_at is null and c.effective_at<=now() for update skip locked
  ), updated as (
    update public.subscriptions s set price_kzt=d.new_price_kzt,price_period_months=d.new_period_months
    from due d where s.id=d.subscription_id returning d.id
  ), marked as (
    update public.subscription_price_changes c set applied_at=now() from updated u where c.id=u.id returning c.id
  ) select count(*) into n from marked;
  return n;
end $$;
revoke all on function public.platform_apply_accepted_price_changes() from public,anon,authenticated;
grant execute on function public.platform_apply_accepted_price_changes() to service_role;
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('platform-apply-accepted-price-changes','*/10 * * * *','select public.platform_apply_accepted_price_changes()');
  end if;
exception when unique_violation then null; end $$;
revoke all on function public.owner_pending_price_change(text),public.owner_respond_price_change(text,uuid,boolean) from public,anon;
grant execute on function public.owner_pending_price_change(text),public.owner_respond_price_change(text,uuid,boolean) to authenticated,service_role;

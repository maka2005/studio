alter table public.subscriptions add column nonrenew_at timestamptz;

create or replace function public.owner_subscription(p_slug text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare t uuid; s public.subscriptions; p public.plans; ph text;
begin
  select id into t from public.tenants where slug=p_slug;
  if t is null or public.member_role(t) is null then raise exception 'forbidden'; end if;
  select * into s from public.subscriptions where tenant_id=t order by (status in ('trial','active','grace','suspended')) desc,created_at desc limit 1;
  if not found then return jsonb_build_object('state','open','phase','none'); end if;
  select * into p from public.plans where id=s.plan_id;
  ph:=public.subscription_phase(s.status,s.starts_at,s.ends_at,s.grace_ends_at);
  return jsonb_build_object('state',public.tenant_access_state(t),'phase',ph,'plan_code',p.code,'plan_name',p.name,
    'price_kzt',s.price_kzt,'price_period_months',s.price_period_months,'starts_at',s.starts_at,'ends_at',s.ends_at,
    'grace_ends_at',s.grace_ends_at,'nonrenew_at',s.nonrenew_at,
    'days_left',case when s.ends_at is null then null else greatest(0,ceil(extract(epoch from (s.ends_at-now()))/86400)::int) end);
end $$;

create or replace function public.owner_pending_price_change(p_slug text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare t uuid; result jsonb;
begin
  select id into t from public.tenants where slug=p_slug;
  if t is null or public.member_role(t) is null then raise exception 'forbidden'; end if;
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
    insert into public.subscription_events(subscription_id,type,payload,actor_id) values(c.subscription_id,'price_change_accepted',jsonb_build_object('old_price',c.old_price_kzt,'new_price',c.new_price_kzt,'effective_at',c.effective_at),actor);
  else
    update public.subscription_price_changes set status='declined',responded_at=now(),responded_by=actor where id=c.id;
    update public.subscriptions set nonrenew_at=c.effective_at where id=c.subscription_id;
    insert into public.subscription_events(subscription_id,type,payload,actor_id) values(c.subscription_id,'price_change_declined',jsonb_build_object('old_price',c.old_price_kzt,'proposed_price',c.new_price_kzt,'nonrenew_at',c.effective_at),actor);
    insert into public.platform_audit_logs(actor_id,action,tenant_id,payload) values(actor,'price_change.declined',t,jsonb_build_object('subscription_id',c.subscription_id,'old_price',c.old_price_kzt,'new_price',c.new_price_kzt,'effective_at',c.effective_at));
  end if;
end $$;
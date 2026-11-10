-- Subscription pricing notices are visible to organization owners and managers only.
create or replace function public.owner_pending_price_change(p_slug text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare t uuid; actor uuid:=auth.uid(); result jsonb;
begin
  select id into t from public.tenants where slug=p_slug;
  if t is null or coalesce(public.member_role(t) not in ('owner','manager'),true) then raise exception 'forbidden'; end if;
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
  if t is null or coalesce(public.member_role(t) not in ('owner','manager'),true) then raise exception 'forbidden'; end if;
  insert into public.owner_notification_reads(price_change_id,user_id)
  select c.id,actor from public.subscription_price_changes c where c.tenant_id=t and c.status='pending' and c.id=any(coalesce(p_ids,'{}'::uuid[]))
  on conflict(price_change_id,user_id) do nothing;
end $$;

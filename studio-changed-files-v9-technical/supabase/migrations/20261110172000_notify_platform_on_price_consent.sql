-- The platform must see both possible responses to a proposed price change.
-- Without the accepted branch, an administrator only learned about refusals.
create or replace function public.owner_respond_price_change(p_slug text,p_id uuid,p_accept boolean) returns void
language plpgsql security definer set search_path=public as $$
declare t uuid; c public.subscription_price_changes; actor uuid:=auth.uid();
begin
  select id into t from public.tenants where slug=p_slug;
  if t is null or public.member_role(t) is distinct from 'owner' then raise exception 'forbidden'; end if;

  select * into c
  from public.subscription_price_changes
  where id=p_id and tenant_id=t and status='pending'
  for update;
  if not found then raise exception 'not_found'; end if;

  if p_accept then
    update public.subscription_price_changes
      set status='accepted', responded_at=now(), responded_by=actor
      where id=c.id;
    insert into public.subscription_events(subscription_id,type,payload,actor_id)
      values(c.subscription_id,'price_change_accepted',jsonb_build_object(
        'old_price',c.old_price_kzt,'new_price',c.new_price_kzt,'effective_at',c.effective_at
      ),actor);
    insert into public.platform_audit_logs(actor_id,action,tenant_id,payload)
      values(actor,'price_change.accepted',t,jsonb_build_object(
        'subscription_id',c.subscription_id,'old_price',c.old_price_kzt,
        'new_price',c.new_price_kzt,'effective_at',c.effective_at
      ));
  else
    update public.subscription_price_changes
      set status='declined', responded_at=now(), responded_by=actor
      where id=c.id;
    update public.subscriptions set nonrenew_at=c.effective_at where id=c.subscription_id;
    insert into public.subscription_events(subscription_id,type,payload,actor_id)
      values(c.subscription_id,'price_change_declined',jsonb_build_object(
        'old_price',c.old_price_kzt,'proposed_price',c.new_price_kzt,'nonrenew_at',c.effective_at
      ),actor);
    insert into public.platform_audit_logs(actor_id,action,tenant_id,payload)
      values(actor,'price_change.declined',t,jsonb_build_object(
        'subscription_id',c.subscription_id,'old_price',c.old_price_kzt,
        'new_price',c.new_price_kzt,'effective_at',c.effective_at
      ));
  end if;
end $$;

revoke all on function public.owner_respond_price_change(text,uuid,boolean) from public,anon;
grant execute on function public.owner_respond_price_change(text,uuid,boolean) to authenticated,service_role;

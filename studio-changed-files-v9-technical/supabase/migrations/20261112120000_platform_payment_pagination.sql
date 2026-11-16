drop function if exists public.platform_list_payments(uuid,text,integer);
create function public.platform_list_payments(
  p_actor uuid,
  p_status text default null,
  p_limit int default 51,
  p_offset int default 0
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.platform_assert(p_actor);
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.received_at desc,x.id desc) from (
    select pay.id,pay.tenant_id,t.slug,t.config->>'name' as name,pay.subscription_id,pay.amount_kzt,
      pay.period_start,pay.period_end,pay.method,pay.status,pay.received_at,pay.confirmed_by,pay.refund_reason,pay.note
    from public.saas_payments pay join public.tenants t on t.id=pay.tenant_id
    where p_status is null or pay.status=p_status
    order by pay.received_at desc,pay.id desc
    limit least(greatest(p_limit,1),201) offset greatest(p_offset,0)
  ) x),'[]'::jsonb);
end $$;
revoke all on function public.platform_list_payments(uuid,text,int,int) from public,anon,authenticated;
grant execute on function public.platform_list_payments(uuid,text,int,int) to service_role;

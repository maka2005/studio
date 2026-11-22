-- Manual payment requests: an owner asks for a bank-transfer subscription,
-- a platform admin confirms receipt, and the subscription is activated.
-- No payment gateway or card data is involved.

alter table public.saas_payments
  add column if not exists plan_code text,
  add column if not exists period_months integer;

alter table public.saas_payments
  drop constraint if exists saas_payments_period_months_chk;
alter table public.saas_payments
  add constraint saas_payments_period_months_chk
  check (period_months is null or period_months between 1 and 36);

-- Plans an owner can request. Never expose LEGACY (free service plan).
create or replace function public.owner_available_plans()
returns jsonb
language plpgsql stable security definer
set search_path=public
as $$
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', code, 'name', name, 'price_kzt', price_kzt,
      'period_months', period_months, 'description', description
    ) order by sort_order)
    from public.plans
    where is_active and code <> 'LEGACY'
  ), '[]'::jsonb);
end $$;

revoke all on function public.owner_available_plans() from public, anon;
grant execute on function public.owner_available_plans() to authenticated, service_role;

-- Owner creates a pending payment request with a frozen plan/period snapshot.
create or replace function public.owner_request_manual_payment(
  p_slug text,
  p_plan_code text,
  p_months integer,
  p_idempotency_key text,
  p_note text default null
) returns jsonb
language plpgsql security definer
set search_path=public
as $$
declare
  v_tenant uuid;
  v_plan public.plans;
  v_sub_end timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_amount integer;
  v_fingerprint text;
  v_existing public.saas_payments;
  v_id uuid;
begin
  v_tenant := public.owner_tenant(p_slug);
  if public.owner_access(p_slug) <> 'owner' then raise exception 'forbidden'; end if;
  if length(coalesce(p_idempotency_key, '')) not between 8 and 128 then raise exception 'bad_idempotency_key'; end if;
  if p_months is null or p_months not in (1,3,6,12) then raise exception 'bad_period'; end if;

  select * into v_plan
  from public.plans
  where code = upper(btrim(coalesce(p_plan_code, ''))) and is_active and code <> 'LEGACY';
  if not found then raise exception 'plan_not_found'; end if;

  v_amount := v_plan.price_kzt * p_months;
  if v_amount is null or v_amount <= 0 or v_amount > 100000000 then raise exception 'bad_amount'; end if;

  select s.ends_at into v_sub_end
  from public.subscriptions s
  where s.tenant_id = v_tenant
  order by (s.status in ('trial','active','grace','scheduled')) desc, s.created_at desc
  limit 1;
  v_start := greatest(now(), coalesce(v_sub_end, now()));
  v_end := v_start + make_interval(months => p_months);

  v_fingerprint := md5(jsonb_build_object(
    'tenant', v_tenant, 'plan', v_plan.code, 'months', p_months,
    'amount', v_amount, 'actor', auth.uid()
  )::text);

  select * into v_existing from public.saas_payments where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.tenant_id <> v_tenant
       or v_existing.created_by is distinct from auth.uid()
       or v_existing.idempotency_key <> p_idempotency_key
       or v_existing.plan_code is distinct from v_plan.code
       or v_existing.period_months is distinct from p_months then
      raise exception 'idempotency_conflict';
    end if;
    return jsonb_build_object(
      'id', v_existing.id, 'status', v_existing.status,
      'amount_kzt', v_existing.amount_kzt, 'replayed', true
    );
  end if;

  insert into public.saas_payments(
    tenant_id, subscription_id, amount_kzt, period_start, period_end, method,
    status, received_at, note, created_by, request_fingerprint, idempotency_key,
    plan_code, period_months
  )
  select v_tenant, s.id, v_amount, v_start, v_end, 'transfer', 'pending', now(),
    format('Заявка владельца: %s × %s мес.%s', v_plan.code, p_months,
      case when nullif(btrim(coalesce(p_note, '')), '') is null then ''
           else '. ' || btrim(p_note) end),
    auth.uid(), v_fingerprint, p_idempotency_key, v_plan.code, p_months
  from (select id from public.subscriptions where tenant_id = v_tenant
        order by (status in ('trial','active','grace','scheduled')) desc, created_at desc
        limit 1) s
  returning id into v_id;

  if v_id is null then raise exception 'subscription_not_found'; end if;

  insert into public.platform_audit_logs(actor_id, action, tenant_id, payload)
  values (auth.uid(), 'owner.manual_payment_requested', v_tenant,
    jsonb_build_object('payment_id', v_id, 'plan_code', v_plan.code,
      'months', p_months, 'amount_kzt', v_amount));

  return jsonb_build_object(
    'id', v_id, 'status', 'pending', 'amount_kzt', v_amount,
    'period_start', v_start, 'period_end', v_end
  );
end $$;

revoke all on function public.owner_request_manual_payment(text,text,integer,text,text)
  from public, anon;
grant execute on function public.owner_request_manual_payment(text,text,integer,text,text)
  to authenticated, service_role;

-- Confirmation now activates the requested plan/period. Existing admin-created
-- payments (plan_code is null) keep their previous behaviour.
create or replace function public.platform_confirm_payment(p_actor uuid, p_payment uuid)
returns jsonb
language plpgsql security definer
set search_path=public
as $$
declare
  pay public.saas_payments;
  s public.subscriptions;
  pl public.plans;
  v_grace int;
  v_end timestamptz;
begin
  perform public.platform_assert(p_actor);
  select * into pay from public.saas_payments where id = p_payment for update;
  if not found then raise exception 'not_found'; end if;
  if pay.status = 'paid' then
    return jsonb_build_object('id', pay.id, 'status', 'paid', 'replayed', true);
  end if;
  if pay.status <> 'pending' then raise exception 'bad_status'; end if;

  if pay.plan_code is not null then
    select * into pl from public.plans where code = upper(pay.plan_code) and is_active;
    if not found then raise exception 'plan_not_found'; end if;
  end if;

  update public.saas_payments set status='paid', confirmed_by=p_actor where id=pay.id;

  if pay.subscription_id is not null then
    perform public.platform_sub_event(pay.subscription_id, 'payment_confirmed',
      jsonb_build_object('payment_id', pay.id, 'amount_kzt', pay.amount_kzt), p_actor);

    if pay.plan_code is not null then
      select * into s from public.subscriptions where id = pay.subscription_id for update;
      if found then
        v_grace := public.platform_setting_int('grace_days', 5);
        v_end := greatest(pay.period_end, coalesce(s.ends_at, pay.period_end));
        update public.subscriptions
        set plan_id = pl.id,
            status = case when s.status in ('expired','grace','suspended') then 'active' else s.status end,
            ends_at = v_end,
            grace_ends_at = v_end + make_interval(days => v_grace)
        where id = s.id;

        if s.plan_id is distinct from pl.id then
          perform public.platform_sub_event(s.id, 'plan_changed',
            jsonb_build_object('from_plan_id', s.plan_id, 'to', pl.code, 'payment_id', pay.id), p_actor);
        end if;
        perform public.platform_sub_event(s.id, 'extended',
          jsonb_build_object('from', s.ends_at, 'to', v_end, 'payment_id', pay.id), p_actor);
      end if;
    end if;
  end if;

  perform public.platform_log(p_actor, 'payment.confirm', pay.tenant_id,
    jsonb_build_object('payment_id', pay.id, 'amount_kzt', pay.amount_kzt,
      'plan_code', pay.plan_code, 'period_months', pay.period_months));
  return jsonb_build_object('id', pay.id, 'status', 'paid',
    'subscription_id', pay.subscription_id, 'ends_at', v_end);
end $$;

-- Show the request snapshot in the admin queue and owner history.
create or replace function public.platform_list_payments(
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
      pay.period_start,pay.period_end,pay.method,pay.status,pay.received_at,pay.confirmed_by,
      pay.refund_reason,pay.note,pay.plan_code,pay.period_months,pay.created_by,pay.created_at
    from public.saas_payments pay join public.tenants t on t.id=pay.tenant_id
    where p_status is null or pay.status=p_status
    order by pay.received_at desc,pay.id desc
    limit least(greatest(p_limit,1),201) offset greatest(p_offset,0)
  ) x),'[]'::jsonb);
end $$;

create or replace function public.owner_payments(p_slug text)
returns jsonb
language plpgsql stable security definer
set search_path=public
set statement_timeout='5s'
as $$
declare
  v_tenant uuid := public.owner_tenant(p_slug);
begin
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.received_at desc)
    from (
      select id, amount_kzt, method, status, received_at, period_start, period_end,
             note, refund_reason, created_at, plan_code, period_months
      from public.saas_payments
      where tenant_id = v_tenant
      order by received_at desc
      limit 200
    ) x
  ), '[]'::jsonb);
end $$;

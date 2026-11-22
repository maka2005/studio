-- Воронка Renvio: события, атрибуция и CRM-статусы заявок.
-- События пишутся в отдельную таблицу с идемпотентностью; платёж и первая запись
-- фиксируются триггерами, чтобы не зависеть от вызовов клиента.

alter table public.platform_business_leads
  add column if not exists attribution jsonb not null default '{}'::jsonb,
  add column if not exists funnel_session_id text not null default '';

-- Старые статусы остаются допустимыми для совместимости с уже сохранёнными данными.
alter table public.platform_business_leads drop constraint if exists platform_business_leads_status_check;
alter table public.platform_business_leads add constraint platform_business_leads_status_check
  check (status in ('new','demo','talk','invoice','paid','active','churned','contacted','converted','closed'));

update public.platform_business_leads set status='talk' where status='contacted';
update public.platform_business_leads set status='active' where status='converted';
update public.platform_business_leads set status='churned' where status='closed';

create index if not exists platform_business_leads_source_idx
  on public.platform_business_leads((attribution->>'source'), created_at desc);

create table if not exists public.platform_funnel_events(
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  event_name text not null check (event_name in
    ('demo_start','lead_submit','connect','payment_request','payment_confirm','first_booking')),
  session_id text not null default '',
  lead_id uuid references public.platform_business_leads(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete set null,
  attribution jsonb not null default '{}'::jsonb,
  props jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 200),
  created_at timestamptz not null default now());

create index if not exists platform_funnel_events_name_time_idx
  on public.platform_funnel_events(event_name, occurred_at desc);
create index if not exists platform_funnel_events_session_idx
  on public.platform_funnel_events(session_id, occurred_at desc);

alter table public.platform_funnel_events enable row level security;
revoke all on public.platform_funnel_events from public, anon, authenticated;
grant all on public.platform_funnel_events to service_role;

-- Единая точка записи событий: только service_role (вызывается из Edge).
create or replace function public.platform_track_event(
  p_name text, p_session text, p_lead uuid, p_tenant uuid,
  p_attribution jsonb, p_props jsonb, p_idempotency text) returns void
language plpgsql security definer set search_path=public as $$
begin
  if p_name not in ('demo_start','lead_submit','connect','payment_request','payment_confirm','first_booking') then
    raise exception 'bad_event';
  end if;
  if length(coalesce(p_idempotency,'')) not between 8 and 200 then raise exception 'bad_request'; end if;
  insert into public.platform_funnel_events(
    event_name, session_id, lead_id, tenant_id, attribution, props, idempotency_key)
  values (
    p_name,
    left(coalesce(p_session,''), 80),
    p_lead,
    p_tenant,
    case when jsonb_typeof(p_attribution)='object' then p_attribution else '{}'::jsonb end,
    case when jsonb_typeof(p_props)='object' then p_props else '{}'::jsonb end,
    p_idempotency)
  on conflict (idempotency_key) do nothing;
end $$;

revoke all on function public.platform_track_event(text,text,uuid,uuid,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.platform_track_event(text,text,uuid,uuid,jsonb,jsonb,text) to service_role;

-- Сводка по воронке для админки.
create or replace function public.platform_funnel_summary(p_actor uuid, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.platform_assert(p_actor);
  return coalesce((
    select jsonb_object_agg(event_name, cnt)
    from (
      select event_name, count(*)::int as cnt
      from public.platform_funnel_events
      where occurred_at >= now() - make_interval(days => least(greatest(coalesce(p_days,30),1),365))
      group by event_name
    ) s
  ), '{}'::jsonb);
end $$;

-- Последние события для админки.
create or replace function public.platform_funnel_events_list(p_actor uuid, p_limit int default 20, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_count int; v_rows jsonb;
begin
  perform public.platform_assert(p_actor);
  select count(*)::int into v_count from public.platform_funnel_events;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
    select id, occurred_at, event_name, session_id, lead_id, tenant_id, attribution, props
    from public.platform_funnel_events
    order by occurred_at desc
    limit least(greatest(coalesce(p_limit,20),1),100) offset greatest(coalesce(p_offset,0),0)
  ) x;
  return jsonb_build_object('rows', v_rows, 'count', v_count);
end $$;

revoke all on function public.platform_funnel_summary(uuid,integer) from public, anon, authenticated;
grant execute on function public.platform_funnel_summary(uuid,integer) to service_role;
revoke all on function public.platform_funnel_events_list(uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.platform_funnel_events_list(uuid,integer,integer) to service_role;

-- Атрибуция исходной заявки организации, чтобы платежи и записи наследовали канал.
create or replace function public.funnel_lead_context(p_tenant uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  select coalesce((
    select jsonb_build_object('attribution', attribution, 'session_id', funnel_session_id, 'lead_id', id)
    from public.platform_business_leads
    where tenant_id = p_tenant
    order by created_at desc
    limit 1
  ), '{}'::jsonb)
$$;

revoke all on function public.funnel_lead_context(uuid) from public, anon, authenticated;
grant execute on function public.funnel_lead_context(uuid) to service_role;

-- Платёж: заявка на оплату и подтверждение попадают в воронку сами.
create or replace function public.funnel_saas_payment_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare ctx jsonb := public.funnel_lead_context(NEW.tenant_id);
begin
  if TG_OP = 'INSERT' and NEW.status = 'pending' then
    perform public.platform_track_event(
      'payment_request', coalesce(ctx->>'session_id',''),
      (ctx->>'lead_id')::uuid, NEW.tenant_id, coalesce(ctx->'attribution','{}'::jsonb),
      jsonb_build_object('payment_id', NEW.id, 'amount_kzt', NEW.amount_kzt, 'method', NEW.method),
      'payment_request:' || NEW.id::text);
    update public.platform_business_leads set status='invoice', updated_at=now()
      where id = (ctx->>'lead_id')::uuid and status in ('new','demo','talk');
  elsif TG_OP = 'UPDATE' and NEW.status = 'paid' and OLD.status <> 'paid' then
    perform public.platform_track_event(
      'payment_confirm', coalesce(ctx->>'session_id',''),
      (ctx->>'lead_id')::uuid, NEW.tenant_id, coalesce(ctx->'attribution','{}'::jsonb),
      jsonb_build_object('payment_id', NEW.id, 'amount_kzt', NEW.amount_kzt),
      'payment_confirm:' || NEW.id::text);
    update public.platform_business_leads set status='paid', updated_at=now()
      where id = (ctx->>'lead_id')::uuid and status in ('new','demo','talk','invoice');
  end if;
  return null;
end $$;

drop trigger if exists funnel_saas_payment_event on public.saas_payments;
create trigger funnel_saas_payment_event
  after insert or update of status on public.saas_payments
  for each row execute function public.funnel_saas_payment_event();

-- Первая запись клиента в организации = активация сервиса.
create or replace function public.funnel_first_booking_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare ctx jsonb;
begin
  if exists (select 1 from public.bookings where tenant_id = NEW.tenant_id and id <> NEW.id) then
    return null;
  end if;
  ctx := public.funnel_lead_context(NEW.tenant_id);
  perform public.platform_track_event(
    'first_booking', coalesce(ctx->>'session_id',''),
    (ctx->>'lead_id')::uuid, NEW.tenant_id, coalesce(ctx->'attribution','{}'::jsonb),
    jsonb_build_object('booking_id', NEW.id, 'source', NEW.source),
    'first_booking:' || NEW.id::text);
  update public.platform_business_leads set status='active', updated_at=now()
    where id = (ctx->>'lead_id')::uuid and status in ('new','demo','talk','invoice','paid');
  return null;
end $$;

drop trigger if exists funnel_first_booking_event on public.bookings;
create trigger funnel_first_booking_event
  after insert on public.bookings
  for each row execute function public.funnel_first_booking_event();

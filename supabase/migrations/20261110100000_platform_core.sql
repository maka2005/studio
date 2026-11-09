-- Servio platform, stage 1: tables, RLS, access-state logic.
-- Единственное изменение существующей таблицы — необязательная дата создания.

alter table public.tenants add column if not exists created_at timestamptz;
alter table public.tenants alter column created_at set default now();

-- ---------------------------------------------------------------- tables
create table public.platform_admins(
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now());

create table public.plans(
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_]{2,20}$'),
  name text not null check (length(name) between 1 and 80),
  description text,
  price_kzt int not null check (price_kzt >= 0),
  period_months int not null default 1 check (period_months between 1 and 36),
  features jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  sort_order int not null default 100);

create table public.subscriptions(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants on delete restrict,
  plan_id uuid not null references public.plans,
  status text not null check (status in ('trial','active','grace','suspended','cancelled','expired')),
  starts_at timestamptz not null,
  ends_at timestamptz,            -- null = бессрочная (legacy-организации)
  grace_ends_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at));
-- у организации не может быть двух «открытых» подписок одновременно
create unique index subscriptions_one_open on public.subscriptions(tenant_id)
  where status in ('trial','active','grace','suspended');
create index subscriptions_tenant_idx on public.subscriptions(tenant_id, created_at desc);
create index subscriptions_ends_idx on public.subscriptions(ends_at);

create table public.subscription_events(
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now());
create index subscription_events_sub_idx on public.subscription_events(subscription_id, created_at desc);

create table public.saas_payments(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants on delete restrict,
  subscription_id uuid references public.subscriptions,
  amount_kzt int not null check (amount_kzt > 0),
  period_start timestamptz not null,
  period_end timestamptz not null check (period_end > period_start),
  method text not null check (method in ('cash','kaspi','transfer','card','other')),
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  received_at timestamptz not null default now(),
  confirmed_by uuid,
  refund_reason text,
  note text,
  created_by uuid,
  request_fingerprint text not null,
  created_at timestamptz not null default now(),
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 128));
create index saas_payments_tenant_idx on public.saas_payments(tenant_id, received_at desc);
create index saas_payments_status_idx on public.saas_payments(status, received_at);

create table public.platform_audit_logs(
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  tenant_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now());
create index platform_audit_tenant_idx on public.platform_audit_logs(tenant_id, created_at desc);
create index platform_audit_created_idx on public.platform_audit_logs(created_at desc);

create table public.platform_settings(
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now());

-- ключи идемпотентности для критичных операций (создание организации, смена статуса и т.д.)
create table public.platform_requests(
  idempotency_key text primary key check (length(idempotency_key) between 8 and 128),
  action text not null,
  actor_id uuid,
  request_fingerprint text not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now());

-- ---------------------------------------------------------------- RLS: прямого доступа нет ни у кого, кроме service_role
alter table public.platform_admins enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_events enable row level security;
alter table public.saas_payments enable row level security;
alter table public.platform_audit_logs enable row level security;
alter table public.platform_settings enable row level security;
alter table public.platform_requests enable row level security;
revoke all on public.platform_admins, public.plans, public.subscriptions, public.subscription_events,
  public.saas_payments, public.platform_audit_logs, public.platform_settings, public.platform_requests
  from public, anon, authenticated;
-- политик намеренно нет: authenticated/anon не видят строк даже при случайном GRANT.

-- ---------------------------------------------------------------- начальные данные
insert into public.plans(code,name,description,price_kzt,period_months,features,is_active,sort_order) values
 ('START','START','Онлайн-запись, кабинет, Telegram-уведомления, отзывы',15000,1,
  '["Онлайн-запись","Кабинет владельца","Telegram-уведомления","Отзывы"]',true,10),
 ('PRO','PRO','Всё из START и расширенные отчёты',25000,1,
  '["Всё из START","Расширенные отчёты"]',true,20),
 ('LEGACY','Legacy (без оплаты)','Служебный тариф для организаций, существовавших до запуска платформы',0,1,
  '["Все текущие функции"]',false,900)
on conflict(code) do nothing;

insert into public.platform_settings(key,value) values
 ('trial_days','14'::jsonb),('grace_days','5'::jsonb),('timezone','"Asia/Aqtobe"'::jsonb)
on conflict(key) do nothing;

-- Существующие организации (graphite) получают бессрочную подписку, чтобы ничего не закрылось.
insert into public.subscriptions(tenant_id,plan_id,status,starts_at,ends_at,grace_ends_at)
select t.id,(select id from public.plans where code='LEGACY'),'active',now(),null,null
from public.tenants t
where not exists(select 1 from public.subscriptions s where s.tenant_id=t.id);
insert into public.subscription_events(subscription_id,type,payload)
select s.id,'legacy_migrated','{"note":"existing tenant before platform launch"}'::jsonb
from public.subscriptions s join public.plans p on p.id=s.plan_id and p.code='LEGACY'
where not exists(select 1 from public.subscription_events e where e.subscription_id=s.id);

-- ---------------------------------------------------------------- проверки и логика доступа
create or replace function public.is_platform_admin(p_user uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select p_user is not null and exists(select 1 from public.platform_admins where user_id=p_user) $$;

create or replace function public.platform_assert(p_actor uuid) returns void
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_platform_admin(p_actor) then raise exception 'forbidden'; end if;
end $$;

create or replace function public.platform_setting_int(p_key text,p_default int) returns int
language sql stable security definer set search_path=public as $$
  select coalesce((select (value #>> '{}')::int from public.platform_settings where key=p_key),p_default) $$;

-- Фактическая фаза подписки считается по датам, а не только по сохранённому статусу:
-- доступ закрывается вовремя, даже если ночная синхронизация не успела сработать.
create or replace function public.subscription_phase(p_status text,p_starts timestamptz,p_ends timestamptz,p_grace timestamptz)
returns text language sql stable as $$
  select case
    when p_status in ('suspended','cancelled','expired') then p_status
    when now() < p_starts then 'scheduled'
    when p_ends is null or now() < p_ends then case when p_status='trial' then 'trial' else 'active' end
    when now() < coalesce(p_grace,p_ends) then 'grace'
    else 'expired' end $$;

-- open: полный доступ | grace: полный доступ + предупреждение | closed: запись и уведомления выключены
-- Организация без единой подписки считается open (обратная совместимость).
create or replace function public.tenant_access_state(p_tenant uuid) returns text
language plpgsql stable security definer set search_path=public as $$
declare s public.subscriptions; ph text;
begin
  select * into s from public.subscriptions where tenant_id=p_tenant
    order by (status in ('trial','active','grace','suspended')) desc, created_at desc limit 1;
  if not found then return 'open'; end if;
  ph := public.subscription_phase(s.status,s.starts_at,s.ends_at,s.grace_ends_at);
  return case when ph in ('trial','active') then 'open' when ph='grace' then 'grace' else 'closed' end;
end $$;

create or replace function public.tenant_booking_open(p_slug text) returns boolean
language sql stable security definer set search_path=public as $$
  select coalesce((select public.tenant_access_state(t.id)<>'closed' from public.tenants t where t.slug=p_slug),true) $$;  -- неизвестный slug: решает вызывающий код (not_found)

create or replace function public.tenant_notifications_open(p_tenant uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select public.tenant_access_state(p_tenant)<>'closed' $$;

-- Для кабинета владельца: статус подписки своей организации (любой участник).
create or replace function public.owner_subscription(p_slug text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare t uuid; s public.subscriptions; p public.plans; ph text;
begin
  select id into t from public.tenants where slug=p_slug;
  if t is null or public.member_role(t) is null then raise exception 'forbidden'; end if;
  select * into s from public.subscriptions where tenant_id=t
    order by (status in ('trial','active','grace','suspended')) desc, created_at desc limit 1;
  if not found then return jsonb_build_object('state','open','phase','none'); end if;
  select * into p from public.plans where id=s.plan_id;
  ph := public.subscription_phase(s.status,s.starts_at,s.ends_at,s.grace_ends_at);
  return jsonb_build_object('state',public.tenant_access_state(t),'phase',ph,
    'plan_code',p.code,'plan_name',p.name,'price_kzt',p.price_kzt,
    'starts_at',s.starts_at,'ends_at',s.ends_at,'grace_ends_at',s.grace_ends_at,
    'days_left',case when s.ends_at is null then null else ceil(extract(epoch from (s.ends_at-now()))/86400)::int end);
end $$;

-- Защита на уровне БД: клиентская запись в организацию с закрытым доступом невозможна,
-- даже если вызвать функции напрямую. Участники организации (владелец/менеджер) не затрагиваются.
create or replace function public.bookings_subscription_guard() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if public.tenant_access_state(new.tenant_id)='closed' and not public.is_member(new.tenant_id) then
    raise exception 'booking_closed';
  end if;
  return new;
end $$;
drop trigger if exists bookings_subscription_guard on public.bookings;
create trigger bookings_subscription_guard before insert on public.bookings
  for each row execute function public.bookings_subscription_guard();

-- Отдельный счётчик лимитов для платформы: существующую consume_public_rate не трогаем.
create or replace function public.consume_platform_rate(p_scope text,p_key text,p_limit int,p_window int)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_scope not in ('platform_admin','platform_lead','platform_export') or p_key is null or length(p_key)<4
     or p_limit not between 1 and 5000 or p_window not between 1 and 86400 then return false; end if;
  return public.hit_limit('platform:'||p_scope||':'||md5(p_key),p_limit,p_window);
end $$;

-- ---------------------------------------------------------------- права на функции
revoke all on function public.is_platform_admin(uuid), public.platform_assert(uuid),
  public.platform_setting_int(text,int), public.subscription_phase(text,timestamptz,timestamptz,timestamptz),
  public.tenant_access_state(uuid), public.tenant_notifications_open(uuid),
  public.consume_platform_rate(text,text,int,int) from public, anon, authenticated;
grant execute on function public.is_platform_admin(uuid), public.platform_assert(uuid),
  public.platform_setting_int(text,int), public.subscription_phase(text,timestamptz,timestamptz,timestamptz),
  public.tenant_access_state(uuid), public.tenant_notifications_open(uuid),
  public.consume_platform_rate(text,text,int,int) to service_role;
-- публичная страница спрашивает только «открыта ли запись» (boolean, без деталей подписки)
revoke all on function public.tenant_booking_open(text) from public;
grant execute on function public.tenant_booking_open(text) to anon, authenticated, service_role;
revoke all on function public.owner_subscription(text) from public, anon;
grant execute on function public.owner_subscription(text) to authenticated, service_role;

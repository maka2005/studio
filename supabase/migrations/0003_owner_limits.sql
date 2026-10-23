-- Исправление прав: вошедший владелец (роль authenticated) тоже должен видеть публичные данные студии.
grant select on tenants, services to authenticated;
create policy pub_tenants_auth on tenants for select to authenticated using (true);
create policy pub_services_auth on services for select to authenticated using (active or is_member(tenant_id));

-- Общие атомарные счётчики (только service_role)
create table rate_counters(key text not null, window_start timestamptz not null, n int not null default 0, primary key(key, window_start));
create table llm_budget(tenant_id uuid references tenants on delete cascade, day date, tokens int not null default 0, primary key(tenant_id, day));
alter table rate_counters enable row level security; alter table llm_budget enable row level security;
revoke all on rate_counters, llm_budget from anon, authenticated;

create function hit_limit(p_key text, p_limit int, p_window int) returns bool language plpgsql security definer set search_path=public as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window) * p_window); v int;
begin
  delete from rate_counters where window_start < now() - interval '1 day' and random() < 0.01;
  insert into rate_counters(key, window_start, n) values (p_key, w, 1)
  on conflict (key, window_start) do update set n = rate_counters.n + 1 where rate_counters.n < p_limit
  returning n into v;
  return v is not null;
end $$;
create function consume_llm_budget(p_slug text, p_tokens int, p_cap int) returns bool language plpgsql security definer set search_path=public as $$
declare tid uuid; v int; d date := (now() at time zone 'utc')::date;
begin
  select id into tid from tenants where slug = p_slug; if tid is null then return false; end if;
  insert into llm_budget(tenant_id, day, tokens) values (tid, d, p_tokens)
  on conflict (tenant_id, day) do update set tokens = llm_budget.tokens + p_tokens where llm_budget.tokens + p_tokens <= p_cap
  returning tokens into v;
  return v is not null;
end $$;
revoke all on function hit_limit, consume_llm_budget from public, anon, authenticated;
grant execute on function hit_limit, consume_llm_budget to service_role;

-- Не более 5 успешных записей в час на один телефон в студии (счётчик откатывается вместе с неудачной транзакцией).
create function booking_rate() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not hit_limit('book:' || new.tenant_id || ':' || new.customer_phone, 5, 3600) then raise exception 'rate_limited'; end if;
  return new;
end $$;
create trigger bookings_rate before insert on bookings for each row execute function booking_rate();

-- ===== Кабинет владельца: каждая функция проверяет членство на сервере =====
create function owner_tenant(p_slug text) returns uuid language plpgsql stable security definer set search_path=public as $$
declare t uuid;
begin
  select tenants.id into t from tenants where tenants.slug = p_slug;
  if t is null or not is_member(t) then raise exception 'forbidden'; end if;
  return t;
end $$;
create function owner_me(p_slug text) returns bool language sql stable security definer set search_path=public as
$$ select exists(select 1 from tenants t where t.slug = p_slug and is_member(t.id)) $$;

create function owner_bookings(p_slug text, p_from date, p_to date)
returns table(id uuid, service_name text, starts_at timestamptz, ends_at timestamptz, status text, customer_name text,
  customer_phone text, car text, price_cents int, paid_cents int, resource_name text)
language plpgsql stable security definer set search_path=public as $$
#variable_conflict use_column
declare t uuid; tz text;
begin
  t := owner_tenant(p_slug); select tenants.timezone into tz from tenants where tenants.id = t;
  return query select b.id, s.name, b.starts_at, b.ends_at, b.status, b.customer_name, b.customer_phone, b.car, b.price_cents,
    coalesce((select sum(case p.kind when 'payment' then p.amount_cents else -p.amount_cents end) from payments p
      where p.booking_id = b.id and p.tenant_id = t), 0)::int, r.name
  from bookings b join services s on s.tenant_id = b.tenant_id and s.id = b.service_id
    join resources r on r.tenant_id = b.tenant_id and r.id = b.resource_id
  where b.tenant_id = t and b.starts_at >= p_from::timestamp at time zone tz and b.starts_at < (p_to + 1)::timestamp at time zone tz
  order by b.starts_at;
end $$;

-- Заезды, выполненные заказы и полученные деньги считаются раздельно. expected_cents — не выручка.
create function owner_stats(p_slug text, p_from date, p_to date)
returns table(visits int, done int, booked int, received_cents bigint, expected_cents bigint)
language plpgsql stable security definer set search_path=public as $$
#variable_conflict use_column
declare t uuid; tz text; a timestamptz; z timestamptz;
begin
  t := owner_tenant(p_slug); select tenants.timezone into tz from tenants where tenants.id = t;
  a := p_from::timestamp at time zone tz; z := (p_to + 1)::timestamp at time zone tz;
  return query select
    (select count(*) from bookings b where b.tenant_id = t and b.status in ('arrived','done') and b.starts_at >= a and b.starts_at < z)::int,
    (select count(*) from bookings b where b.tenant_id = t and b.status = 'done' and b.starts_at >= a and b.starts_at < z)::int,
    (select count(*) from bookings b where b.tenant_id = t and b.status <> 'cancelled' and b.starts_at >= a and b.starts_at < z)::int,
    coalesce((select sum(case p.kind when 'payment' then p.amount_cents else -p.amount_cents end) from payments p
      where p.tenant_id = t and p.created_at >= a and p.created_at < z), 0)::bigint,
    coalesce((select sum(b.price_cents) from bookings b where b.tenant_id = t and b.status = 'booked' and b.starts_at >= a and b.starts_at < z), 0)::bigint;
end $$;

create function owner_booking_tenant(p_booking uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
  select bookings.tenant_id into t from bookings where bookings.id = p_booking;
  if t is null or not is_member(t) then raise exception 'forbidden'; end if;
  return t;
end $$;

create function owner_set_status(p_booking uuid, p_status text) returns void language plpgsql security definer set search_path=public as $$
declare t uuid; cur text;
begin
  t := owner_booking_tenant(p_booking);
  select bookings.status into cur from bookings where bookings.id = p_booking for update;
  if p_status not in ('arrived','done') or cur in ('cancelled','done') or (p_status = 'arrived' and cur <> 'booked')
    then raise exception 'bad_transition'; end if;
  update bookings set status = p_status where id = p_booking;
end $$;

create function owner_cancel(p_booking uuid) returns void language plpgsql security definer set search_path=public as $$
declare t uuid; cur text;
begin
  t := owner_booking_tenant(p_booking);
  select bookings.status into cur from bookings where bookings.id = p_booking for update;
  if cur = 'cancelled' then return; end if;
  if cur <> 'booked' then raise exception 'bad_transition'; end if;
  update bookings set status = 'cancelled' where id = p_booking;
  delete from resource_occupancies where booking_id = p_booking;
end $$;

-- Перенос атомарен: при ошибке исходная запись и её занятость остаются как были.
create function owner_reschedule(p_booking uuid, p_start timestamptz) returns bool language plpgsql security definer set search_path=public as $$
declare t uuid; b bookings; tn tenants; r record; new_end timestamptz; occ_end timestamptz;
begin
  t := owner_booking_tenant(p_booking);
  select * into b from bookings where bookings.id = p_booking for update;
  if b.status <> 'booked' then raise exception 'bad_transition'; end if;
  select * into tn from tenants where tenants.id = t;
  if p_start < now() then raise exception 'past_start'; end if;
  if not exists(select 1 from get_slots(tn.slug, b.service_id, (p_start at time zone tn.timezone)::date) g where g.slot = p_start)
    then raise exception 'invalid_slot'; end if;
  new_end := p_start + make_interval(mins => b.duration_minutes);   -- длительность: снимок на момент записи
  occ_end := new_end + make_interval(mins => tn.buffer_minutes);
  for r in select rs.id from resources rs where rs.tenant_id = t order by (rs.id <> b.resource_id), rs.name loop
    begin
      update resource_occupancies set resource_id = r.id, during = tstzrange(p_start, occ_end, '[)') where booking_id = b.id;
      update bookings set resource_id = r.id, starts_at = p_start, ends_at = new_end where id = b.id;
      return true;
    exception when exclusion_violation then null;
    end;
  end loop;
  raise exception 'slot_taken';
end $$;

create function owner_create_booking(p_slug text, p_service uuid, p_start timestamptz, p_name text, p_phone text, p_car text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v uuid;
begin
  perform owner_tenant(p_slug);
  select c.booking_id into v from create_booking(p_slug, p_service, p_start, p_name, p_phone, p_car,
    gen_random_uuid()::text, encode(gen_random_bytes(16), 'hex')) c;
  return v;
end $$;

create function owner_block(p_slug text, p_resource uuid, p_start timestamptz, p_end timestamptz) returns uuid
language plpgsql security definer set search_path=public as $$
declare t uuid; v uuid;
begin
  t := owner_tenant(p_slug);
  if p_end <= p_start then raise exception 'bad_range'; end if;
  insert into resource_occupancies(tenant_id, resource_id, kind, during) values (t, p_resource, 'block', tstzrange(p_start, p_end, '[)'))
  returning id into v;  -- пересечение с бронью отклоняет EXCLUDE
  return v;
end $$;
create function owner_unblock(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
  select tenant_id into t from resource_occupancies where id = p_id and kind = 'block';
  if t is null or not is_member(t) then raise exception 'forbidden'; end if;
  delete from resource_occupancies where id = p_id;
end $$;

create function owner_add_payment(p_booking uuid, p_amount int, p_kind text) returns void language plpgsql security definer set search_path=public as $$
declare t uuid; net int;
begin
  t := owner_booking_tenant(p_booking);
  if p_amount <= 0 or p_kind not in ('payment','refund') then raise exception 'bad_amount'; end if;
  perform 1 from bookings where id = p_booking for update;  -- сериализуем платежи по записи
  select coalesce(sum(case kind when 'payment' then amount_cents else -amount_cents end), 0) into net from payments where booking_id = p_booking;
  if p_kind = 'refund' and p_amount > net then raise exception 'refund_exceeds'; end if;
  insert into payments(tenant_id, booking_id, amount_cents, kind) values (t, p_booking, p_amount, p_kind);
end $$;

create function owner_upsert_service(p_slug text, p_id uuid, p_name text, p_price_cents int, p_duration int, p_active bool)
returns uuid language plpgsql security definer set search_path=public as $$
declare t uuid; v uuid;
begin
  t := owner_tenant(p_slug);
  if length(trim(p_name)) = 0 or p_price_cents < 0 or p_duration <= 0 then raise exception 'bad_service'; end if;
  if p_id is null then
    insert into services(tenant_id, name, price_cents, duration_minutes, active) values (t, trim(p_name), p_price_cents, p_duration, p_active) returning id into v;
  else
    update services set name = trim(p_name), price_cents = p_price_cents, duration_minutes = p_duration, active = p_active
    where id = p_id and tenant_id = t returning id into v;   -- старые записи хранят свою цену и длительность
    if v is null then raise exception 'forbidden'; end if;
  end if;
  return v;
end $$;

create function owner_update_config(p_slug text, p_patch jsonb) returns void language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
  t := owner_tenant(p_slug);
  update tenants set config = config || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(p_patch) e
    where e.key in ('phone','address','description','cards','hours','gallery')), '{}'::jsonb) where id = t;
end $$;

revoke all on function owner_tenant, owner_me, owner_bookings, owner_stats, owner_booking_tenant, owner_set_status, owner_cancel,
  owner_reschedule, owner_create_booking, owner_block, owner_unblock, owner_add_payment, owner_upsert_service, owner_update_config from public;
grant execute on function owner_me, owner_bookings, owner_stats, owner_set_status, owner_cancel, owner_reschedule, owner_create_booking,
  owner_block, owner_unblock, owner_add_payment, owner_upsert_service, owner_update_config to authenticated;

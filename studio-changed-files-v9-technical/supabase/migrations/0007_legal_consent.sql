-- Согласие на обработку персональных данных фиксируется в базе вместе с записью (дата и версия документа).
alter table bookings add column consent_at timestamptz;
alter table bookings add column consent_version text;

-- Новая сигнатура create_booking: добавлен p_consent. Без согласия запись не создаётся.
drop function create_booking(text, uuid, timestamptz, text, text, text, text, text);
create function create_booking(p_slug text, p_service uuid, p_start timestamptz,
  p_name text, p_phone text, p_car text, p_key text, p_token text, p_consent text default null)
returns table(booking_id uuid, resource_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql security definer set search_path=public, extensions as $$
declare t tenants; s services; r record; b uuid; e timestamptz; occ_end timestamptz;
begin
  select * into t from tenants where slug=p_slug; if not found then raise exception 'tenant_not_found'; end if;
  select * into s from services where id=p_service and tenant_id=t.id and active; if not found then raise exception 'service_not_found'; end if;
  return query select x.id, x.resource_id, x.starts_at, x.ends_at from bookings x
    where x.tenant_id=t.id and x.idempotency_key=p_key;
  if found then return; end if;
  if p_consent is null or length(trim(p_consent)) = 0 then raise exception 'consent_required'; end if;
  if p_start < now() then raise exception 'past_start'; end if;
  e := p_start + make_interval(mins => s.duration_minutes);
  occ_end := e + make_interval(mins => t.buffer_minutes);
  for r in select id from resources where tenant_id=t.id order by name loop
    begin
      b := gen_random_uuid();
      insert into bookings(id,tenant_id,service_id,resource_id,starts_at,ends_at,price_cents,duration_minutes,
        customer_name,customer_phone,car,token_hash,idempotency_key,consent_at,consent_version)
      values(b,t.id,s.id,r.id,p_start,e,s.price_cents,s.duration_minutes,p_name,p_phone,p_car,
        digest(p_token,'sha256'),p_key,now(),left(trim(p_consent),40));
      insert into resource_occupancies(tenant_id,resource_id,booking_id,kind,during)
      values(t.id,r.id,b,'booking',tstzrange(p_start,occ_end,'[)'));
      return query select b, r.id, p_start, e; return;
    exception when exclusion_violation then null;
    end;
  end loop;
  raise exception 'slot_taken';
end $$;
revoke all on function create_booking(text, uuid, timestamptz, text, text, text, text, text, text) from public;
grant execute on function create_booking(text, uuid, timestamptz, text, text, text, text, text, text) to anon, authenticated;

-- Запись, которую вносит сотрудник студии: согласие клиента получает студия, в базе это помечается как 'staff'.
create or replace function owner_create_booking(p_slug text, p_service uuid, p_start timestamptz, p_name text, p_phone text, p_car text)
returns uuid language plpgsql security definer set search_path=public, extensions as $$
declare v uuid;
begin
  perform owner_tenant(p_slug);
  select c.booking_id into v from create_booking(p_slug, p_service, p_start, p_name, p_phone, p_car,
    gen_random_uuid()::text, encode(gen_random_bytes(16), 'hex'), 'staff') c;
  return v;
end $$;

-- В счётчиках лимитов больше не хранится телефон в открытом виде.
create or replace function booking_rate() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not hit_limit('book:' || new.tenant_id || ':' || md5(new.customer_phone), 5, 3600) then raise exception 'rate_limited'; end if;
  return new;
end $$;

-- Удаление персональных данных клиента из записи (по его просьбе или при отзыве согласия). Сама запись и сумма остаются для учёта.
create function owner_erase_customer(p_booking uuid) returns void language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
  t := owner_booking_tenant(p_booking);
  update bookings set customer_name = 'Удалено', customer_phone = '', car = 'Удалено', user_id = null where id = p_booking;
end $$;
revoke all on function owner_erase_customer from public; grant execute on function owner_erase_customer to authenticated;

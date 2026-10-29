-- Свободные окна: рабочие часы задают моменты приёма (в часовом поясе студии), занятость берётся из resource_occupancies.
-- TODO: исключения/праздничные дни (пока не реализованы).
create function get_slots(p_slug text, p_service uuid, p_day date)
returns table(slot timestamptz, free bool) language plpgsql stable security definer set search_path=public as $$
declare t tenants; s services; h jsonb; k text; ts timestamptz; lim timestamptz; step int; window_minutes int;
begin
  select * into t from tenants where slug=p_slug; if not found then return; end if;
  select * into s from services where id=p_service and tenant_id=t.id and active; if not found then return; end if;
  k := (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from p_day)::int + 1];
  h := t.config->'hours'->k;
  if h is null or jsonb_typeof(h) <> 'array' then return; end if;
  step := coalesce((t.config->>'slot_minutes')::int, 60);
  ts  := (p_day + (h->>0)::time)::timestamp at time zone t.timezone;
  lim := (p_day + (h->>1)::time)::timestamp at time zone t.timezone;
  window_minutes := floor(extract(epoch from (lim - ts)) / 60)::int;
  -- Короткая работа должна завершиться до закрытия. Длинная (например, 24–48 ч)
  -- пересекает рабочие дни, поэтому для неё ограничиваем время старта сеткой.
  while ts + make_interval(mins => case when s.duration_minutes > window_minutes then step else s.duration_minutes end) <= lim loop
    slot := ts;
    free := ts > now() and exists(
      select 1 from resources r where r.tenant_id = t.id and not exists(
        select 1 from resource_occupancies x where x.resource_id = r.id
          and x.during && tstzrange(ts, ts + make_interval(mins => s.duration_minutes + t.buffer_minutes), '[)')));
    return next;
    ts := ts + make_interval(mins => step);
  end loop;
end $$;

-- Клиент не может записаться на произвольный момент: только на момент приёма из get_slots.
create function check_slot() returns trigger language plpgsql as $$
declare t tenants;
begin
  select * into t from tenants where id = new.tenant_id;
  if not exists(select 1 from get_slots(t.slug, new.service_id, (new.starts_at at time zone t.timezone)::date) g
                where g.slot = new.starts_at) then raise exception 'invalid_slot'; end if;
  return new;
end $$;
create trigger bookings_slot before insert on bookings for each row execute function check_slot();

create function get_booking(p_token text)
returns table(id uuid, tenant_slug text, service_name text, starts_at timestamptz, ends_at timestamptz,
  price_cents int, status text, customer_name text, car text, can_cancel bool)
language sql stable security definer set search_path=public as $$
  select b.id, t.slug, s.name, b.starts_at, b.ends_at, b.price_cents, b.status, b.customer_name, b.car,
    b.status = 'booked' and b.starts_at - now() >= make_interval(hours => coalesce((t.config->>'cancel_hours')::int, 24))
  from bookings b join tenants t on t.id = b.tenant_id join services s on s.tenant_id = b.tenant_id and s.id = b.service_id
  where b.token_hash = digest(p_token, 'sha256') $$;

create function cancel_booking(p_token text) returns bool language plpgsql security definer set search_path=public as $$
declare b bookings; t tenants;
begin
  select * into b from bookings where token_hash = digest(p_token, 'sha256') for update;
  if not found then raise exception 'not_found'; end if;
  if b.status = 'cancelled' then return true; end if;  -- идемпотентно
  select * into t from tenants where id = b.tenant_id;
  if b.status <> 'booked' or b.starts_at - now() < make_interval(hours => coalesce((t.config->>'cancel_hours')::int, 24))
    then raise exception 'too_late'; end if;
  update bookings set status = 'cancelled' where id = b.id;
  delete from resource_occupancies where booking_id = b.id;
  return true;
end $$;
revoke all on function get_slots, get_booking, cancel_booking from public;
grant execute on function get_slots, get_booking, cancel_booking to anon, authenticated;

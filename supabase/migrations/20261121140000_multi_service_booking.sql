-- Multi-service visits: one token, several bookings scheduled back-to-back.
-- "Моя запись" reads every booking of the visit, and client rescheduling is
-- enabled by default for tenants that have not set an explicit policy.

-- Existing tenants without an explicit policy get the safe default. An explicit
-- false (owner deliberately disabled rescheduling) is preserved.
update public.tenants
set config = coalesce(config, '{}'::jsonb)
  || case when (config->>'client_reschedule_enabled') is null
          then jsonb_build_object('client_reschedule_enabled', true) else '{}'::jsonb end
  || case when (config->>'reschedule_hours') is null
          then jsonb_build_object('reschedule_hours', 2) else '{}'::jsonb end
where (config->>'client_reschedule_enabled') is null
   or (config->>'reschedule_hours') is null;

-- New rate scope for reading all bookings of a visit in one call.
create or replace function public.consume_public_rate(p_scope text, p_key text, p_limit int, p_window int)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_scope not in (
    'slots','booking_read','bookings_read','booking_cancel','waitlist','review','admin_login',
    'customer_telegram','customer_telegram_status','account_recovery',
    'booking_reschedule','waitlist_read','waitlist_cancel','waitlist_claim','push_subscribe'
  ) or p_key is null or length(p_key) < 4
    or p_limit not between 1 and 1000 or p_window not between 1 and 86400 then
    return false;
  end if;
  return hit_limit('public:' || p_scope || ':' || md5(p_key), p_limit, p_window);
end $$;
revoke all on function public.consume_public_rate(text,text,int,int) from public,anon,authenticated;
grant execute on function public.consume_public_rate(text,text,int,int) to service_role;

-- Missing reschedule config now means "enabled". Explicit false still wins.
create or replace function public.get_booking(p_token text)
returns table(
  id uuid, tenant_slug text, service_name text, service_id uuid,
  starts_at timestamptz, ends_at timestamptz, price_cents int, status text,
  customer_name text, car text, can_cancel bool, reviewed bool,
  can_reschedule bool, cancel_hours int, reschedule_hours int
)
language sql stable security definer set search_path=public,extensions as $$
  select b.id, t.slug, s.name, b.service_id, b.starts_at, b.ends_at, b.price_cents,
    b.status, b.customer_name, b.car,
    b.status = 'booked' and b.starts_at - now() >=
      make_interval(hours => coalesce((t.config->>'cancel_hours')::int, 24)),
    exists(select 1 from booking_reviews r where r.booking_id = b.id),
    b.status = 'booked'
      and coalesce((t.config->>'client_reschedule_enabled')::bool, true)
      and b.starts_at - now() >=
        make_interval(hours => coalesce((t.config->>'reschedule_hours')::int, 2)),
    coalesce((t.config->>'cancel_hours')::int, 24),
    coalesce((t.config->>'reschedule_hours')::int, 2)
  from bookings b
  join tenants t on t.id = b.tenant_id
  join services s on s.tenant_id = b.tenant_id and s.id = b.service_id
  where b.token_hash = digest(p_token, 'sha256')
$$;
revoke all on function public.get_booking(text) from public;
grant execute on function public.get_booking(text) to anon,authenticated,service_role;

-- A multi-service visit shares one token. Cancel the whole visit atomically.
create or replace function public.cancel_booking(p_token text) returns boolean
language plpgsql security definer set search_path=public,extensions as $$
declare
  b bookings;
  tn tenants;
  v_checked int := 0;
begin
  if p_token is null or p_token !~ '^[A-Fa-f0-9]{32,128}$' then
    raise exception 'not_found';
  end if;
  for b in
    select * from bookings
    where token_hash = digest(p_token, 'sha256')
    order by starts_at
    for update
  loop
    v_checked := v_checked + 1;
    if b.status = 'cancelled' then continue; end if;
    select * into tn from tenants where id = b.tenant_id;
    if b.status <> 'booked' or b.starts_at - now() <
       make_interval(hours => coalesce((tn.config->>'cancel_hours')::int, 24)) then
      raise exception 'too_late';
    end if;
  end loop;
  if v_checked = 0 then raise exception 'not_found'; end if;
  update bookings set status = 'cancelled'
  where token_hash = digest(p_token, 'sha256') and status = 'booked';
  delete from resource_occupancies
  where booking_id in (select id from bookings where token_hash = digest(p_token, 'sha256'));
  return true;
end $$;
revoke all on function public.cancel_booking(text) from public,anon,authenticated;
grant execute on function public.cancel_booking(text) to service_role;

-- Reschedule keeps the whole visit intact: every service keeps its relative
-- order and buffer, and all updates succeed or fail together.
create or replace function public.reschedule_booking(p_token text, p_start timestamptz)
returns table(booking_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
declare
  b bookings;
  first_booking bookings;
  tn tenants;
  r record;
  resource record;
  v_delta interval;
  v_new_start timestamptz;
  v_new_end timestamptz;
  v_placed boolean;
begin
  if p_token is null or p_token !~ '^[A-Fa-f0-9]{32,128}$' then
    raise exception 'not_found';
  end if;
  select * into first_booking from bookings
  where token_hash = digest(p_token, 'sha256') and status = 'booked'
  order by starts_at limit 1 for update;
  if not found then raise exception 'not_found'; end if;
  select * into tn from tenants where id = first_booking.tenant_id;

  if coalesce((tn.config->>'client_reschedule_enabled')::bool, true) <> true then
    raise exception 'feature_disabled';
  end if;
  if p_start is null or p_start <= now() then raise exception 'past_start'; end if;
  if first_booking.starts_at - now() <
     make_interval(hours => coalesce((tn.config->>'reschedule_hours')::int, 2)) then
    raise exception 'too_late';
  end if;
  if not exists (
    select 1 from get_slots(tn.slug, first_booking.service_id,
      (p_start at time zone tn.timezone)::date) g
    where g.slot = p_start
  ) then raise exception 'invalid_slot'; end if;

  v_delta := p_start - first_booking.starts_at;
  for b in
    select * from bookings
    where token_hash = digest(p_token, 'sha256') and status = 'booked'
    order by starts_at
    for update
  loop
    v_new_start := b.starts_at + v_delta;
    v_new_end := v_new_start + make_interval(mins => b.duration_minutes);
    if not exists (
      select 1 from get_slots(tn.slug, b.service_id,
        (v_new_start at time zone tn.timezone)::date) g
      where g.slot = v_new_start
    ) then raise exception 'invalid_slot'; end if;
    v_placed := false;
    for resource in
      select rs.id from resources rs where rs.tenant_id = tn.id
      order by (rs.id <> b.resource_id), rs.name
    loop
      begin
        update resource_occupancies
        set resource_id = resource.id,
            during = tstzrange(v_new_start,
              v_new_end + make_interval(mins => coalesce(tn.buffer_minutes, 0)), '[)')
        where booking_id = b.id;
        update bookings
        set resource_id = resource.id, starts_at = v_new_start, ends_at = v_new_end
        where id = b.id;
        v_placed := true;
        exit;
      exception when exclusion_violation then null;
      end;
    end loop;
    if not v_placed then raise exception 'slot_taken'; end if;
    booking_id := b.id; starts_at := v_new_start; ends_at := v_new_end;
    return next;
  end loop;

  insert into notification_jobs(tenant_id,kind,booking_id,dedupe_key,payload)
  values(tn.id,'booking_rescheduled',first_booking.id,
    'rescheduled:' || first_booking.id::text || ':' || p_start::text,
    jsonb_build_object('old_start', first_booking.starts_at, 'new_start', p_start,
      'token', p_token, 'service_id', first_booking.service_id, 'slug', tn.slug))
  on conflict (dedupe_key) do update
    set payload = excluded.payload, status = 'pending', attempts = 0,
        run_after = now(), lease_until = null, last_error = null;
end $$;
revoke all on function public.reschedule_booking(text,timestamptz) from public,anon,authenticated;
grant execute on function public.reschedule_booking(text,timestamptz) to service_role;

-- Atomic visit: every service is booked or none is. Successive starts include the
-- tenant buffer so one specialist/resource never gets two overlapping services.
-- The promo discount is applied once, to the first service of the visit.
create or replace function public.create_booking_batch(
  p_slug text, p_services uuid[], p_start timestamptz,
  p_name text, p_phone text, p_car text, p_key text, p_token text,
  p_consent text, p_promo text default null, p_source text default 'direct'
)
returns table(
  booking_id uuid, resource_id uuid, starts_at timestamptz, ends_at timestamptz, service_id uuid
)
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_count int;
  v_buffer int;
  v_next timestamptz;
  v_row record;
  v_i int;
begin
  if p_services is null then raise exception 'bad_request'; end if;
  v_count := coalesce(array_length(p_services, 1), 0);
  if v_count < 1 or v_count > 3 then raise exception 'bad_request'; end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9._:-]{16,128}$' then raise exception 'bad_idempotency_key'; end if;
  if p_token is null or p_token !~ '^[A-Fa-f0-9]{32,128}$' then raise exception 'bad_token'; end if;
  if p_start is null or p_start < now() then raise exception 'past_start'; end if;
  select coalesce(buffer_minutes, 0) into v_buffer from tenants where slug = p_slug;
  if v_buffer is null then raise exception 'tenant_not_found'; end if;

  v_next := p_start;
  for v_i in 1..v_count loop
    select cb.booking_id, cb.resource_id, cb.starts_at, cb.ends_at into v_row
    from public.create_booking_with_promo(
      p_slug, p_services[v_i], v_next, p_name, p_phone, p_car,
      left(p_key, 110) || ':' || v_i::text, p_token, p_consent,
      case when v_i = 1 then p_promo else null end, p_source
    ) cb;
    if v_row.booking_id is null then raise exception 'booking_unavailable'; end if;
    booking_id := v_row.booking_id; resource_id := v_row.resource_id;
    starts_at := v_row.starts_at; ends_at := v_row.ends_at; service_id := p_services[v_i];
    return next;
    v_next := v_row.ends_at + make_interval(mins => v_buffer);
  end loop;
end $$;
revoke all on function public.create_booking_batch(text,uuid[],timestamptz,text,text,text,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.create_booking_batch(text,uuid[],timestamptz,text,text,text,text,text,text,text,text)
  to service_role;

notify pgrst, 'reload schema';

-- Multi-service visits keep the tenant buffer between services, but the
-- original check_slot() trigger only accepts the public hourly slot grid.
-- A trusted, transaction-local expected start lets the batch bookings through
-- while ordinary single-service bookings stay on the same grid as before.

create or replace function public.visit_start_in_hours(
  p_tenant public.tenants, p_service uuid, p_start timestamptz
)
returns boolean
language sql stable security definer set search_path=public,extensions as $$
  select exists (
    select 1
    from public.services s
    where s.id = p_service
      and s.tenant_id = p_tenant.id
      and s.active
      and p_start > now()
      and p_start + make_interval(mins => s.duration_minutes) <= (
        (
          (p_start at time zone p_tenant.timezone)::date +
          (
            p_tenant.config -> 'hours' ->
            (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from (p_start at time zone p_tenant.timezone)::date)::int + 1]
            ->> 1
          )::time
        )::timestamp at time zone p_tenant.timezone
      )
  )
$$;
revoke all on function public.visit_start_in_hours(public.tenants,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.visit_start_in_hours(public.tenants,uuid,timestamptz)
  to service_role;

create or replace function public.check_slot() returns trigger
language plpgsql set search_path=public,extensions as $$
declare
  t tenants;
  v_expected text;
begin
  select * into t from tenants where id = new.tenant_id;

  -- create_booking_batch() sets this only for starts it derived from a real
  -- first slot plus each service duration and the tenant buffer.
  v_expected := nullif(current_setting('booking.expected_start', true), '');
  if v_expected is not null and new.starts_at = v_expected::timestamptz then
    if not public.visit_start_in_hours(t, new.service_id, new.starts_at) then
      raise exception 'invalid_slot';
    end if;
    return new;
  end if;

  if not exists (
    select 1 from public.get_slots(
      t.slug, new.service_id, (new.starts_at at time zone t.timezone)::date
    ) g where g.slot = new.starts_at
  ) then
    raise exception 'invalid_slot';
  end if;
  return new;
end $$;

-- Pin every generated start before create_booking() fires the trigger.
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
    perform set_config('booking.expected_start', v_next::text, true);
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

-- Rescheduling moves the whole visit by one delta. Only the first service has
-- to land on the public slot grid; the rest keep their buffered offsets.
create or replace function public.reschedule_booking(p_token text, p_start timestamptz)
returns table(booking_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
declare
  b bookings;
  first_booking bookings;
  tn tenants;
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
    if b.id <> first_booking.id
       and not public.visit_start_in_hours(tn, b.service_id, v_new_start) then
      raise exception 'invalid_slot';
    end if;
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

notify pgrst, 'reload schema';

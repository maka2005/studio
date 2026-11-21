-- The reschedule function also returns a column named booking_id. In the
-- occupancy UPDATE that name was ambiguous with the table column, so every
-- multi- or single-service reschedule failed with SQLSTATE 42702. Qualify it.

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
        where resource_occupancies.booking_id = b.id;
        update bookings
        set resource_id = resource.id, starts_at = v_new_start, ends_at = v_new_end
        where bookings.id = b.id;
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

-- Профиль клиента: вход по ссылке на почту, записи привязываются к аккаунту.
-- Доступ владельца не меняется: он определяется только строкой в tenant_members.
alter table bookings add column user_id uuid references auth.users on delete set null;
create index bookings_user_idx on bookings(user_id);

-- Привязать запись к вошедшему клиенту по её секретному токену (повтор безопасен).
create function claim_booking(p_token text) returns bool language plpgsql security definer set search_path=public, extensions as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  update bookings set user_id = auth.uid()
   where token_hash = digest(p_token, 'sha256') and (user_id is null or user_id = auth.uid())
  returning id into v;
  return v is not null;
end $$;

create function my_bookings(p_slug text)
returns table(id uuid, service_name text, starts_at timestamptz, ends_at timestamptz, price_cents int, status text, car text, can_cancel bool)
language sql stable security definer set search_path=public, extensions as $$
  select b.id, s.name, b.starts_at, b.ends_at, b.price_cents, b.status, b.car,
    b.status = 'booked' and b.starts_at - now() >= make_interval(hours => coalesce((t.config->>'cancel_hours')::int, 24))
  from bookings b join tenants t on t.id = b.tenant_id
    join services s on s.tenant_id = b.tenant_id and s.id = b.service_id
  where t.slug = p_slug and b.user_id = auth.uid()
  order by b.starts_at desc $$;

create function cancel_my_booking(p_booking uuid) returns bool language plpgsql security definer set search_path=public, extensions as $$
declare b bookings; t tenants;
begin
  select * into b from bookings where bookings.id = p_booking and bookings.user_id = auth.uid() for update;
  if not found then raise exception 'not_found'; end if;
  if b.status = 'cancelled' then return true; end if;   -- идемпотентно
  select * into t from tenants where tenants.id = b.tenant_id;
  if b.status <> 'booked' or b.starts_at - now() < make_interval(hours => coalesce((t.config->>'cancel_hours')::int, 24))
    then raise exception 'too_late'; end if;
  update bookings set status = 'cancelled' where id = b.id;
  delete from resource_occupancies where booking_id = b.id;
  return true;
end $$;

revoke all on function claim_booking, my_bookings, cancel_my_booking from public, anon;
grant execute on function claim_booking, my_bookings, cancel_my_booking to authenticated;

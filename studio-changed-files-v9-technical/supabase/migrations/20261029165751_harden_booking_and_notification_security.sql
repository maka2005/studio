-- Close role-specific grants inherited from project defaults. Keep only the
-- intended public booking lookup/creation endpoints public; owner and worker
-- operations are restricted to authenticated owners or service_role.
revoke all on function public.owner_tenant(text) from public, anon, authenticated;
revoke all on function public.owner_booking_tenant(uuid) from public, anon, authenticated;
revoke all on function public.booking_rate() from public, anon, authenticated;
revoke all on function public.bookings_set_user() from public, anon, authenticated;
revoke all on function public.check_slot() from public, anon, authenticated;
revoke all on function public.enqueue_booking_job() from public, anon, authenticated;
revoke all on function public.hit_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.consume_llm_budget(text, integer, integer) from public, anon, authenticated;

revoke all on function public.owner_me(text) from public, anon;
revoke all on function public.owner_bookings(text, date, date) from public, anon;
revoke all on function public.owner_stats(text, date, date) from public, anon;
revoke all on function public.owner_set_status(uuid, text) from public, anon;
revoke all on function public.owner_cancel(uuid) from public, anon;
revoke all on function public.owner_reschedule(uuid, timestamptz) from public, anon;
revoke all on function public.owner_create_booking(text, uuid, timestamptz, text, text, text) from public, anon;
revoke all on function public.owner_block(text, uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.owner_unblock(uuid) from public, anon;
revoke all on function public.owner_add_payment(uuid, integer, text) from public, anon;
revoke all on function public.owner_upsert_service(text, uuid, text, integer, integer, boolean) from public, anon;
revoke all on function public.owner_update_config(text, jsonb) from public, anon;
revoke all on function public.owner_erase_customer(uuid) from public, anon;
revoke all on function public.owner_update_legal(text, jsonb) from public, anon;
revoke all on function public.owner_telegram_code(text) from public, anon;
revoke all on function public.owner_telegram_links(text) from public, anon;
revoke all on function public.owner_telegram_unlink(uuid) from public, anon;

grant execute on function public.owner_me(text), public.owner_bookings(text, date, date),
  public.owner_stats(text, date, date), public.owner_set_status(uuid, text), public.owner_cancel(uuid),
  public.owner_reschedule(uuid, timestamptz), public.owner_create_booking(text, uuid, timestamptz, text, text, text),
  public.owner_block(text, uuid, timestamptz, timestamptz), public.owner_unblock(uuid),
  public.owner_add_payment(uuid, integer, text), public.owner_upsert_service(text, uuid, text, integer, integer, boolean),
  public.owner_update_config(text, jsonb), public.owner_erase_customer(uuid), public.owner_update_legal(text, jsonb),
  public.owner_telegram_code(text), public.owner_telegram_links(text), public.owner_telegram_unlink(uuid)
to authenticated;

revoke all on function public.is_member(uuid), public.media_ok(text) from public, anon;
grant execute on function public.is_member(uuid), public.media_ok(text) to authenticated;

revoke all on function public.lease_notification_jobs(integer),
  public.finish_notification_job(uuid, boolean, text), public.telegram_link_consume(text, bigint),
  public.telegram_unlink_chat(bigint) from public, anon, authenticated;
grant execute on function public.lease_notification_jobs(integer),
  public.finish_notification_job(uuid, boolean, text), public.telegram_link_consume(text, bigint),
  public.telegram_unlink_chat(bigint) to service_role;

revoke all on function public.claim_booking(text), public.my_bookings(text), public.cancel_my_booking(uuid)
from public, anon;
grant execute on function public.claim_booking(text), public.my_bookings(text), public.cancel_my_booking(uuid)
to authenticated;

-- Enforce basic client data validation in the database as a second line of
-- defense. The booking Edge Function applies an attempt limiter in a separate
-- transaction; the existing public RPC remains available until the frontend
-- release that switches clients to that function.
create or replace function public.create_booking(
  p_slug text, p_service uuid, p_start timestamptz,
  p_name text, p_phone text, p_car text, p_key text, p_token text, p_consent text default null
)
returns table(booking_id uuid, resource_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql security definer set search_path=public, extensions as $$
declare t tenants; s services; r record; b uuid; e timestamptz; occ_end timestamptz;
begin
  p_name := btrim(coalesce(p_name, ''));
  p_phone := btrim(coalesce(p_phone, ''));
  p_car := btrim(coalesce(p_car, ''));
  if length(p_name) not between 1 and 80 then raise exception 'bad_name'; end if;
  if length(p_phone) not between 10 and 18 or p_phone !~ '^[+]?[0-9[:space:]()-]+$'
     or length(regexp_replace(p_phone, '[^0-9]', '', 'g')) not between 10 and 15 then raise exception 'bad_phone'; end if;
  if length(p_car) not between 2 and 60 then raise exception 'bad_car'; end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9._:-]{16,128}$' then raise exception 'bad_idempotency_key'; end if;
  if p_token is null or p_token !~ '^[A-Fa-f0-9]{32,128}$' then raise exception 'bad_token'; end if;
  if p_consent is null or length(trim(p_consent)) = 0 then raise exception 'consent_required'; end if;

  select * into t from tenants where slug=p_slug; if not found then raise exception 'tenant_not_found'; end if;
  select * into s from services where id=p_service and tenant_id=t.id and active; if not found then raise exception 'service_not_found'; end if;
  return query select x.id, x.resource_id, x.starts_at, x.ends_at from bookings x
    where x.tenant_id=t.id and x.idempotency_key=p_key;
  if found then return; end if;
  if p_start is null or p_start < now() then raise exception 'past_start'; end if;
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

-- This commits independently from create_booking, so failed slot attempts
-- still count. The caller is restricted to service_role (the Edge Function).
create function public.consume_booking_rate(p_slug text, p_phone text, p_key text, p_ip text)
returns boolean language plpgsql security definer set search_path=public as $$
declare t uuid; phone_key text; ip_key text;
begin
  select id into t from tenants where slug=p_slug;
  if t is null then raise exception 'tenant_not_found'; end if;
  if exists(select 1 from bookings where tenant_id=t and idempotency_key=p_key) then return true; end if;
  phone_key := 'booking-attempt:' || t || ':' || md5(regexp_replace(p_phone, '[^0-9]', '', 'g'));
  if not hit_limit(phone_key, 5, 3600) then return false; end if;
  if nullif(p_ip, '') is not null then
    ip_key := 'bookip:' || t || ':' || md5(p_ip);
    if not hit_limit(ip_key, 20, 3600) then return false; end if;
  end if;
  return true;
end $$;
revoke all on function public.consume_booking_rate(text, text, text, text) from public, anon, authenticated;
grant execute on function public.consume_booking_rate(text, text, text, text) to service_role;
-- Include service_id in the owner calendar data so rescheduling never guesses
-- the service by a possibly duplicated display name.
drop function public.owner_bookings(text, date, date);
create function public.owner_bookings(p_slug text, p_from date, p_to date)
returns table(id uuid, service_id uuid, service_name text, starts_at timestamptz, ends_at timestamptz,
  status text, customer_name text, customer_phone text, car text, price_cents int, paid_cents int, resource_name text)
language plpgsql stable security definer set search_path=public as $$
#variable_conflict use_column
declare t uuid; tz text;
begin
  t := owner_tenant(p_slug);
  select tenants.timezone into tz from tenants where tenants.id=t;
  return query select b.id, b.service_id, s.name, b.starts_at, b.ends_at, b.status, b.customer_name, b.customer_phone,
    b.car, b.price_cents,
    coalesce((select sum(case p.kind when 'payment' then p.amount_cents else -p.amount_cents end)
      from payments p where p.booking_id=b.id and p.tenant_id=t), 0)::int, r.name
  from bookings b join services s on s.tenant_id=b.tenant_id and s.id=b.service_id
    join resources r on r.tenant_id=b.tenant_id and r.id=b.resource_id
  where b.tenant_id=t and b.starts_at >= p_from::timestamp at time zone tz
    and b.starts_at < (p_to + 1)::timestamp at time zone tz
  order by b.starts_at;
end $$;
revoke all on function public.owner_bookings(text, date, date) from public, anon;
grant execute on function public.owner_bookings(text, date, date) to authenticated;

create function public.owner_notification_status(p_slug text)
returns table(pending int, failed int, last_sent_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
declare t uuid;
begin
  t := owner_tenant(p_slug);
  return query select
    (select count(*)::int from notification_jobs j where j.tenant_id=t and j.status='pending'),
    (select count(*)::int from notification_jobs j where j.tenant_id=t and j.status='failed'),
    (select max(j.sent_at) from notification_jobs j where j.tenant_id=t and j.status='sent');
end $$;
revoke all on function public.owner_notification_status(text) from public, anon;
grant execute on function public.owner_notification_status(text) to authenticated;

-- Supporting indexes for tenant-scoped queues and foreign-key checks.
create index if not exists notification_jobs_tenant_status_idx on public.notification_jobs(tenant_id, status, run_after);
create index if not exists resource_occupancies_tenant_booking_idx on public.resource_occupancies(tenant_id, booking_id);
create index if not exists resource_occupancies_tenant_resource_idx on public.resource_occupancies(tenant_id, resource_id);
create index if not exists payments_tenant_booking_idx on public.payments(tenant_id, booking_id);
create index if not exists tenant_members_user_idx on public.tenant_members(user_id);
create index if not exists bookings_tenant_service_idx on public.bookings(tenant_id, service_id);
create index if not exists bookings_tenant_resource_idx on public.bookings(tenant_id, resource_id);

alter function public.check_slot() set search_path=public;

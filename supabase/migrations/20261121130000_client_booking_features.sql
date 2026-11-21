-- Public client booking features: reschedule, waitlist self-service offers and web push.
-- Only service_role may call the new RPCs; get_booking stays available to browsers.

create or replace function public.consume_public_rate(p_scope text, p_key text, p_limit int, p_window int)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_scope not in (
    'slots','booking_read','booking_cancel','waitlist','review','admin_login',
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

-- Waitlist rows get a client token and a one-time offer token. The raw offer token
-- is kept so waitlist_read can return it; the hash is what claim() verifies.
alter table public.waitlist
  add column if not exists token_hash text,
  add column if not exists offer_token text,
  add column if not exists offer_token_hash text,
  add column if not exists offer_slot timestamptz,
  add column if not exists offer_expires_at timestamptz,
  add column if not exists offer_booking_id uuid,
  add column if not exists updated_at timestamptz not null default now();

update public.waitlist
set token_hash = encode(gen_random_bytes(16), 'hex')
where token_hash is null;

create unique index if not exists waitlist_token_hash_idx
  on public.waitlist(token_hash) where token_hash is not null;
create index if not exists waitlist_offer_token_hash_idx
  on public.waitlist(offer_token_hash) where offer_token_hash is not null;

-- Notification jobs gain the two new client events and the push channel.
alter table public.notification_jobs drop constraint if exists notification_jobs_kind_check;
alter table public.notification_jobs add constraint notification_jobs_kind_check
  check (kind in ('booking_created','booking_cancelled','booking_reminder','booking_followup',
                  'waitlist_interest','booking_rescheduled','waitlist_offer'));
alter table public.notification_jobs drop constraint if exists notification_jobs_channel_check;
alter table public.notification_jobs add constraint notification_jobs_channel_check
  check (channel in ('telegram','email','sms','push'));

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subject_hash text not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (endpoint, subject_hash)
);
create index if not exists push_subscriptions_subject_idx
  on public.push_subscriptions(tenant_id, subject_hash);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public,anon,authenticated;
grant all on public.push_subscriptions to service_role;

-- Client booking view. All legacy columns keep their previous names and order.
drop function if exists public.get_booking(text);
create function public.get_booking(p_token text)
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
      and coalesce((t.config->>'client_reschedule_enabled')::bool, false)
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

-- Atomic client reschedule. The resource search mirrors owner_reschedule, and the
-- occupancy update plus booking update live in the same transaction/subtransaction.
create function public.reschedule_booking(p_token text, p_start timestamptz)
returns table(booking_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
declare
  b bookings;
  tn tenants;
  r record;
  v_end timestamptz;
  v_occ_end timestamptz;
begin
  if p_token is null or p_token !~ '^[A-Fa-f0-9]{32,128}$' then
    raise exception 'not_found';
  end if;
  select * into b from bookings where token_hash = digest(p_token, 'sha256') for update;
  if not found or b.status <> 'booked' then raise exception 'not_found'; end if;
  select * into tn from tenants where id = b.tenant_id;

  if coalesce((tn.config->>'client_reschedule_enabled')::bool, false) <> true then
    raise exception 'feature_disabled';
  end if;
  if p_start is null or p_start <= now() then raise exception 'past_start'; end if;
  if b.starts_at - now() <
     make_interval(hours => coalesce((tn.config->>'reschedule_hours')::int, 2)) then
    raise exception 'too_late';
  end if;
  if not exists (
    select 1 from get_slots(tn.slug, b.service_id, (p_start at time zone tn.timezone)::date) g
    where g.slot = p_start
  ) then raise exception 'invalid_slot'; end if;

  v_end := p_start + make_interval(mins => b.duration_minutes);
  v_occ_end := v_end + make_interval(mins => coalesce(tn.buffer_minutes, 0));
  for r in
    select rs.id from resources rs where rs.tenant_id = tn.id
    order by (rs.id <> b.resource_id), rs.name
  loop
    begin
      update resource_occupancies
      set resource_id = r.id, during = tstzrange(p_start, v_occ_end, '[)')
      where booking_id = b.id;
      update bookings
      set resource_id = r.id, starts_at = p_start, ends_at = v_end
      where id = b.id;
      insert into notification_jobs(tenant_id,kind,booking_id,dedupe_key,payload)
      values(b.tenant_id,'booking_rescheduled',b.id,
        'rescheduled:' || b.id::text || ':' || p_start::text,
        jsonb_build_object('old_start', b.starts_at, 'new_start', p_start,
          'token', p_token, 'service_id', b.service_id, 'slug', tn.slug))
      on conflict (dedupe_key) do update
        set payload = excluded.payload, status = 'pending', attempts = 0,
            run_after = now(), lease_until = null, last_error = null;
      booking_id := b.id; starts_at := p_start; ends_at := v_end;
      return next; return;
    exception when exclusion_violation then null;
    end;
  end loop;
  raise exception 'slot_taken';
end $$;
revoke all on function public.reschedule_booking(text,timestamptz) from public,anon,authenticated;
grant execute on function public.reschedule_booking(text,timestamptz) to service_role;

-- Waitlist self-service: creation now stores the client token hash.
drop function if exists public.submit_waitlist(text,uuid,date,text,text,text,text);
create function public.submit_waitlist(
  p_slug text, p_service uuid, p_day date, p_name text, p_phone text,
  p_car text, p_consent text, p_token text
)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare t uuid; service_label text; item uuid;
begin
  if p_token is null or p_token !~ '^[A-Fa-f0-9]{32,128}$' then raise exception 'bad_token'; end if;
  select id into t from tenants where slug = p_slug;
  if t is null then raise exception 'not_found'; end if;
  select name into service_label from services where tenant_id = t and id = p_service and active;
  if service_label is null then raise exception 'not_found'; end if;
  if length(btrim(p_name)) not between 1 and 80
     or length(p_phone) not between 10 and 16
     or length(btrim(p_car)) not between 2 and 60
     or length(trim(coalesce(p_consent, ''))) not between 1 and 40 then
    raise exception 'bad_request';
  end if;
  insert into waitlist(tenant_id,service_id,preferred_day,customer_name,customer_phone,
    car,consent_version,token_hash)
  values(t,p_service,p_day,btrim(p_name),p_phone,btrim(p_car),trim(p_consent),
    encode(digest(p_token, 'sha256'), 'hex'))
  returning id into item;
  insert into notification_jobs(tenant_id,kind,booking_id,dedupe_key,payload)
  values(t,'waitlist_interest',null,'waitlist:' || item,
    jsonb_build_object('service',service_label,'day',p_day,'name',btrim(p_name),
      'phone',p_phone,'car',btrim(p_car),'token',p_token,'waitlist_id',item));
  return item;
end $$;
revoke all on function public.submit_waitlist(text,uuid,date,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.submit_waitlist(text,uuid,date,text,text,text,text,text)
  to service_role;

create function public.waitlist_read(p_token text)
returns table(
  id uuid, service_name text, service_id uuid, preferred_day date, status text,
  created_at timestamptz, offer_slot timestamptz, offer_expires_at timestamptz,
  offer_token text
)
language sql stable security definer set search_path=public,extensions as $$
  select w.id, s.name, w.service_id, w.preferred_day, w.status, w.created_at,
    w.offer_slot, w.offer_expires_at,
    case when w.status = 'waiting' and w.offer_expires_at is not null and w.offer_expires_at > now()
      then w.offer_token else null end
  from waitlist w
  join services s on s.tenant_id = w.tenant_id and s.id = w.service_id
  where w.token_hash = encode(digest(p_token, 'sha256'), 'hex')
$$;
revoke all on function public.waitlist_read(text) from public,anon,authenticated;
grant execute on function public.waitlist_read(text) to service_role;

create function public.waitlist_cancel(p_token text) returns boolean
language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid;
begin
  update waitlist
  set status = 'closed', offer_token = null, offer_token_hash = null,
      offer_slot = null, offer_expires_at = null, offer_booking_id = null,
      updated_at = now()
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and status <> 'closed'
  returning id into v_id;
  return v_id is not null;
end $$;
revoke all on function public.waitlist_cancel(text) from public,anon,authenticated;
grant execute on function public.waitlist_cancel(text) to service_role;

-- Claim is serialized on the waitlist row, so two concurrent claims cannot
-- create two bookings for the same offer.
create function public.waitlist_claim(p_offer_token text)
returns table(booking_id uuid, token text, starts_at timestamptz, ends_at timestamptz, service_id uuid)
language plpgsql security definer set search_path=public,extensions as $$
declare
  w waitlist;
  v_slug text;
  v_token text;
  v_key text;
  b record;
begin
  if p_offer_token is null or p_offer_token !~ '^[A-Fa-f0-9]{32,128}$' then
    raise exception 'not_found';
  end if;
  select * into w from waitlist
  where offer_token_hash = encode(digest(p_offer_token, 'sha256'), 'hex')
  for update;
  if not found then raise exception 'not_found'; end if;
  if w.status <> 'waiting' or w.offer_slot is null
     or w.offer_expires_at is null or w.offer_expires_at <= now() then
    raise exception 'offer_unavailable';
  end if;
  select slug into v_slug from tenants where id = w.tenant_id;
  if v_slug is null then raise exception 'not_found'; end if;

  v_token := encode(gen_random_bytes(16), 'hex');
  v_key := 'wl:' || replace(w.id::text, '-', '') || encode(gen_random_bytes(6), 'hex');
  select cb.* into b from public.create_booking(
    v_slug, w.service_id, w.offer_slot, w.customer_name, w.customer_phone,
    w.car, v_key, v_token, w.consent_version
  ) cb;
  if b.booking_id is null then raise exception 'slot_taken'; end if;

  update waitlist
  set status = 'contacted', offer_booking_id = b.booking_id,
      offer_token = null, offer_token_hash = null,
      offer_slot = null, offer_expires_at = null, updated_at = now()
  where id = w.id;
  update notification_jobs
  set payload = payload || jsonb_build_object('token', v_token, 'source', 'waitlist')
  where booking_id = b.booking_id and kind = 'booking_created';

  booking_id := b.booking_id; token := v_token;
  starts_at := b.starts_at; ends_at := b.ends_at; service_id := w.service_id;
  return next;
end $$;
revoke all on function public.waitlist_claim(text) from public,anon,authenticated;
grant execute on function public.waitlist_claim(text) to service_role;

-- A cancelled or moved booking frees its slot for waiting clients of the same
-- tenant/service on that local day.
create or replace function public.waitlist_release_offer() returns trigger
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_tz text;
  v_slug text;
  v_service text;
  v_day date;
  v_offer text;
  v_token text;
  w record;
begin
  if tg_op <> 'UPDATE' or old.status <> 'booked' then return null; end if;
  if new.status <> 'cancelled' and new.starts_at is not distinct from old.starts_at then
    return null;
  end if;
  select timezone, slug into v_tz, v_slug from tenants where id = old.tenant_id;
  if v_tz is null then return null; end if;
  select name into v_service from services
  where tenant_id = old.tenant_id and id = old.service_id;
  v_day := (old.starts_at at time zone v_tz)::date;

  for w in
    select id from waitlist
    where tenant_id = old.tenant_id and service_id = old.service_id
      and preferred_day = v_day and status = 'waiting'
  loop
    v_offer := encode(gen_random_bytes(16), 'hex');
    update waitlist
    set offer_slot = old.starts_at,
        offer_expires_at = now() + interval '2 hours',
        offer_token = v_offer,
        offer_token_hash = encode(digest(v_offer, 'sha256'), 'hex'),
        updated_at = now()
    where id = w.id;
    select payload->>'token' into v_token from notification_jobs
    where kind = 'waitlist_interest' and dedupe_key = 'waitlist:' || w.id::text
    order by created_at desc limit 1;
    insert into notification_jobs(tenant_id,kind,booking_id,dedupe_key,payload)
    values(old.tenant_id,'waitlist_offer',old.id,
      'waitlist_offer:' || w.id::text || ':' || old.starts_at::text,
      jsonb_build_object('waitlist_id', w.id, 'offer_token', v_offer,
        'service', coalesce(v_service, ''), 'day', v_day, 'slot', old.starts_at,
        'tenant_slug', v_slug, 'token', v_token))
    on conflict (dedupe_key) do update
      set payload = excluded.payload, status = 'pending', attempts = 0,
          run_after = now(), lease_until = null, last_error = null;
  end loop;
  return null;
end $$;
drop trigger if exists waitlist_release_offer on public.bookings;
create trigger waitlist_release_offer
  after update of starts_at, status on public.bookings
  for each row execute function public.waitlist_release_offer();
revoke all on function public.waitlist_release_offer() from public,anon,authenticated;
grant execute on function public.waitlist_release_offer() to service_role;

notify pgrst, 'reload schema';

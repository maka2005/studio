-- Returning customers keep the Telegram consent given on an earlier booking
-- with the same studio and phone. /stop revokes it for every future booking.
create table if not exists public.customer_telegram_optouts (
  tenant_id uuid not null,
  phone_digits text not null,
  chat_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, phone_digits, chat_id)
);
alter table public.customer_telegram_optouts enable row level security;
revoke all on public.customer_telegram_optouts from public, anon, authenticated;

-- Remember an opt-out before the chat links are removed, so a later booking
-- cannot silently inherit the same chat again.
create or replace function public.telegram_unlink_chat(p_chat bigint)
returns int language plpgsql security definer set search_path=public as $$
declare n int; m int;
begin
  insert into public.customer_telegram_optouts(tenant_id, phone_digits, chat_id)
  select l.tenant_id, regexp_replace(coalesce(b.customer_phone, ''), '\D', '', 'g'), p_chat
  from public.booking_telegram_links l
  join public.bookings b on b.tenant_id = l.tenant_id and b.id = l.booking_id
  where l.chat_id = p_chat
  on conflict do nothing;
  delete from public.telegram_links where chat_id = p_chat; get diagnostics n = row_count;
  delete from public.booking_telegram_links where chat_id = p_chat; get diagnostics m = row_count;
  return n + m;
end $$;

-- A fresh, explicit opt-in clears the opt-out for that studio and phone.
create or replace function public.customer_telegram_link_consume(p_code text, p_chat bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare c public.booking_telegram_link_codes; b public.bookings; t public.tenants; s public.services; reminder_hours int;
begin
  if p_code is null or p_code !~ '^[A-Fa-f0-9]{32}$' or p_chat is null then return null; end if;
  select * into c from public.booking_telegram_link_codes where code_hash=digest(p_code,'sha256') and used_at is null and expires_at>now() for update;
  if not found then return null; end if;
  update public.booking_telegram_link_codes set used_at=now() where code_hash=c.code_hash;
  select * into b from public.bookings where id=c.booking_id and tenant_id=c.tenant_id and status='booked' and starts_at>now();
  if not found then return null; end if;
  select * into t from public.tenants where id=b.tenant_id;
  if not coalesce((t.config->>'client_telegram_enabled')::boolean,false) then return null; end if;
  select * into s from public.services where id=b.service_id and tenant_id=b.tenant_id;
  if t.id is null or s.id is null then return null; end if;
  insert into public.booking_telegram_links(tenant_id,booking_id,chat_id,consent_at,consent_version,repeat_consent)
    values(c.tenant_id,c.booking_id,p_chat,c.consent_at,c.consent_version,c.repeat_consent)
    on conflict(booking_id) do update set chat_id=excluded.chat_id,consent_at=excluded.consent_at,consent_version=excluded.consent_version,
      repeat_consent=excluded.repeat_consent,created_at=now();
  delete from public.customer_telegram_optouts
    where tenant_id=b.tenant_id
      and phone_digits=regexp_replace(coalesce(b.customer_phone,''), '\D', '', 'g');
  select coalesce(ns.reminder_hours_before,24) into reminder_hours from public.tenant_notification_settings ns where ns.tenant_id=b.tenant_id;
  insert into public.notification_jobs(tenant_id,kind,booking_id,dedupe_key,run_after)
    values(b.tenant_id,'booking_reminder',b.id,'reminder24:'||b.id,greatest(b.starts_at-make_interval(hours=>coalesce(reminder_hours,24)),now()))
    on conflict(dedupe_key) do nothing;
  return jsonb_build_object('studio',coalesce(t.config->>'short_name',t.config->>'name',t.slug),'service',s.name,
    'starts_at',b.starts_at,'timezone',t.timezone,'address',coalesce(t.config->>'address',''),'price_cents',b.price_cents,'currency',coalesce(t.config->>'currency',''),
    'reminder_hours_before',coalesce(reminder_hours,24),'repeat_consent',c.repeat_consent);
end;
$$;
revoke all on function public.customer_telegram_link_consume(text,bigint) from public,anon,authenticated;
grant execute on function public.customer_telegram_link_consume(text,bigint) to service_role;

-- Copy the newest prior consent for the same studio and phone. Normalizing to
-- digits keeps "+7 (777) 123-45-67" and "77771234567" equivalent.
create or replace function public.reuse_customer_telegram_consent()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare
  prior public.booking_telegram_links;
  phone_digits text;
begin
  phone_digits := regexp_replace(coalesce(new.customer_phone, ''), '\D', '', 'g');
  if length(phone_digits) < 7 then return new; end if;
  if exists (
    select 1 from public.customer_telegram_optouts o
    where o.tenant_id = new.tenant_id and o.phone_digits = phone_digits
  ) then return new; end if;
  select l.* into prior
  from public.booking_telegram_links l
  join public.bookings b on b.tenant_id = l.tenant_id and b.id = l.booking_id
  where l.tenant_id = new.tenant_id
    and regexp_replace(coalesce(b.customer_phone, ''), '\D', '', 'g') = phone_digits
  order by l.created_at desc, l.booking_id desc
  limit 1;
  if prior.booking_id is null then return new; end if;
  insert into public.booking_telegram_links(tenant_id, booking_id, chat_id, consent_at, consent_version, repeat_consent)
  values (new.tenant_id, new.id, prior.chat_id, prior.consent_at, prior.consent_version, prior.repeat_consent)
  on conflict (booking_id) do nothing;
  return new;
end $$;

drop trigger if exists bookings_reuse_telegram_consent_ins on public.bookings;
create trigger bookings_reuse_telegram_consent_ins
after insert on public.bookings
for each row execute function public.reuse_customer_telegram_consent();

create index if not exists booking_telegram_links_tenant_created_idx
  on public.booking_telegram_links (tenant_id, created_at desc);

revoke all on function public.reuse_customer_telegram_consent() from public,anon,authenticated;

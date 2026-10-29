-- Optional, per-booking Telegram notifications for customers who explicitly opt in.
create table public.booking_telegram_link_codes (
  code_hash bytea primary key,
  tenant_id uuid not null,
  booking_id uuid not null,
  consent_at timestamptz not null,
  consent_version text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade
);
create index booking_telegram_link_codes_expiry_idx on public.booking_telegram_link_codes(expires_at) where used_at is null;

create table public.booking_telegram_links (
  tenant_id uuid not null,
  booking_id uuid not null,
  chat_id bigint not null,
  consent_at timestamptz not null,
  consent_version text not null,
  created_at timestamptz not null default now(),
  primary key (booking_id),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade
);
create index booking_telegram_links_chat_idx on public.booking_telegram_links(chat_id);
alter table public.booking_telegram_link_codes enable row level security;
alter table public.booking_telegram_links enable row level security;
revoke all on public.booking_telegram_link_codes, public.booking_telegram_links from public, anon, authenticated;

create or replace function public.consume_public_rate(p_scope text,p_key text,p_limit int,p_window int)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_scope not in ('slots','booking_read','booking_cancel','waitlist','review','admin_login','customer_telegram') or p_key is null or length(p_key)<4
    or p_limit not between 1 and 1000 or p_window not between 1 and 86400 then return false; end if;
  return hit_limit('public:'||p_scope||':'||md5(p_key),p_limit,p_window);
end $$;
revoke all on function public.consume_public_rate(text,text,int,int) from public,anon,authenticated;
grant execute on function public.consume_public_rate(text,text,int,int) to service_role;

create function public.customer_telegram_code(p_token text,p_consent_version text)
returns text language plpgsql security definer set search_path=public,extensions as $$
declare b public.bookings; code text;
begin
  if p_token is null or p_token !~ '^[A-Fa-f0-9]{32,128}$'
    or p_consent_version is distinct from 'telegram_booking_v1' then raise exception 'bad_request'; end if;
  select * into b from public.bookings where token_hash=digest(p_token,'sha256') and status='booked' and starts_at>now() for update;
  if not found then raise exception 'booking_unavailable'; end if;
  if not exists(select 1 from public.tenants where id=b.tenant_id and coalesce((config->>'client_telegram_enabled')::boolean,false)) then raise exception 'feature_disabled'; end if;
  if exists(select 1 from public.booking_telegram_links where booking_id=b.id) then return null; end if;
  delete from public.booking_telegram_link_codes where expires_at<=now() or used_at is not null;
  code:=encode(gen_random_bytes(16),'hex');
  insert into public.booking_telegram_link_codes(code_hash,tenant_id,booking_id,consent_at,consent_version,expires_at)
    values(digest(code,'sha256'),b.tenant_id,b.id,now(),p_consent_version,now()+interval '15 minutes');
  return code;
end $$;

create function public.customer_telegram_link_consume(p_code text,p_chat bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare c public.booking_telegram_link_codes; b public.bookings; t public.tenants; s public.services;
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
  insert into public.booking_telegram_links(tenant_id,booking_id,chat_id,consent_at,consent_version)
    values(c.tenant_id,c.booking_id,p_chat,c.consent_at,c.consent_version)
    on conflict(booking_id) do update set chat_id=excluded.chat_id,consent_at=excluded.consent_at,consent_version=excluded.consent_version,created_at=now();
  return jsonb_build_object('studio',coalesce(t.config->>'short_name',t.config->>'name',t.slug),'service',s.name,
    'starts_at',b.starts_at,'timezone',t.timezone,'address',coalesce(t.config->>'address',''),'price_cents',b.price_cents,
    'currency',coalesce(t.config->>'currency',''));
end $$;

create or replace function public.telegram_unlink_chat(p_chat bigint) returns int language plpgsql security definer set search_path=public as $$
declare n int; m int;
begin
  delete from public.telegram_links where chat_id=p_chat; get diagnostics n=row_count;
  delete from public.booking_telegram_links where chat_id=p_chat; get diagnostics m=row_count;
  return n+m;
end $$;

create or replace function public.owner_erase_customer(p_booking uuid) returns void language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
  t:=owner_booking_tenant(p_booking);
  delete from public.booking_telegram_links where tenant_id=t and booking_id=p_booking;
  update public.bookings set customer_name='Удалено',customer_phone='',car='Удалено',user_id=null where id=p_booking and tenant_id=t;
end $$;

create or replace function public.owner_update_config(p_slug text,p_patch jsonb) returns void language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
  t:=owner_tenant(p_slug);
  update public.tenants set config=config||coalesce((select jsonb_object_agg(e.key,e.value) from jsonb_each(p_patch) e
    where e.key in ('phone','address','description','cards','hours','gallery','client_telegram_enabled')),'{}'::jsonb) where id=t;
  if p_patch ? 'client_telegram_enabled' and p_patch->'client_telegram_enabled'='false'::jsonb then
    delete from public.booking_telegram_links where tenant_id=t;
  end if;
end $$;

revoke all on function public.customer_telegram_code(text,text),public.customer_telegram_link_consume(text,bigint) from public,anon,authenticated;
grant execute on function public.customer_telegram_code(text,text),public.customer_telegram_link_consume(text,bigint) to service_role;

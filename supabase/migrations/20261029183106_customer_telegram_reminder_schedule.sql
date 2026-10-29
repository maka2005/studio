-- Ensure customers who connect less than 24 hours before a visit still get a reminder.
create or replace function public.customer_telegram_link_consume(p_code text,p_chat bigint)
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
  insert into public.notification_jobs(tenant_id,kind,booking_id,dedupe_key,run_after)
    values(b.tenant_id,'booking_reminder',b.id,'reminder24:'||b.id,greatest(b.starts_at-interval '24 hours',now()))
    on conflict(dedupe_key) do nothing;
  return jsonb_build_object('studio',coalesce(t.config->>'short_name',t.config->>'name',t.slug),'service',s.name,
    'starts_at',b.starts_at,'timezone',t.timezone,'address',coalesce(t.config->>'address',''),'price_cents',b.price_cents,
    'currency',coalesce(t.config->>'currency',''));
end $$;
revoke all on function public.customer_telegram_link_consume(text,bigint) from public,anon,authenticated;
grant execute on function public.customer_telegram_link_consume(text,bigint) to service_role;

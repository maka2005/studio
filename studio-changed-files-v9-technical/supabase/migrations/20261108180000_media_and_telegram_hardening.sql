-- Uploads now pass through an Edge Function that inspects actual bytes.
drop policy if exists media_insert on storage.objects;
drop policy if exists media_update on storage.objects;
drop policy if exists media_delete on storage.objects;

-- Both owner and customer Telegram deep-link codes are one-time and expire after 10 minutes.
create or replace function public.owner_telegram_code(p_slug text) returns text
language plpgsql security definer set search_path=public,extensions as $$
declare t uuid; c text;
begin
 t:=public.owner_tenant_owner(p_slug);
 delete from public.telegram_link_codes where tenant_id=t and (used or expires_at<now());
 select code into c from public.telegram_link_codes where tenant_id=t and not used and expires_at>now() order by expires_at desc limit 1;
 if c is not null then return c; end if;
 if (select count(*) from public.telegram_link_codes where tenant_id=t)>=5 then raise exception 'rate_limited'; end if;
 c:=encode(gen_random_bytes(16),'hex');
 insert into public.telegram_link_codes(code,tenant_id,expires_at) values(c,t,now()+interval '10 minutes');
 return c;
end $$;
create or replace function public.customer_telegram_code(p_token text,p_consent_version text,p_repeat_consent boolean default false)
returns text language plpgsql security definer set search_path=public,extensions as $$
declare b public.bookings; code text;
begin
 if p_token is null or p_token !~ '^[A-Fa-f0-9]{32,128}$' or p_consent_version is distinct from 'telegram_booking_v1' or p_repeat_consent is null then raise exception 'bad_request'; end if;
 select * into b from public.bookings where token_hash=digest(p_token,'sha256') and status='booked' and starts_at>now() for update;
 if not found then raise exception 'booking_unavailable'; end if;
 if not exists(select 1 from public.tenants where id=b.tenant_id and coalesce((config->>'client_telegram_enabled')::boolean,false)) then raise exception 'feature_disabled'; end if;
 if exists(select 1 from public.booking_telegram_links where booking_id=b.id) then return null; end if;
 delete from public.booking_telegram_link_codes where expires_at<=now() or used_at is not null;
 code:=encode(gen_random_bytes(16),'hex');
 insert into public.booking_telegram_link_codes(code_hash,tenant_id,booking_id,consent_at,consent_version,repeat_consent,expires_at)
 values(digest(code,'sha256'),b.tenant_id,b.id,now(),p_consent_version,p_repeat_consent,now()+interval '10 minutes');
 return code;
end $$;
revoke all on function public.owner_telegram_code(text),public.customer_telegram_code(text,text,boolean) from public,anon,authenticated;
grant execute on function public.owner_telegram_code(text) to authenticated;
grant execute on function public.customer_telegram_code(text,text,boolean) to service_role;

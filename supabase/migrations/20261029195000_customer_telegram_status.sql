-- Allow the booking owner to check whether their Telegram opt-in completed.
create or replace function public.customer_telegram_status(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_token is null or p_token !~ '^[A-Fa-f0-9]{32,128}$' then return false; end if;
  return exists (
    select 1
    from public.bookings b
    join public.booking_telegram_links l on l.tenant_id = b.tenant_id and l.booking_id = b.id
    join public.tenants t on t.id = b.tenant_id
    where b.token_hash = digest(p_token, 'sha256')
      and b.status = 'booked'
      and b.starts_at > now()
      and coalesce((t.config->>'client_telegram_enabled')::boolean, false)
  );
end;
$$;

revoke all on function public.customer_telegram_status(text) from public, anon, authenticated;
grant execute on function public.customer_telegram_status(text) to service_role;

create or replace function public.consume_public_rate(p_scope text,p_key text,p_limit int,p_window int)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_scope not in ('slots','booking_read','booking_cancel','waitlist','review','admin_login','customer_telegram','customer_telegram_status')
    or p_key is null or length(p_key)<4 or p_limit not between 1 and 1000 or p_window not between 1 and 86400 then return false; end if;
  return hit_limit('public:'||p_scope||':'||md5(p_key),p_limit,p_window);
end $$;
revoke all on function public.consume_public_rate(text,text,int,int) from public,anon,authenticated;
grant execute on function public.consume_public_rate(text,text,int,int) to service_role;

create or replace function public.consume_public_rate(p_scope text,p_key text,p_limit int,p_window int)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_scope not in ('slots','booking_read','booking_cancel','waitlist','review','admin_login','customer_telegram','customer_telegram_status','account_recovery')
    or p_key is null or length(p_key)<4 or p_limit not between 1 and 1000 or p_window not between 1 and 86400 then return false; end if;
  return hit_limit('public:'||p_scope||':'||md5(p_key),p_limit,p_window);
end $$;
revoke all on function public.consume_public_rate(text,text,int,int) from public,anon,authenticated;
grant execute on function public.consume_public_rate(text,text,int,int) to service_role;

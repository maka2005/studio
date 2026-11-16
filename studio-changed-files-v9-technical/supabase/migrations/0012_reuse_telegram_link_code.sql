-- Reuse an active one-time code so retries or repeated clicks do not exhaust the limit.
create or replace function owner_telegram_code(p_slug text) returns text
language plpgsql security definer set search_path=public, extensions as $$
declare t uuid; c text;
begin
  t := owner_tenant(p_slug);
  delete from telegram_link_codes where tenant_id = t and (used or expires_at < now());
  select code into c from telegram_link_codes
    where tenant_id = t and not used and expires_at > now()
    order by expires_at desc limit 1;
  if c is not null then return c; end if;
  if (select count(*) from telegram_link_codes where tenant_id = t) >= 5 then
    raise exception 'rate_limited';
  end if;
  c := encode(gen_random_bytes(12), 'hex');
  insert into telegram_link_codes(code, tenant_id, expires_at)
  values (c, t, now() + interval '15 minutes');
  return c;
end $$;

revoke all on function owner_telegram_code(text) from public, anon;
grant execute on function owner_telegram_code(text) to authenticated;

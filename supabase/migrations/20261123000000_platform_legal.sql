-- Реквизиты оператора платформы для публичных /offer и /privacy.
-- Хранятся одним JSON-объектом в platform_settings, чтобы не разводить отдельную таблицу.
insert into public.platform_settings(key, value, updated_at)
values (
  'legal',
  '{"operator":"","bin":"","address":"","phone":"","whatsapp":"","email":""}'::jsonb,
  now()
)
on conflict (key) do nothing;

create or replace function public.platform_get_legal(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.platform_assert(p_actor);
  return coalesce(
    (select value from public.platform_settings where key = 'legal'),
    '{"operator":"","bin":"","address":"","phone":"","whatsapp":"","email":""}'::jsonb
  );
end $$;

create or replace function public.platform_set_legal(p_actor uuid, p_value jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare
  v jsonb := coalesce(p_value, '{}'::jsonb);
  operator_name text := btrim(coalesce(v->>'operator', ''));
  bin_value text := btrim(coalesce(v->>'bin', ''));
  address_value text := btrim(coalesce(v->>'address', ''));
  email_value text := btrim(coalesce(v->>'email', ''));
  phone_value text := btrim(coalesce(v->>'phone', ''));
  whatsapp_value text := btrim(coalesce(v->>'whatsapp', ''));
begin
  perform public.platform_assert(p_actor);
  if jsonb_typeof(v) <> 'object' then raise exception 'bad_request'; end if;
  if length(operator_name) < 2 or length(operator_name) > 200 then raise exception 'bad_value'; end if;
  if bin_value !~ '^\d{12}$' then raise exception 'bad_value'; end if;
  if length(address_value) < 5 or length(address_value) > 250 then raise exception 'bad_value'; end if;
  if email_value <> '' and email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'bad_value'; end if;
  if length(phone_value) > 40 or length(whatsapp_value) > 20 then raise exception 'bad_value'; end if;

  insert into public.platform_settings(key, value, updated_at)
  values (
    'legal',
    jsonb_build_object(
      'operator', operator_name,
      'bin', bin_value,
      'address', address_value,
      'phone', phone_value,
      'whatsapp', regexp_replace(whatsapp_value, '\D', '', 'g'),
      'email', email_value
    ),
    now()
  )
  on conflict (key) do update set value = excluded.value, updated_at = now();

  perform public.platform_log(p_actor, 'settings.update', null, jsonb_build_object('key', 'legal'));
end $$;

revoke all on function public.platform_get_legal(uuid) from public, anon, authenticated;
grant execute on function public.platform_get_legal(uuid) to service_role;
revoke all on function public.platform_set_legal(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.platform_set_legal(uuid, jsonb) to service_role;

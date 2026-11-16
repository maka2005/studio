-- Срок пробного периода: единый допустимый диапазон 1..60 дней.
-- Раньше админка разрешала до 90, а создание подписки (platform_create_tenant_system) принимает только 1..60,
-- из-за чего значение 61..90 ломало самостоятельное подключение. Права на функцию сохраняются (create or replace).
create or replace function public.platform_set_setting(p_actor uuid,p_key text,p_value jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare n int;
begin
  perform public.platform_assert(p_actor);
  if p_key not in ('trial_days','grace_days') then raise exception 'bad_setting'; end if;
  begin n := (p_value #>> '{}')::int; exception when others then raise exception 'bad_value'; end;
  if (p_key='trial_days' and (n < 1 or n > 60)) or (p_key='grace_days' and (n < 0 or n > 30)) then raise exception 'bad_value'; end if;
  insert into public.platform_settings(key,value,updated_at) values(p_key,to_jsonb(n),now())
    on conflict(key) do update set value=excluded.value,updated_at=now();
  perform public.platform_log(p_actor,'settings.update',null,jsonb_build_object('key',p_key,'value',n));
end $$;

-- Если уже сохранено значение больше 60, приводим к допустимому.
update public.platform_settings set value=to_jsonb(60) where key='trial_days' and (value #>> '{}')::int > 60;

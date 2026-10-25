-- Владелец заполняет реквизиты оператора персональных данных. Хранение и поставщиков (storage, processors) задаёт только платформа.
create function owner_update_legal(p_slug text, p_legal jsonb) returns void language plpgsql security definer set search_path=public as $$
declare t uuid; k text; clean jsonb := '{}'::jsonb;
begin
  t := owner_tenant(p_slug);
  if jsonb_typeof(p_legal) <> 'object' then raise exception 'bad_config'; end if;
  foreach k in array array['name','bin','address','email','retention'] loop
    if p_legal ? k then
      if jsonb_typeof(p_legal->k) <> 'string' or length(p_legal->>k) > 200 then raise exception 'bad_config'; end if;
      clean := clean || jsonb_build_object(k, trim(p_legal->>k));
    end if;
  end loop;
  update tenants set config = jsonb_set(config, '{legal}', coalesce(config->'legal', '{}'::jsonb) || clean, true) where id = t;
end $$;
revoke all on function owner_update_legal from public; grant execute on function owner_update_legal to authenticated;

-- Give platform-created tenants the public-site config blocks required by the frontend.
-- Existing configured studios are preserved; only missing keys receive defaults.

create or replace function public.tenant_config_with_defaults(p_config jsonb)
returns jsonb
language sql immutable set search_path=public as $$
  select coalesce(p_config,'{}'::jsonb) || jsonb_build_object(
    'short_name', coalesce(nullif(p_config->>'short_name',''), nullif(p_config->>'name',''), 'Автосервис'),
    'images', jsonb_build_object('logo','/servio-default.svg','hero','/servio-default.svg') || coalesce(p_config->'images','{}'::jsonb),
    'gallery', coalesce(p_config->'gallery','[]'::jsonb),
    'cards', jsonb_build_object(
      'booking', jsonb_build_object('title','Запись на обслуживание','text','Выберите услугу и удобное время.') || coalesce(p_config->'cards'->'booking','{}'::jsonb),
      'catalog', jsonb_build_object('title','Услуги студии','text','Посмотрите услуги и цены.') || coalesce(p_config->'cards'->'catalog','{}'::jsonb),
      'install', jsonb_build_object('title','Сохраните сайт студии','text','Добавьте его на экран телефона для быстрого доступа.') || coalesce(p_config->'cards'->'install','{}'::jsonb)
    ),
    'services', coalesce(p_config->'services','[]'::jsonb)
  )
$$;

create or replace function public.apply_tenant_config_defaults()
returns trigger
language plpgsql security definer set search_path=public as $$
begin
  new.config := public.tenant_config_with_defaults(new.config);
  return new;
end
$$;

drop trigger if exists tenants_config_defaults on public.tenants;
create trigger tenants_config_defaults
before insert on public.tenants
for each row execute function public.apply_tenant_config_defaults();

update public.tenants
set config = public.tenant_config_with_defaults(config)
where not (config ? 'images') or not (config ? 'gallery') or not (config ? 'cards') or not (config ? 'services');

revoke all on function public.tenant_config_with_defaults(jsonb) from public, anon, authenticated;
revoke all on function public.apply_tenant_config_defaults() from public, anon, authenticated;

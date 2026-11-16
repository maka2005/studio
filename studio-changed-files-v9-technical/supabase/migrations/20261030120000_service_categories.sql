alter table public.services add column category text not null default 'Другое';

update public.tenants
set config = jsonb_set(
  config,
  '{cards}',
  ((config -> 'cards') - 'ai') || jsonb_build_object(
    'catalog', coalesce(config->'cards'->'catalog', config->'cards'->'ai',
      '{"title":"Каталог услуг","text":"Выберите категорию или найдите услугу в прайсе"}'::jsonb)
  )
)
where config->'cards' ? 'ai';

update public.services
set category = case
  when name ~* '(химчист|детейлинг салона|салон|сиден|кожан)' then 'Салон'
  when name ~* '(полир|царап|восстановлен лак|блеск кузов)' then 'Полировка'
  when name ~* '(керамик|антидожд|жидкое стекло|антигравийн|защитн плен|воск)' then 'Защита кузова'
  when name ~* '(мойк|бесконтакт|двухфаз)' then 'Мойка'
  else 'Другое'
end;

alter table public.services add constraint services_category_valid
  check (category = btrim(category) and char_length(category) between 1 and 60);

drop function public.owner_upsert_service(text, uuid, text, integer, integer, boolean);

create function public.owner_upsert_service(
  p_slug text,
  p_id uuid,
  p_name text,
  p_price_cents integer,
  p_duration integer,
  p_active boolean,
  p_category text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid;
  v uuid;
  c text := coalesce(nullif(btrim(p_category), ''), 'Другое');
begin
  t := owner_tenant(p_slug);
  if p_name is null or length(trim(p_name)) = 0 or p_price_cents is null or p_price_cents < 0
    or p_duration is null or p_duration <= 0 or p_active is null or char_length(c) > 60 then
    raise exception 'bad_service';
  end if;
  if p_id is null then
    insert into services(tenant_id, name, category, price_cents, duration_minutes, active)
    values (t, trim(p_name), c, p_price_cents, p_duration, p_active)
    returning id into v;
  else
    update services
    set name = trim(p_name), category = c, price_cents = p_price_cents, duration_minutes = p_duration, active = p_active
    where id = p_id and tenant_id = t
    returning id into v;
    if v is null then raise exception 'forbidden'; end if;
  end if;
  return v;
end;
$$;

revoke all on function public.owner_upsert_service(text, uuid, text, integer, integer, boolean, text) from public, anon;
grant execute on function public.owner_upsert_service(text, uuid, text, integer, integer, boolean, text) to authenticated;

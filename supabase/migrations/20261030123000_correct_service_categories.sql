update public.services
set category = case
  when name ~* '(химчист|детейлинг салона|салон|сиден|кожан|коврик|обивк)' then 'Салон'
  when name ~* '(полир|царап|восстановлен лак|блеск кузов)' then 'Полировка'
  when name ~* '(керамич|антидожд|жидкое стекло|антигравийн|защитн плен|воск)' then 'Защита кузова'
  when name ~* '(ржавчин|кузовной ремонт|вмятин|покрас|скол)' then 'Кузовной ремонт'
  when name ~* '(мойк|бесконтакт|двухфаз)' then 'Мойка'
  else category
end
where category = 'Другое';

update public.tenants
set config = jsonb_set(config, '{cards,catalog}',
  '{"title":"Каталог услуг","text":"Выберите категорию или найдите услугу в прайсе"}'::jsonb, true)
where config ? 'cards' and config->'cards' ? 'catalog';

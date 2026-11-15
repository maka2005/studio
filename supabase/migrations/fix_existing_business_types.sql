-- ОПЦИОНАЛЬНО, разовый скрипт (не миграция). Исправляет config.business_type у организаций,
-- созданных через публичную форму до исправления: у них везде стоял 'autoservice'.
-- Тип берётся из связанной заявки (platform_business_leads.tenant_id). Организации без заявки не трогаются.

-- 1) Сначала посмотрите, что изменится:
select t.slug, t.config->>'business_type' as now, l.business_type as lead_type,
  case lower(trim(l.business_type))
    when 'сто / автосервис' then 'autoservice' when 'детейлинг-студия' then 'detailing'
    when 'автомойка' then 'carwash' when 'шиномонтаж' then 'tires' else 'other' end as will_be
from public.tenants t
join public.platform_business_leads l on l.tenant_id = t.id
where t.config->>'business_type' is distinct from
  case lower(trim(l.business_type))
    when 'сто / автосервис' then 'autoservice' when 'детейлинг-студия' then 'detailing'
    when 'автомойка' then 'carwash' when 'шиномонтаж' then 'tires' else 'other' end;

-- 2) Если результат верный, примените:
update public.tenants t
set config = jsonb_set(t.config, '{business_type}', to_jsonb(
  case lower(trim(l.business_type))
    when 'сто / автосервис' then 'autoservice' when 'детейлинг-студия' then 'detailing'
    when 'автомойка' then 'carwash' when 'шиномонтаж' then 'tires' else 'other' end))
from public.platform_business_leads l
where l.tenant_id = t.id;

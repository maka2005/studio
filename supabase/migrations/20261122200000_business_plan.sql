-- Third public tariff for studio chains. Limits are null = unlimited.
-- Feature keys are limited to telegram/export/reviews (see src/lib/planFeatures.ts).
insert into public.plans(
  code, name, description, price_kzt, period_months, features,
  is_active, sort_order, limits, feature_access
) values (
  'BUSINESS',
  'BUSINESS',
  'Для сетей точек: онлайн-запись, кабинет, Telegram-уведомления, отзывы и выгрузка данных без ограничений',
  49000,
  1,
  '["Онлайн-запись","Кабинет владельца","Telegram-уведомления","Отзывы","Выгрузка данных","Приоритетная поддержка"]',
  true,
  30,
  '{"employees":null,"services":null,"branches":null,"bookings_per_month":null}'::jsonb,
  '{"telegram":true,"export":true,"reviews":true}'::jsonb
)
on conflict(code) do nothing;

-- Keep the entitlements in sync if the plan was seeded manually before.
update public.plans
set limits = '{"employees":null,"services":null,"branches":null,"bookings_per_month":null}'::jsonb,
    feature_access = '{"telegram":true,"export":true,"reviews":true}'::jsonb
where code = 'BUSINESS';

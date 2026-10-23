# Запуск

## Локально
1. `pnpm install`
2. `pnpm tenant:validate graphite`, затем `pnpm dev` (перед стартом собирается `public/tenants/`).
3. Скопируйте `.env.example` в `.env.local` и заполните `VITE_SUPABASE_*`.

## Supabase
1. SQL Editor, по порядку: `supabase/migrations/0001_core.sql`, `0002_slots_my_booking.sql`, `0003_owner_limits.sql`.
2. Сид студии: `pnpm tenant:sql graphite`, затем выполнить `supabase/seed/graphite.sql`. Повторный запуск обновляет настройки и цены, записи не трогает.
3. Владелец: Authentication → Users → Add user (почта + пароль, публичной регистрации нет; отключите «Allow new users to sign up»). Затем в SQL:
   `insert into tenant_members(tenant_id,user_id) select t.id,u.id from tenants t, auth.users u where t.slug='graphite' and u.email='owner@example.com';`
4. Помощник: `supabase functions deploy assistant`, затем
   `supabase secrets set LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=... LLM_DAILY_TOKEN_CAP=200000`.
5. Без ключей LLM помощник отвечает «недоступен», запись работает.

## Vercel
Подключите репозиторий, команды по умолчанию (`pnpm build`), задайте `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`. `vercel.json` уже перенаправляет `/s/<slug>/…` на оболочку.

## Новая студия
`pnpm tenant:new my-studio` → правка `tenants/my-studio/business.json`, картинки в `images/` (logo, hero, work*, icon-192.png, icon-512.png) → `pnpm tenant:validate my-studio` → `pnpm tenant:sql my-studio` → выполнить SQL → деплой. Ссылка: `/s/my-studio/`.
Пока `"demo": true`, студия в статусе preview. Для боевой студии уберите demo, положите реальные картинки и снова выполните `tenant:validate`.

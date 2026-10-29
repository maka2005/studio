# Запуск

## Локально
1. `pnpm install`
2. `pnpm tenant:validate graphite`, затем `pnpm dev` (перед стартом собирается `public/tenants/`).
3. Скопируйте `.env.example` в `.env.local` и заполните `VITE_SUPABASE_*`.

## Supabase
1. SQL Editor, по порядку выполните все ещё не применённые миграции `supabase/migrations/0001_core.sql`–`0010_slot_closing_time.sql`. Если миграции до `0009` уже применены, выполните `0010_slot_closing_time.sql`.
2. Сид студии: `pnpm tenant:sql graphite`, затем выполнить `supabase/seed/graphite.sql`. Повторный запуск обновляет настройки и цены, записи не трогает.
3. Владелец: Authentication → Users → Add user (почта + пароль, публичной регистрации нет; отключите «Allow new users to sign up»). Затем в SQL:
   `insert into tenant_members(tenant_id,user_id) select t.id,u.id from tenants t, auth.users u where t.slug='graphite' and u.email='owner@example.com';`
4. Помощник: `supabase functions deploy assistant`, затем
   `supabase secrets set LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=... LLM_DAILY_TOKEN_CAP=200000`.
5. Без ключей LLM помощник отвечает «недоступен», запись работает.

### Telegram-уведомления
1. В BotFather создайте бота. В Vercel задайте `VITE_TELEGRAM_BOT` как username без `@` и пересоберите приложение.
2. В Supabase задайте серверные секреты `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (1–256 символов из `A-Z`, `a-z`, `0-9`, `_`, `-`), `CRON_SECRET` и `SITE_URL` (публичный адрес сайта). Токен бота не задавайте как `VITE_*`.
3. Разверните функции: `supabase functions deploy telegram-webhook --no-verify-jwt` и `supabase functions deploy notify-dispatch --no-verify-jwt`.
4. Зарегистрируйте webhook у Telegram, подставив адрес проекта и тот же секрет:
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<PROJECT_REF>.supabase.co/functions/v1/telegram-webhook&secret_token=<WEBHOOK_SECRET>`
5. Для доставки очереди включите расширения `pg_cron`, `pg_net` и Vault в Supabase. Сохраните `CRON_SECRET` в Vault под именем `cron_secret`, затем создайте расписание в SQL Editor:
   ```sql
   select cron.schedule('notify-dispatch', '* * * * *', $$
     select net.http_post(
       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-dispatch',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
       ),
       body := '{}'::jsonb
     );
   $$);
   ```
6. Войдите владельцем, откройте «Уведомления» → «Подключить чат» и нажмите «Запустить» в Telegram. Новые клиентские записи и отмены будут доставляться в течение минуты. Ручные записи владельца намеренно не отправляют уведомление.

## Vercel
Подключите репозиторий, команды по умолчанию (`pnpm build`), задайте `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`. `vercel.json` уже перенаправляет `/s/<slug>/…` на оболочку.

## Новая студия
`pnpm tenant:new my-studio` → правка `tenants/my-studio/business.json`, картинки в `images/` (logo, hero, work*, icon-192.png, icon-512.png) → `pnpm tenant:validate my-studio` → `pnpm tenant:sql my-studio` → выполнить SQL → деплой. Ссылка: `/s/my-studio/`.
Пока `"demo": true`, студия в статусе preview. Для боевой студии уберите demo, положите реальные картинки и снова выполните `tenant:validate`.

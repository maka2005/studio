# Запуск

## Локально
1. `pnpm install`
2. `pnpm tenant:validate graphite`, затем `pnpm dev` (перед стартом собирается `public/tenants/`).
3. Скопируйте `.env.example` в `.env.local` и заполните `VITE_SUPABASE_*`.

## Supabase
1. SQL Editor, по порядку выполните все ещё не применённые миграции `supabase/migrations/0001_core.sql`–`0012_reuse_telegram_link_code.sql`. Если проект уже обновлялся по предыдущей инструкции, примените `0012_reuse_telegram_link_code.sql`.
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
7. Клиентские сообщения выключены по умолчанию. После проверки токена и webhook включите флажок «Разрешить клиентам подключать уведомления в Telegram» в том же разделе.
8. Клиент может подключить Telegram после записи или позднее в разделе «Моя запись». Регистрация на сайте не нужна: клиент отмечает отдельное согласие, открывает персональную ссылку и нажимает «Запустить» в боте. Бот отправляет подтверждение, напоминает за 24 часа (или сразу, если запись создана ближе чем за сутки) и сообщает об отмене. Команда `/stop` отключает все уведомления этого Telegram-чата.

## Vercel
Подключите репозиторий, команды по умолчанию (`pnpm build`), задайте `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`. `vercel.json` уже перенаправляет `/s/<slug>/…` на оболочку.

## Новая студия
`pnpm tenant:new my-studio` → правка `tenants/my-studio/business.json`, картинки в `images/` (logo, hero, work*, icon-192.png, icon-512.png) → `pnpm tenant:validate my-studio` → `pnpm tenant:sql my-studio` → выполнить SQL → деплой. Ссылка: `/s/my-studio/`.
Пока `"demo": true`, студия в статусе preview. Для боевой студии уберите demo, положите реальные картинки и снова выполните `tenant:validate`.

## Перед коммерческим запуском
- Создайте отдельного tenant для клиента, загрузите реальные услуги, цены, расписание, адрес, фото и реквизиты; удалите демонстрационные записи и проверьте часовой пояс.
- Переведите tenant из `preview` в `live` только после проверки конфигурации, владельца и юридических страниц.
- Подключите домен клиента и проверьте HTTPS, мобильную запись, отмену, Telegram webhook и напоминание.
- Владелец подключает Telegram отдельно. Сначала отправьте тестовую запись в подключённый чат; клиентскую функцию включайте только после ротации токена бота и проверки `/start`.
- Для продажи как SaaS дополнительно нужны процесс онбординга tenant, договорённости о поддержке/оплате и проверка прав доступа/резервного восстановления базы. Сейчас новый tenant настраивается вручную.

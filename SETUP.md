# Запуск

## Локально
1. `npm install`
2. `npm run tenant:validate -- graphite`, затем `npm run dev` (перед стартом собирается `public/tenants/`).
3. Скопируйте `.env.example` в `.env.local` и заполните `VITE_SUPABASE_*`.

## Supabase
1. Применить все миграции в нужном порядке из `supabase/migrations/` (в репозитории их 69): `supabase db push` (или `supabase migration up` в зависимости от вашего процесса). Это гарантирует корректный порядок применения миграций. При ручной установке можно выполнять SQL-файлы в Supabase SQL Editor только в хронологическом порядке.
2. Seed студии: `npm run tenant:sql -- graphite`, затем выполнить `supabase/seed/graphite.sql`. Настройки студии обновлять в кабинете.
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

### Шаблоны, статусы доставки и отказы
1. Миграция `20261118140000_notification_delivery.sql` добавляет таблицы `notification_templates` и `bounce_suppressions`, а также RPC для владельца и платформы. Примените её: `npx --yes supabase db push --linked --include-all`.
2. В кабинете владельца «Настройки → Уведомления» можно заменить текст любого из 10 сообщений (5 событий × клиент/студия). Пустой текст возвращает стандартную формулировку. Допустимы подстановки `{studio} {service} {date} {time} {address} {customer} {phone} {car} {price}`; все значения экранируются перед отправкой в Telegram.
3. Там же доступна история каждой отправки: статус, число попыток, ошибка и кнопка «Повторить» для неудачных задач. Неудачную задачу можно повторить вручную — она получит новый ключ и не попадёт под старый дедупликационный ключ.
4. Для учёта почтовых отказов разверните функцию: `supabase functions deploy email-bounce-webhook --no-verify-jwt`. Задайте секрет `BOUNCE_WEBHOOK_SECRET` (если он не задан, используется `CRON_SECRET`) и укажите webhook провайдера на `https://<PROJECT_REF>.supabase.co/functions/v1/email-bounce-webhook?provider=<name>` с заголовком `x-webhook-secret`. Функция принимает данные от разных провайдеров, записывает адрес в список подавлений и помечает жёсткие отказы как failures.
5. В админке платформы раздел «Уведомления и доставка» показывает сводку за 30 дней, фильтры по статусу и типу, постраничную историю и список отказов. Фильтры можно сохранять и выгружать в CSV.

## Vercel
Подключите репозиторий, команды по умолчанию (`npm run build`), задайте `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`. `vercel.json` уже перенаправляет `/s/<slug>/…` на оболочку.

## Новая студия
`npm run tenant:new -- my-studio` → правка `tenants/my-studio/business.json`, картинки в `images/` (logo, hero, work*, icon-192.png, icon-512.png) → `npm run tenant:validate -- my-studio` → `npm run tenant:sql -- my-studio` → выполнить SQL → деплой. Ссылка: `/s/my-studio/`.
Пока `"demo": true`, студия в статусе preview. Для боевой студии уберите demo, положите реальные картинки и снова выполните `tenant:validate`.

## Перед коммерческим запуском
- Создайте отдельного tenant для клиента, загрузите реальные услуги, цены, расписание, адрес, фото и реквизиты; удалите демонстрационные записи и проверьте часовой пояс.
- Переведите tenant из `preview` в `live` только после проверки конфигурации, владельца и юридических страниц.
- Подключите домен клиента и проверьте HTTPS, мобильную запись, отмену, Telegram webhook и напоминание.
- Владелец подключает Telegram отдельно. Сначала отправьте тестовую запись в подключённый чат; клиентскую функцию включайте только после ротации токена бота и проверки `/start`.
- Для продажи как SaaS дополнительно нужны процесс онбординга tenant, договорённости о поддержке/оплате и проверка прав доступа/резервного восстановления базы. Сейчас новый tenant настраивается вручную.

## Вход владельца: привязка к организации и ссылки из писем

- Вход в кабинет `/s/<slug>/owner` привязан к организации: функция `owner-login` выдаёт сессию только участнику (`tenant_members`) именно этой организации. При верном пароле, но чужой организации возвращается `wrong_organization` со списком организаций самого пользователя, сессия не создаётся.
- Владелец записывается в `tenant_members` в момент создания организации (RPC), а Edge Function дополнительно проверяет эту запись (`ensureOwnerMembership`).
- Supabase → Authentication → URL Configuration → **Redirect URLs** должен содержать `https://<ваш-домен>/**`, иначе ссылка из письма «Задать пароль» уйдёт на Site URL, а не в кабинет организации.
- Найти организации без владельца:
  `select t.slug from tenants t where not exists (select 1 from tenant_members m where m.tenant_id=t.id and m.role='owner');`
- После правок нужно задеплоить функции `owner-login` и `platform-admin` и фронтенд/`api/owner.js`.

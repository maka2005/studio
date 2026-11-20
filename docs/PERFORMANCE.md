# Database performance & scale runbook

Applies after migration `20261117130000_performance_indexes_pagination.sql`.

## Deploy

1. Apply migrations to staging first: `supabase db push --linked`.
2. Run `analyze` on the hot tables in a maintenance window:

   ```sql
   analyze public.bookings;
   analyze public.payments;
   analyze public.services;
   analyze public.tenant_members;
   analyze public.notification_jobs;
   analyze public.admin_audit_events;
   analyze public.booking_report_daily;
   ```

3. Validate the actual plans with your data volume:

   ```sql
   explain (analyze, buffers)
   select * from public.bookings
   where tenant_id = '<uuid>' and starts_at >= now() - interval '30 days'
   order by starts_at desc;
   ```

   Look for `Index Scan using bookings_tenant_start_idx`; a sequential scan on a large
   `bookings` table means statistics or predicates need another look.

## Keyset pagination

New RPCs return a single JSON object:

```json
{ "items": [ ... ], "has_more": true, "next_cursor": { "starts_at": "...", "id": "..." } }
```

Available functions (all owner-scoped via `owner_tenant`, `statement_timeout = 5s`):

- `owner_bookings_page(p_slug, p_from, p_to, p_limit = 50, p_cursor = null)`
- `owner_audit_history_page(p_slug, p_limit = 50, p_cursor = null)`
- `owner_billing_notifications_page(p_slug, p_limit = 50, p_cursor = null)`
- `owner_reviews_page(p_slug, p_limit = 50, p_cursor = null)`
- `owner_waitlist_page(p_slug, p_limit = 50, p_cursor = null)`

Client wrappers live in `src/lib/api.ts` under `owner.*Page` and use the `CursorPage<T>`
type. Pass `next_cursor` back unchanged; never build a cursor manually. `p_limit` is
clamped to `1..200`. The old `limit/offset` RPCs remain for backwards compatibility.

The owner UI now consumes these RPCs: `reports.tsx` uses `waitlistPage`, `reviewsPage`
and `auditHistoryPage`; `cabinet.tsx` uses `billingNotificationsPage`; `bookings.tsx`
and report exports use `bookingsAll`, which walks `bookingsPage` with `p_limit = 200`
and re-sorts rows by `starts_at` to preserve the previous calendar/CSV order.
New RPC names are allowlisted in `api/owner.js` (`OWNER_RPCS`) so the Vercel proxy
forwards them. Lists that need a full dataset (report aggregates, CSV) are streamed
through `collectCursorPages` instead of issuing one large `offset` query.

## Report rollups

`booking_report_daily` stores per-tenant, per-day `visits / done / booked /
received_cents / expected_cents`. Use the helper that walks every tenant:

```sql
select public.refresh_all_booking_reports(7);
```

If `pg_cron` is enabled, migration `20261118120000_schedule_maintenance_jobs.sql`
installs the idempotent job `platform-refresh-booking-report-daily` (`20 1 * * *`)
that calls this helper. For backfills, call `refresh_booking_report_daily(tenant,
from, to)` directly with `service_role`.

Owners read the rollup with `owner_daily_metrics(p_slug, p_from, p_to)`. If the
table is empty for a date range, there is nothing to display until the first
refresh completes — seed historical ranges once after deploying.

## Retention

`archive_old_operational_rows(p_older_than_days = 365, p_batch_limit = 1000)` copies
old `admin_audit_events` and terminal `notification_jobs` into `*_archive` tables and
deletes the originals in bounded batches. `p_older_than_days` is clamped to at least
30 and the batch to at most 5000 rows. The same maintenance migration schedules
`platform-archive-old-operational-rows` (`40 3 * * 0`) when `pg_cron` is available.

Check archived counts:

```sql
select 'audit' as kind, count(*) from public.admin_audit_events_archive
union all
select 'jobs', count(*) from public.notification_jobs_archive;
```

## RLS / SECURITY DEFINER notes

- `is_member(tenant_id)` is backed by the `tenant_members` primary key and the
  new `tenant_members_tenant_role_user_idx`; keep membership predicates shaped as
  `tenant_id = <const>` so the index is usable.
- All new owner RPCs are `security definer` with an explicit `search_path` and a
  per-function statement timeout. Do not grant `service_role`-only helpers
  (`refresh_booking_report_daily`, `archive_old_operational_rows`) to clients.

## Timeouts

New read RPCs use a 5s statement timeout; maintenance helpers use 30s. For the
Vercel API and Edge Functions, keep upstream `AbortSignal` timeouts below the
database timeout so clients receive a controlled error instead of a 504.

## Frontend & delivery

- React Query defaults in `src/main.tsx`: `staleTime: 30s`, `gcTime: 5m`,
  `refetchOnWindowFocus: false`, mutations do not retry. Owner cabinet tabs warm
  their query cache on hover/focus, and mutations invalidate only the affected
  query keys (bookings, stats, slots, reports) instead of the whole `['owner']`
  tree.
- Owner cabinet, platform admin and their heavy sections are lazy routes/chunks.
  Keep new sections behind `React.lazy` + `Suspense` so the initial bundle stays small.
- Tenant images use `TenantImage`: Supabase Storage render URLs provide `width`
  variants through `srcset`, automatic WebP negotiation, explicit dimensions and
  lazy loading. Above-the-fold logos can pass `priority`.
- `vercel.json` caches hashed `/assets` and `/tenants` assets for a year, keeps
  personal pages (`/s/:slug/owner`, `/platform/admin`) and personal APIs
  (`/api/owner`, `/api/platform`, `/api/csp-report`) on `no-store`, and leaves
  `/api/health` with its short shared cache. Search inputs are debounced in owner
  bookings and platform tenants to avoid a request per keystroke.

## Platform admin lists

Migration `20261118150000_platform_admin_pagination.sql` adds `p_offset` to
`platform_list_subscriptions` and `platform_notifications`. The edge dispatcher
forwards `offset` for both actions; old calls without the new argument keep working.
`business_leads` supports a sanitized `search` predicate across name, owner, email
and phone.

Shared helpers in `src/pages/platform-admin/shared.tsx`:

- `usePlatformFilters` debounces every field by 300ms and persists named presets in
  `localStorage` under a per-list key. Changing any filter resets pagination.
- `FilterBar` renders the preset picker/save/reset/CSV controls.
- `downloadCsv` writes a BOM, semicolon-separated values and prefixes formula-looking
  cells with `'` to prevent spreadsheet injection.
- `exportAllRows` walks array-returning actions; `exportPagedRows` walks
  `{ rows, count, limit }` actions and follows the server-reported page size.

Audit, support tickets, leads, payments and subscriptions all use these helpers.
CSV exports stream in bounded batches (at most 200 rows per request, 50 for ticket
and lead endpoints) instead of loading an unbounded response.

## Notification delivery & bounces

Migration `20261118140000_notification_delivery.sql` adds per-tenant
`notification_templates` with `audience` (`client`/`owner`), delivery fields on
`notification_jobs` (`channel`, `template_code`, `bounced_at`, `bounce_type`) and
`bounce_suppressions`. The worker reads active templates once per job batch and
records the applied template id through the new four-argument
`finish_notification_job`.

`record_email_bounce` is service-role only and is exposed through the
`email-bounce-webhook` Edge Function (`x-webhook-secret`; dedicated
`BOUNCE_WEBHOOK_SECRET` is preferred, `CRON_SECRET` is still accepted for
backward compatibility). Bodies are capped at 64 KB, secrets are compared in
constant time, and an optional HMAC envelope (`x-webhook-timestamp`,
`x-webhook-nonce`, `x-webhook-signature`) adds a five-minute replay window.
Repeating the same provider event is a no-op at two levels: the
`processed_webhook_events` ledger (`consume_webhook_event`, cleaned daily by
`webhook-cleanup-processed-events`) and the `(provider, event_id, recipient)`
unique key on `bounce_suppressions`. A later hard bounce now escalates an
earlier soft bounce. Telegram updates are deduplicated by `update_id`.

Platform reporting RPCs (`platform_notification_delivery`,
`platform_notification_bounces`, `platform_notifications`,
`platform_mark_notifications_read`, `platform_list_subscriptions`) and the
schedule helpers (`effective_day_hours`, `slot_in_break`) are service-role
only. Owner RPCs are templates/list/retry/bounces. Operational failures are
written to `platform_alert_events` through `record_ops_alert`; the hourly
`platform-collect-cron-failures-hourly` job reports failed cron runs, and the
`ops-alert` Edge Function can forward them to `ALERT_WEBHOOK_URL`.

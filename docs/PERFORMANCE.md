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
received_cents / expected_cents`. Refresh it on a schedule (pg_cron or an Edge
Function with `service_role`):

```sql
-- Example: refresh the last 7 days for every tenant (run daily).
do $$
declare t uuid;
begin
  for t in select id from public.tenants loop
    perform public.refresh_booking_report_daily(
      t, current_date - 7, current_date
    );
  end loop;
end $$;
```

Owners read the rollup with `owner_daily_metrics(p_slug, p_from, p_to)`. If the
table is empty for a date range, there is nothing to display until the first
refresh completes — seed historical ranges once after deploying.

## Retention

`archive_old_operational_rows(p_older_than_days = 365, p_batch_limit = 1000)` copies
old `admin_audit_events` and terminal `notification_jobs` into `*_archive` tables and
deletes the originals in bounded batches. Schedule it via `service_role` only;
`p_older_than_days` is clamped to at least 30 and the batch to at most 5000 rows.

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

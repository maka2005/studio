-- Performance / scale pass (forward-only migration).
--
-- Goals:
--   1. Explicit composite indexes for the real read paths (calendar, client history,
--      catalog, membership checks, notification/audit queues and billing events).
--   2. Keyset ("cursor") pagination RPCs for growing lists. Existing RPCs are kept
--      untouched for backwards compatibility; new *_page functions return
--      { items, next_cursor, has_more }.
--   3. Pre-aggregated daily report rollups (refreshed by scheduler / Edge Function)
--      plus an owner-facing reader so dashboards stop recalculating raw rows.
--   4. Bounded archival/retention helpers for audit and notification history.
--   5. Per-function statement timeouts on the new expensive read paths.
--
-- IMPORTANT: after deploying run `analyze` on large tables in a maintenance window
-- and validate the top queries with EXPLAIN (ANALYZE, BUFFERS) in a staging DB.
-- No local Supabase instance was available while authoring this migration.

-- ---------------------------------------------------------------------------
-- 1) Indexes for real query shapes
-- ---------------------------------------------------------------------------

-- Calendar / list / report scans: tenant + time is the dominant predicate.
create index if not exists bookings_tenant_start_idx
  on public.bookings (tenant_id, starts_at desc);
create index if not exists bookings_tenant_status_start_idx
  on public.bookings (tenant_id, status, starts_at desc);

-- Client history and phone search (existing partial index only covers done bookings).
create index if not exists bookings_tenant_phone_start_idx
  on public.bookings (tenant_id, customer_phone, starts_at desc);

-- Owner stats receive-money aggregate sums payments by tenant + created_at.
create index if not exists payments_tenant_created_idx
  on public.payments (tenant_id, created_at desc);

-- Public catalog: active services filtered/sorted by category and price.
create index if not exists services_tenant_active_category_price_idx
  on public.services (tenant_id, active, category, price_cents, name);

-- Membership/role checks. PK already covers (tenant_id, user_id); this index
-- covers role-scoped checks used by team/access functions.
create index if not exists tenant_members_tenant_role_user_idx
  on public.tenant_members (tenant_id, role, user_id);

-- Audit and outbox queues: tenant-scanted chronological reads and status filters.
create index if not exists admin_audit_events_tenant_entity_created_idx
  on public.admin_audit_events (tenant_id, entity, created_at desc, id desc);
create index if not exists notification_jobs_tenant_status_created_idx
  on public.notification_jobs (tenant_id, status, created_at desc);
create index if not exists notification_jobs_retry_idx
  on public.notification_jobs (status, run_after)
  where status in ('pending', 'failed');

-- Reviews / waitlist / billing notification page reads.
create index if not exists booking_reviews_tenant_published_created_idx
  on public.booking_reviews (tenant_id, published, created_at desc, id desc);
create index if not exists waitlist_tenant_status_created_idx
  on public.waitlist (tenant_id, status, created_at desc);
create index if not exists subscription_events_sub_created_idx
  on public.subscription_events (subscription_id, created_at desc, id desc);

-- Business invariants. Guarded so that deployment does not fail on already
-- inconsistent historical data; a notice is emitted for manual cleanup instead.
do $$
begin
  if not exists (
    select 1 from public.resource_occupancies
    where booking_id is not null
    group by tenant_id, booking_id
    having count(*) > 1
  ) then
    create unique index if not exists resource_occupancies_one_per_booking_uidx
      on public.resource_occupancies (tenant_id, booking_id)
      where booking_id is not null;
  else
    raise notice 'skip resource_occupancies_one_per_booking_uidx: duplicate occupancy rows exist for some bookings';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Keyset pagination RPCs
--    Cursor is an opaque jsonb object; clients must pass it back unchanged.
--    Every function reads one extra row to compute has_more, never uses OFFSET.
-- ---------------------------------------------------------------------------

create or replace function public.owner_bookings_page(
  p_slug text, p_from date, p_to date,
  p_limit integer default 50, p_cursor jsonb default null
) returns jsonb
language plpgsql stable security definer
set search_path=public
set statement_timeout='5s'
as $$
declare
  t uuid; tz text; a timestamptz; z timestamptz;
  cs timestamptz; ci uuid;
  lim integer; items jsonb; last_item jsonb; more boolean;
begin
  t := public.owner_tenant(p_slug);
  lim := least(greatest(coalesce(p_limit, 50), 1), 200);
  select tenants.timezone into tz from public.tenants where id = t;
  a := p_from::timestamp at time zone tz;
  z := (p_to + 1)::timestamp at time zone tz;
  if p_cursor is not null then
    cs := (p_cursor ->> 'starts_at')::timestamptz;
    ci := (p_cursor ->> 'id')::uuid;
    if cs is null or ci is null then raise exception 'bad_cursor'; end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.starts_at desc, x.id desc), '[]'::jsonb)
  into items
  from (
    select b.id, b.service_id, s.name as service_name, b.starts_at, b.ends_at, b.status,
      b.customer_name, b.customer_phone, b.car, b.price_cents,
      coalesce((
        select sum(case p.kind when 'payment' then p.amount_cents else -p.amount_cents end)
        from public.payments p where p.booking_id = b.id and p.tenant_id = t
      ), 0)::int as paid_cents,
      r.name as resource_name
    from public.bookings b
    join public.services s on s.tenant_id = b.tenant_id and s.id = b.service_id
    join public.resources r on r.tenant_id = b.tenant_id and r.id = b.resource_id
    where b.tenant_id = t and b.starts_at >= a and b.starts_at < z
      and (cs is null or (b.starts_at, b.id) < (cs, ci))
    order by b.starts_at desc, b.id desc
    limit lim + 1
  ) x;

  more := jsonb_array_length(items) > lim;
  if more then items := items - lim; end if;
  last_item := items -> (jsonb_array_length(items) - 1);
  return jsonb_build_object(
    'items', items,
    'has_more', more,
    'next_cursor', case when more and last_item is not null then jsonb_build_object(
      'starts_at', last_item ->> 'starts_at', 'id', last_item ->> 'id'
    ) else null end
  );
end $$;

create or replace function public.owner_audit_history_page(
  p_slug text, p_limit integer default 50, p_cursor jsonb default null
) returns jsonb
language plpgsql stable security definer
set search_path=public,auth
set statement_timeout='5s'
as $$
declare
  t uuid; cs timestamptz; ci bigint;
  lim integer; items jsonb; last_item jsonb; more boolean;
begin
  t := public.owner_tenant(p_slug);
  lim := least(greatest(coalesce(p_limit, 50), 1), 200);
  if p_cursor is not null then
    cs := (p_cursor ->> 'created_at')::timestamptz;
    ci := (p_cursor ->> 'id')::bigint;
    if cs is null or ci is null then raise exception 'bad_cursor'; end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc), '[]'::jsonb)
  into items
  from (
    select e.id, e.created_at, e.entity, e.entity_id, e.action, e.details,
      u.email::text as actor_email
    from public.admin_audit_events e
    left join auth.users u on u.id = e.actor_id
    where e.tenant_id = t
      and (cs is null or (e.created_at, e.id) < (cs, ci))
    order by e.created_at desc, e.id desc
    limit lim + 1
  ) x;

  more := jsonb_array_length(items) > lim;
  if more then items := items - lim; end if;
  last_item := items -> (jsonb_array_length(items) - 1);
  return jsonb_build_object(
    'items', items,
    'has_more', more,
    'next_cursor', case when more and last_item is not null then jsonb_build_object(
      'created_at', last_item ->> 'created_at', 'id', last_item ->> 'id'
    ) else null end
  );
end $$;

create or replace function public.owner_billing_notifications_page(
  p_slug text, p_limit integer default 50, p_cursor jsonb default null
) returns jsonb
language plpgsql stable security definer
set search_path=public
set statement_timeout='5s'
as $$
declare
  t uuid; actor uuid := auth.uid(); cs timestamptz; ci uuid;
  lim integer; items jsonb; last_item jsonb; more boolean;
begin
  t := public.owner_tenant(p_slug);
  lim := least(greatest(coalesce(p_limit, 50), 1), 200);
  if p_cursor is not null then
    cs := (p_cursor ->> 'created_at')::timestamptz;
    ci := (p_cursor ->> 'id')::uuid;
    if cs is null or ci is null then raise exception 'bad_cursor'; end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc), '[]'::jsonb)
  into items
  from (
    select e.id, e.type as event_type, e.payload, e.created_at,
      exists(
        select 1 from public.owner_billing_notification_reads r
        where r.event_id = e.id and r.user_id = actor
      ) as is_read
    from public.subscription_events e
    join public.subscriptions s on s.id = e.subscription_id
    where s.tenant_id = t
      and e.type in ('suspended','resumed','expired','grace_started','extended','plan_changed',
                     'dates_changed','cancelled','payment_failed','price_change_accepted','price_change_declined')
      and (cs is null or (e.created_at, e.id) < (cs, ci))
    order by e.created_at desc, e.id desc
    limit lim + 1
  ) x;

  more := jsonb_array_length(items) > lim;
  if more then items := items - lim; end if;
  last_item := items -> (jsonb_array_length(items) - 1);
  return jsonb_build_object(
    'items', items,
    'has_more', more,
    'next_cursor', case when more and last_item is not null then jsonb_build_object(
      'created_at', last_item ->> 'created_at', 'id', last_item ->> 'id'
    ) else null end
  );
end $$;

create or replace function public.owner_reviews_page(
  p_slug text, p_limit integer default 50, p_cursor jsonb default null
) returns jsonb
language plpgsql stable security definer
set search_path=public
set statement_timeout='5s'
as $$
declare
  t uuid; cs timestamptz; ci uuid;
  lim integer; items jsonb; last_item jsonb; more boolean;
begin
  t := public.owner_tenant(p_slug);
  lim := least(greatest(coalesce(p_limit, 50), 1), 200);
  if p_cursor is not null then
    cs := (p_cursor ->> 'created_at')::timestamptz;
    ci := (p_cursor ->> 'id')::uuid;
    if cs is null or ci is null then raise exception 'bad_cursor'; end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc), '[]'::jsonb)
  into items
  from (
    select r.id, r.booking_id, r.rating, r.comment, r.published, r.created_at,
      b.customer_name, s.name as service_name
    from public.booking_reviews r
    join public.bookings b on b.id = r.booking_id and b.tenant_id = r.tenant_id
    join public.services s on s.id = b.service_id and s.tenant_id = b.tenant_id
    where r.tenant_id = t
      and (cs is null or (r.created_at, r.id) < (cs, ci))
    order by r.created_at desc, r.id desc
    limit lim + 1
  ) x;

  more := jsonb_array_length(items) > lim;
  if more then items := items - lim; end if;
  last_item := items -> (jsonb_array_length(items) - 1);
  return jsonb_build_object(
    'items', items,
    'has_more', more,
    'next_cursor', case when more and last_item is not null then jsonb_build_object(
      'created_at', last_item ->> 'created_at', 'id', last_item ->> 'id'
    ) else null end
  );
end $$;

create or replace function public.owner_waitlist_page(
  p_slug text, p_limit integer default 50, p_cursor jsonb default null
) returns jsonb
language plpgsql stable security definer
set search_path=public
set statement_timeout='5s'
as $$
declare
  t uuid; cd date; cs timestamptz; ci uuid;
  lim integer; items jsonb; last_item jsonb; more boolean;
begin
  t := public.owner_tenant(p_slug);
  lim := least(greatest(coalesce(p_limit, 50), 1), 200);
  if p_cursor is not null then
    cd := (p_cursor ->> 'preferred_day')::date;
    cs := (p_cursor ->> 'created_at')::timestamptz;
    ci := (p_cursor ->> 'id')::uuid;
    if cd is null or cs is null or ci is null then raise exception 'bad_cursor'; end if;
  end if;

  -- preferred_day is ASC while created_at/id are DESC, so the keyset predicate
  -- cannot use a single row comparison: day > cursor_day OR (same day AND newer keys).
  select coalesce(jsonb_agg(to_jsonb(x) order by x.preferred_day, x.created_at desc, x.id desc), '[]'::jsonb)
  into items
  from (
    select w.id, s.name as service_name, w.preferred_day, w.customer_name,
      w.customer_phone, w.car, w.status, w.created_at
    from public.waitlist w
    join public.services s on s.tenant_id = w.tenant_id and s.id = w.service_id
    where w.tenant_id = t
      and (
        cd is null
        or w.preferred_day > cd
        or (w.preferred_day = cd and (w.created_at, w.id) < (cs, ci))
      )
    order by w.preferred_day, w.created_at desc, w.id desc
    limit lim + 1
  ) x;

  more := jsonb_array_length(items) > lim;
  if more then items := items - lim; end if;
  last_item := items -> (jsonb_array_length(items) - 1);
  return jsonb_build_object(
    'items', items,
    'has_more', more,
    'next_cursor', case when more and last_item is not null then jsonb_build_object(
      'preferred_day', last_item ->> 'preferred_day',
      'created_at', last_item ->> 'created_at',
      'id', last_item ->> 'id'
    ) else null end
  );
end $$;

-- ---------------------------------------------------------------------------
-- 3) Pre-aggregated daily report metrics
-- ---------------------------------------------------------------------------

create table if not exists public.booking_report_daily (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  day date not null,
  visits integer not null default 0,
  done integer not null default 0,
  booked integer not null default 0,
  received_cents bigint not null default 0,
  expected_cents bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, day)
);
alter table public.booking_report_daily enable row level security;
revoke all on public.booking_report_daily from public, anon, authenticated;

-- Recomputes the inclusive day range for one tenant. Call from a scheduled job
-- (pg_cron / Supabase cron / Edge Function) with the last N days for each tenant.
create or replace function public.refresh_booking_report_daily(
  p_tenant uuid, p_from date, p_to date
) returns integer
language plpgsql security definer
set search_path=public
set statement_timeout='30s'
as $$
declare
  n integer;
  tz text;
begin
  if p_tenant is null or p_from is null or p_to is null or p_to < p_from then
    raise exception 'bad_range';
  end if;
  select tenants.timezone into tz from public.tenants where id = p_tenant;
  if tz is null then raise exception 'not_found'; end if;

  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as day
  ), agg as (
    select
      (b.starts_at at time zone tz)::date as day,
      (count(*) filter (where b.status in ('arrived','done')))::int as visits,
      (count(*) filter (where b.status = 'done'))::int as done,
      (count(*) filter (where b.status <> 'cancelled'))::int as booked,
      0::bigint as received_cents,
      coalesce(sum(b.price_cents) filter (where b.status = 'booked'), 0)::bigint as expected_cents
    from public.bookings b
    where b.tenant_id = p_tenant
      and (b.starts_at at time zone tz)::date between p_from and p_to
    group by 1
  ), money as (
    select
      (p.created_at at time zone tz)::date as day,
      coalesce(sum(case p.kind when 'payment' then p.amount_cents else -p.amount_cents end), 0)::bigint as received_cents
    from public.payments p
    where p.tenant_id = p_tenant
      and (p.created_at at time zone tz)::date between p_from and p_to
    group by 1
  ), merged as (
    select d.day,
      coalesce(a.visits, 0) as visits,
      coalesce(a.done, 0) as done,
      coalesce(a.booked, 0) as booked,
      coalesce(m.received_cents, 0) as received_cents,
      coalesce(a.expected_cents, 0) as expected_cents
    from days d
    left join agg a on a.day = d.day
    left join money m on m.day = d.day
  )
  insert into public.booking_report_daily as r
    (tenant_id, day, visits, done, booked, received_cents, expected_cents, updated_at)
  select p_tenant, day, visits, done, booked, received_cents, expected_cents, now()
  from merged
  on conflict (tenant_id, day) do update set
    visits = excluded.visits,
    done = excluded.done,
    booked = excluded.booked,
    received_cents = excluded.received_cents,
    expected_cents = excluded.expected_cents,
    updated_at = excluded.updated_at;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.owner_daily_metrics(
  p_slug text, p_from date, p_to date
) returns jsonb
language plpgsql stable security definer
set search_path=public
set statement_timeout='5s'
as $$
declare t uuid; result jsonb;
begin
  t := public.owner_tenant(p_slug);
  if p_to < p_from then raise exception 'bad_range'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb) into result
  from (
    select day, visits, done, booked, received_cents, expected_cents, updated_at
    from public.booking_report_daily
    where tenant_id = t and day between p_from and p_to
  ) x;
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Bounded archival / retention
-- ---------------------------------------------------------------------------

create table if not exists public.admin_audit_events_archive
  (like public.admin_audit_events including defaults);
create table if not exists public.notification_jobs_archive
  (like public.notification_jobs including defaults);
alter table public.admin_audit_events_archive enable row level security;
alter table public.notification_jobs_archive enable row level security;
revoke all on public.admin_audit_events_archive, public.notification_jobs_archive
  from public, anon, authenticated;

-- Moves at most p_batch_limit old rows per call. Only terminal notification jobs
-- are archived so the pending queue is never disturbed.
create or replace function public.archive_old_operational_rows(
  p_older_than_days integer default 365,
  p_batch_limit integer default 1000
) returns jsonb
language plpgsql security definer
set search_path=public
set statement_timeout='30s'
as $$
declare
  cutoff timestamptz; batch integer; audit_n integer := 0; jobs_n integer := 0;
begin
  if p_older_than_days < 30 then raise exception 'bad_retention'; end if;
  batch := least(greatest(coalesce(p_batch_limit, 1000), 1), 5000);
  cutoff := now() - make_interval(days => p_older_than_days);

  with picked as (
    select id from public.admin_audit_events
    where created_at < cutoff
    order by created_at, id
    limit batch
    for update skip locked
  ), moved as (
    delete from public.admin_audit_events e
    using picked p where e.id = p.id
    returning e.*
  )
  insert into public.admin_audit_events_archive
  select * from moved;
  get diagnostics audit_n = row_count;

  with picked as (
    select id from public.notification_jobs
    where created_at < cutoff and status in ('sent', 'failed')
    order by created_at, id
    limit batch
    for update skip locked
  ), moved as (
    delete from public.notification_jobs j
    using picked p where j.id = p.id
    returning j.*
  )
  insert into public.notification_jobs_archive
  select * from moved;
  get diagnostics jobs_n = row_count;

  return jsonb_build_object('audit_archived', audit_n, 'jobs_archived', jobs_n);
end $$;

-- ---------------------------------------------------------------------------
-- 5) Permissions: new RPCs follow the same model as existing owner_* functions.
-- ---------------------------------------------------------------------------

revoke all on function
  public.owner_bookings_page(text, date, date, integer, jsonb),
  public.owner_audit_history_page(text, integer, jsonb),
  public.owner_billing_notifications_page(text, integer, jsonb),
  public.owner_reviews_page(text, integer, jsonb),
  public.owner_waitlist_page(text, integer, jsonb),
  public.owner_daily_metrics(text, date, date)
  from public, anon;
grant execute on function
  public.owner_bookings_page(text, date, date, integer, jsonb),
  public.owner_audit_history_page(text, integer, jsonb),
  public.owner_billing_notifications_page(text, integer, jsonb),
  public.owner_reviews_page(text, integer, jsonb),
  public.owner_waitlist_page(text, integer, jsonb),
  public.owner_daily_metrics(text, date, date)
  to authenticated;

revoke all on function
  public.refresh_booking_report_daily(uuid, date, date),
  public.archive_old_operational_rows(integer, integer)
  from public, anon, authenticated;
grant execute on function
  public.refresh_booking_report_daily(uuid, date, date),
  public.archive_old_operational_rows(integer, integer)
  to service_role;

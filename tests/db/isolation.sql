-- DB-backed cross-tenant isolation tests (pgTAP style), T1-T7.
-- NEVER run this file against production. Run it only on a disposable
-- Supabase branch with all migrations applied (see tests/db/README.md).
--
-- The runner sets app.db_test_branch = '1'; when executing manually in the
-- SQL editor, run `set app.db_test_branch = '1';` first.

begin;

create extension if not exists pgtap with schema extensions;

do $guard$
begin
  if coalesce(current_setting('app.db_test_branch', true), '') <> '1' then
    raise exception 'refusing DB isolation tests: use a disposable branch only (set app.db_test_branch = 1)';
  end if;
end
$guard$;

set search_path to public, extensions, pg_temp;

-- ---------------------------------------------------------------- fixtures
-- Fixed UUIDs/slugs keep the tests deterministic; the whole script rolls back.
delete from public.subscriptions
where tenant_id in ('00000000-0000-0000-0000-0000000b0001'::uuid,
                    '00000000-0000-0000-0000-0000000b0002'::uuid);

delete from public.tenants
where slug in ('dbtest-iso-a', 'dbtest-iso-b');

delete from public.platform_admins
where user_id in ('00000000-0000-0000-0000-0000000a0003'::uuid,
                  '00000000-0000-0000-0000-0000000a0004'::uuid);

insert into auth.users(id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000a0001'::uuid, 'authenticated', 'authenticated', 'dbtest-iso-owner-a@example.invalid', now(), now()),
  ('00000000-0000-0000-0000-0000000a0002'::uuid, 'authenticated', 'authenticated', 'dbtest-iso-owner-b@example.invalid', now(), now()),
  ('00000000-0000-0000-0000-0000000a0003'::uuid, 'authenticated', 'authenticated', 'dbtest-iso-admin-on@example.invalid', now(), now()),
  ('00000000-0000-0000-0000-0000000a0004'::uuid, 'authenticated', 'authenticated', 'dbtest-iso-admin-off@example.invalid', now(), now())
on conflict (id) do update set email = excluded.email, updated_at = now();

insert into public.platform_admins(user_id, role, is_active)
values
  ('00000000-0000-0000-0000-0000000a0003'::uuid, 'owner', true),
  ('00000000-0000-0000-0000-0000000a0004'::uuid, 'read_only', false);

insert into public.tenants(id, slug, status, timezone, buffer_minutes, config)
values
  ('00000000-0000-0000-0000-0000000b0001'::uuid, 'dbtest-iso-a', 'live', 'UTC', 0,
   jsonb_build_object('hours', jsonb_build_object('mon', jsonb_build_array('09:00', '18:00')),
                      'breaks', jsonb_build_object('mon', jsonb_build_array(jsonb_build_array('13:00', '14:00'))))),
  ('00000000-0000-0000-0000-0000000b0002'::uuid, 'dbtest-iso-b', 'live', 'UTC', 0,
   jsonb_build_object('hours', jsonb_build_object('mon', jsonb_build_array('09:00', '18:00'))));

insert into public.tenant_members(tenant_id, user_id, role)
values
  ('00000000-0000-0000-0000-0000000b0001'::uuid, '00000000-0000-0000-0000-0000000a0001'::uuid, 'owner'),
  ('00000000-0000-0000-0000-0000000b0002'::uuid, '00000000-0000-0000-0000-0000000a0002'::uuid, 'owner');

insert into public.resources(id, tenant_id, name)
values
  ('00000000-0000-0000-0000-0000000c0001'::uuid, '00000000-0000-0000-0000-0000000b0001'::uuid, 'DB test A resource'),
  ('00000000-0000-0000-0000-0000000c0002'::uuid, '00000000-0000-0000-0000-0000000b0002'::uuid, 'DB test B resource');

insert into public.services(id, tenant_id, name, price_cents, duration_minutes, active)
values
  ('00000000-0000-0000-0000-0000000d0001'::uuid, '00000000-0000-0000-0000-0000000b0001'::uuid, 'DB test A service', 10000, 60, true),
  ('00000000-0000-0000-0000-0000000d0002'::uuid, '00000000-0000-0000-0000-0000000b0002'::uuid, 'DB test B service', 20000, 60, true);

insert into public.bookings(
  id, tenant_id, service_id, resource_id, starts_at, ends_at,
  price_cents, duration_minutes, customer_name, customer_phone, car,
  token_hash, idempotency_key
)
values
  ('00000000-0000-0000-0000-0000000e0001'::uuid, '00000000-0000-0000-0000-0000000b0001'::uuid,
   '00000000-0000-0000-0000-0000000d0001'::uuid, '00000000-0000-0000-0000-0000000c0001'::uuid,
   now() + interval '2 days', now() + interval '2 days 1 hour',
   10000, 60, 'DB test A', '+70000000001', 'CARA', decode(md5('dbtest-iso-a'), 'hex'), 'dbtest-iso-booking-a'),
  ('00000000-0000-0000-0000-0000000e0002'::uuid, '00000000-0000-0000-0000-0000000b0002'::uuid,
   '00000000-0000-0000-0000-0000000d0002'::uuid, '00000000-0000-0000-0000-0000000c0002'::uuid,
   now() + interval '2 days', now() + interval '2 days 1 hour',
   20000, 60, 'DB test B', '+70000000002', 'CARB', decode(md5('dbtest-iso-b'), 'hex'), 'dbtest-iso-booking-b');

insert into public.payments(id, tenant_id, booking_id, amount_cents, kind)
values
  ('00000000-0000-0000-0000-0000000f0001'::uuid, '00000000-0000-0000-0000-0000000b0001'::uuid,
   '00000000-0000-0000-0000-0000000e0001'::uuid, 10000, 'payment'),
  ('00000000-0000-0000-0000-0000000f0002'::uuid, '00000000-0000-0000-0000-0000000b0002'::uuid,
   '00000000-0000-0000-0000-0000000e0002'::uuid, 20000, 'payment');

-- 30 assertions: T1=7, T2=3, T3=3, T4=6, T5=4, T6=4, T7=3.
select plan(30);

-- pgTAP keeps intermediate results in a temp table. Roles used below need
-- access to it, otherwise ok()/throws_ok() cannot record their own results.
do $grant$
declare v_temp_schema text := pg_my_temp_schema()::regnamespace::text;
begin
  execute format('grant usage on schema %I to authenticated, anon, service_role', v_temp_schema);
  execute format('grant all on all tables in schema %I to authenticated, anon, service_role', v_temp_schema);
  execute format('grant all on all sequences in schema %I to authenticated, anon, service_role', v_temp_schema);
end
$grant$;

-- ------------------------------------------------- T1: platform RPC lockdown
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000a0001', true);
set local role authenticated;
set search_path to public, extensions, pg_temp;

select throws_ok(
  $sql$select public.platform_notification_delivery('all', 'all', 10, 0)$sql$,
  '42501', null,
  'T1.1 authenticated cannot read platform notification delivery'
);
select throws_ok(
  $sql$select public.platform_notification_bounces(10, 0)$sql$,
  '42501', null,
  'T1.2 authenticated cannot read platform notification bounces'
);
select throws_ok(
  $sql$select public.platform_notifications('00000000-0000-0000-0000-0000000a0003'::uuid, 10, 0)$sql$,
  '42501', null,
  'T1.3 authenticated cannot call platform_notifications with actor'
);
select throws_ok(
  $sql$select public.platform_mark_notifications_read('00000000-0000-0000-0000-0000000a0003'::uuid, '{}'::uuid[])$sql$,
  '42501', null,
  'T1.4 authenticated cannot mark platform notifications read'
);
select throws_ok(
  $sql$select public.platform_list_subscriptions('00000000-0000-0000-0000-0000000a0003'::uuid, null, 10, 0)$sql$,
  '42501', null,
  'T1.5 authenticated cannot list platform subscriptions'
);
select throws_ok(
  $sql$select public.record_email_bounce('ses', '{"email":"dbtest@example.invalid"}'::jsonb)$sql$,
  '42501', null,
  'T1.6 authenticated cannot record email bounces'
);
select throws_ok(
  $sql$select public.consume_webhook_event('email_bounce', 'dbtest-iso-event-1')$sql$,
  '42501', null,
  'T1.7 authenticated cannot consume webhook events'
);

-- ------------------------------------- T2: deactivated platform admin fails
reset role;
set local role service_role;
set search_path to public, extensions, pg_temp;

select ok(
  public.is_platform_admin('00000000-0000-0000-0000-0000000a0003'::uuid),
  'T2.1 active platform admin is accepted'
);
select ok(
  not public.is_platform_admin('00000000-0000-0000-0000-0000000a0004'::uuid),
  'T2.2 inactive platform admin is rejected'
);
select throws_ok(
  $sql$select public.platform_assert('00000000-0000-0000-0000-0000000a0004'::uuid)$sql$,
  'P0001', 'forbidden',
  'T2.3 platform_assert rejects inactive admin'
);

-- ------------------------ T3: schedule helpers are not client-callable
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000a0001', true);
set local role authenticated;
set search_path to public, extensions, pg_temp;

select throws_ok(
  $sql$select public.effective_day_hours('00000000-0000-0000-0000-0000000b0001'::uuid, current_date)$sql$,
  '42501', null,
  'T3.1 authenticated cannot call effective_day_hours'
);
select throws_ok(
  $sql$select public.slot_in_break('00000000-0000-0000-0000-0000000b0002'::uuid, now(), 60)$sql$,
  '42501', null,
  'T3.2 authenticated cannot call slot_in_break with a foreign tenant'
);

reset role;
set local role anon;
set search_path to public, extensions, pg_temp;

select throws_ok(
  $sql$select public.effective_day_hours('00000000-0000-0000-0000-0000000b0002'::uuid, current_date)$sql$,
  '42501', null,
  'T3.3 anon cannot call effective_day_hours'
);

-- ------------------------------------- T4: RLS isolation of tenant data
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000a0001', true);
set local role authenticated;
set search_path to public, extensions, pg_temp;

select is(
  (select count(*)::bigint from public.bookings where tenant_id = '00000000-0000-0000-0000-0000000b0001'::uuid),
  1::bigint,
  'T4.1 owner A sees own booking'
);
select is(
  (select count(*)::bigint from public.bookings where id = '00000000-0000-0000-0000-0000000e0002'::uuid),
  0::bigint,
  'T4.2 owner A cannot see booking B by id'
);
select is(
  (select count(*)::bigint from public.payments where tenant_id = '00000000-0000-0000-0000-0000000b0002'::uuid),
  0::bigint,
  'T4.3 owner A cannot see payments of tenant B'
);
select is(
  (select count(*)::bigint from public.resources where tenant_id = '00000000-0000-0000-0000-0000000b0002'::uuid),
  0::bigint,
  'T4.4 owner A cannot see resources of tenant B'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000a0002', true);

select is(
  (select count(*)::bigint from public.bookings where tenant_id = '00000000-0000-0000-0000-0000000b0002'::uuid),
  1::bigint,
  'T4.5 owner B sees own booking'
);
select is(
  (select count(*)::bigint from public.bookings where id = '00000000-0000-0000-0000-0000000e0001'::uuid),
  0::bigint,
  'T4.6 owner B cannot see booking A by id'
);

-- -------------------------- T5: owner RPCs reject a foreign tenant
-- Still authenticated as owner A.
select throws_ok(
  $sql$select public.owner_bookings('dbtest-iso-b', current_date, current_date + 2)$sql$,
  'P0001', 'forbidden',
  'T5.1 owner_bookings rejects foreign tenant slug'
);
select throws_ok(
  $sql$select public.owner_add_payment('00000000-0000-0000-0000-0000000e0002'::uuid, 100, 'payment')$sql$,
  'P0001', 'forbidden',
  'T5.2 owner_add_payment rejects foreign booking'
);
select throws_ok(
  $sql$select public.owner_set_status('00000000-0000-0000-0000-0000000e0002'::uuid, 'done')$sql$,
  'P0001', 'forbidden',
  'T5.3 owner_set_status rejects foreign booking'
);
select is(
  (select count(*)::bigint from public.owner_bookings('dbtest-iso-a', current_date, current_date + 2)),
  1::bigint,
  'T5.4 owner_bookings still works for own tenant'
);

-- ---------------- T6: tenant_access_state honours nonrenew_at
reset role;
set local role service_role;
set search_path to public, extensions, pg_temp;

select is(
  public.tenant_access_state('00000000-0000-0000-0000-0000000b0001'::uuid),
  'open',
  'T6.1 tenant without subscription is open'
);

insert into public.subscriptions(id, tenant_id, plan_id, status, starts_at, ends_at, nonrenew_at)
values (
  '00000000-0000-0000-0000-000000110001'::uuid,
  '00000000-0000-0000-0000-0000000b0001'::uuid,
  (select id from public.plans where code = 'START' limit 1),
  'active', now() - interval '1 day', null, now() + interval '1 day'
)
on conflict (id) do update
set status = excluded.status, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
    nonrenew_at = excluded.nonrenew_at;

select is(
  public.tenant_access_state('00000000-0000-0000-0000-0000000b0001'::uuid),
  'open',
  'T6.2 future nonrenew_at keeps access open'
);

update public.subscriptions
set nonrenew_at = now() - interval '1 hour'
where id = '00000000-0000-0000-0000-000000110001'::uuid;

select is(
  public.tenant_access_state('00000000-0000-0000-0000-0000000b0001'::uuid),
  'closed',
  'T6.3 past nonrenew_at closes access even with no ends_at'
);
select is(
  public.tenant_booking_open('dbtest-iso-a'),
  false,
  'T6.4 booking is closed once nonrenew_at has passed'
);

update public.subscriptions
set nonrenew_at = now() + interval '1 day'
where id = '00000000-0000-0000-0000-000000110001'::uuid;

-- --------------------------------------------- T7: media_ok tenant prefix
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000a0001', true);
set local role authenticated;
set search_path to public, extensions, pg_temp;

select ok(
  public.media_ok('00000000-0000-0000-0000-0000000b0001/hero.png'),
  'T7.1 owner can write media under own tenant prefix'
);
select ok(
  not public.media_ok('00000000-0000-0000-0000-0000000b0002/hero.png'),
  'T7.2 owner cannot write media under foreign tenant prefix'
);
select ok(
  not public.media_ok('not-a-uuid/hero.png'),
  'T7.3 non-uuid media prefix is rejected'
);

-- --------------------------------------------------------------- teardown
reset role;
set search_path to public, extensions, pg_temp;
select * from finish();
rollback;

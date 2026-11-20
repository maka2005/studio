import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('tenant isolation contracts', () => {
  const hardening = read('supabase/migrations/20261120110000_rls_grant_hardening.sql');
  const schedule = read('supabase/migrations/20261117120000_schedule_management.sql');
  const roles = read('supabase/migrations/20261110180000_platform_admin_roles.sql');

  it('revokes cross-tenant notification RPCs from authenticated', () => {
    expect(hardening).toContain(
      'public.platform_notification_delivery(text, text, integer, integer)',
    );
    expect(hardening).toContain('public.platform_notification_bounces(integer, integer)');
    expect(hardening).toContain('public.platform_notifications(uuid, integer, integer)');
    expect(hardening).toContain('public.platform_mark_notifications_read(uuid, uuid[])');
    expect(hardening).toContain('public.platform_list_subscriptions(uuid, text, integer, integer)');
    expect(hardening).toMatch(
      /platform_notification_delivery[\s\S]{0,400}from public, anon, authenticated/,
    );
  });

  it('keeps schedule helpers service-role only in source migration', () => {
    expect(schedule).not.toMatch(/grant execute on function public\.effective_day_hours[^\n]*anon/);
    expect(schedule).not.toMatch(
      /grant execute on function public\.slot_in_break[^\n]*authenticated/,
    );
    expect(hardening).toContain('public.slot_in_break(uuid, timestamp with time zone, integer)');
  });

  it('requires is_active in is_platform_admin', () => {
    expect(roles).toContain('where user_id=p_user and is_active');
    expect(hardening).toContain('where user_id=p_user and is_active');
  });

  it('restores nonrenew_at in tenant_access_state', () => {
    expect(hardening).toContain('s.nonrenew_at is not null and now()>=s.nonrenew_at');
  });

  it('revokes PUBLIC EXECUTE from owner_tenant_owner', () => {
    expect(hardening).toContain(
      'revoke all on function public.owner_tenant_owner(text)\n  from public, anon, authenticated, service_role;',
    );
  });

  it('ships the webhook replay ledger with service-role-only grants', () => {
    const migration = read('supabase/migrations/20261120100000_webhook_replay_guard.sql');
    expect(migration).toContain('create table if not exists public.processed_webhook_events');
    expect(migration).toContain('create or replace function public.consume_webhook_event');
    expect(migration).toContain(
      'revoke all on function public.consume_webhook_event(text, text)\n  from public, anon, authenticated;',
    );
    expect(migration).toContain("jobname='webhook-cleanup-processed-events'");
  });
});

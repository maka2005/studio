import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('database performance migration contract', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20261117130000_performance_indexes_pagination.sql'),
    'utf8',
  );

  it('adds indexes for the documented hot query paths', () => {
    for (const idx of [
      'bookings_tenant_start_idx',
      'bookings_tenant_status_start_idx',
      'bookings_tenant_phone_start_idx',
      'payments_tenant_created_idx',
      'services_tenant_active_category_price_idx',
      'tenant_members_tenant_role_user_idx',
      'admin_audit_events_tenant_entity_created_idx',
      'notification_jobs_tenant_status_created_idx',
      'booking_reviews_tenant_published_created_idx',
      'subscription_events_sub_created_idx',
    ]) {
      expect(sql).toContain(idx);
    }
  });

  it('defines keyset pagination RPCs with bounded limits and no OFFSET', () => {
    for (const fn of [
      'owner_bookings_page',
      'owner_audit_history_page',
      'owner_billing_notifications_page',
      'owner_reviews_page',
      'owner_waitlist_page',
    ]) {
      expect(sql).toContain(`function public.${fn}`);
    }
    expect(sql).toContain("'next_cursor'");
    expect(sql).toContain("'has_more'");
    expect(sql).toContain('limit lim + 1');
    expect(sql).not.toMatch(/offset\s+p_offset/i);
  });

  it('adds pre-aggregated report rollups and bounded retention helpers', () => {
    expect(sql).toContain('create table if not exists public.booking_report_daily');
    expect(sql).toContain('function public.refresh_booking_report_daily');
    expect(sql).toContain('function public.owner_daily_metrics');
    expect(sql).toContain('function public.archive_old_operational_rows');
    expect(sql).toContain('admin_audit_events_archive');
    expect(sql).toContain('notification_jobs_archive');
    expect(sql).toContain("set statement_timeout='5s'");
  });

  it('exposes the paginated RPCs on the client API surface', () => {
    const api = readFileSync(resolve(process.cwd(), 'src/lib/api.ts'), 'utf8');
    expect(api).toContain('export type CursorPage');
    expect(api).toContain('bookingsPage:');
    expect(api).toContain('auditHistoryPage:');
    expect(api).toContain('billingNotificationsPage:');
    expect(api).toContain('reviewsPage:');
    expect(api).toContain('waitlistPage:');
    expect(api).toContain('dailyMetrics:');
  });
});

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

describe('API / Edge / RPC contracts', () => {
  it('owner API proxy allowlists core owner RPCs', () => {
    const ownerApi = read('api/owner.js');
    for (const rpc of [
      'owner_me',
      'owner_bookings',
      'owner_bookings_page',
      'owner_daily_metrics',
      'owner_audit_history_page',
      'owner_billing_notifications_page',
      'owner_billing_documents',
      'owner_payments',
      'owner_available_plans',
      'owner_request_manual_payment',
      'owner_reviews_page',
      'owner_waitlist_page',
      'owner_update_config',
      'owner_update_schedule_settings',
      'owner_schedule_exceptions',
      'owner_upsert_schedule_exception',
      'owner_delete_schedule_exception',
      'owner_unblock',
    ]) {
      expect(ownerApi).toContain(`'${rpc}'`);
    }
  });

  it('health API exposes stable component keys', () => {
    const healthApi = read('api/health.js');
    for (const key of ['web', 'database', 'auth', 'edge']) {
      expect(healthApi).toContain(`check('${key}'`);
    }
    expect(healthApi).toContain("key: 'api'");
    expect(healthApi).toContain('withObservability(handler');
  });

  it('critical edge functions exist', () => {
    for (const fn of [
      'supabase/functions/platform-admin/index.ts',
      'supabase/functions/media-management/index.ts',
    ]) {
      expect(existsSync(resolve(process.cwd(), fn))).toBe(true);
    }
  });

  it('frontend owner API declares schedule management methods', () => {
    const api = read('src/lib/api.ts');
    expect(api).toContain('updateScheduleSettings');
    expect(api).toContain('scheduleExceptions');
    expect(api).toContain('upsertScheduleException');
    expect(api).toContain('deleteScheduleException');
  });

  it('frontend owner API declares keyset page methods', () => {
    const api = read('src/lib/api.ts');
    for (const method of [
      'bookingsPage',
      'bookingsAll',
      'auditHistoryPage',
      'billingNotificationsPage',
      'reviewsPage',
      'waitlistPage',
      'dailyMetrics',
    ]) {
      expect(api).toContain(`${method}:`);
    }
  });

  it('frontend owner API declares billing document and payment methods', () => {
    const api = read('src/lib/api.ts');
    for (const method of ['billingDocuments', 'payments']) {
      expect(api).toContain(`${method}:`);
    }
    expect(read('src/pages/owner/billing.tsx')).toContain('owner.billingDocuments');
  });

  it('owner lists no longer call the old offset RPC wrappers', () => {
    for (const file of [
      'src/pages/owner/reports.tsx',
      'src/pages/owner/cabinet.tsx',
      'src/pages/owner/bookings.tsx',
    ]) {
      const source = read(file);
      for (const oldCall of [
        'owner.bookings(',
        'owner.auditHistory(',
        'owner.billingNotifications(',
        'owner.reviews(',
        'owner.waitlist(',
      ]) {
        expect(source).not.toContain(oldCall);
      }
    }
  });

  it('platform legal details are editable in admin and public to the site', () => {
    const api = read('api/platform.js');
    const edge = read('supabase/functions/platform-admin/index.ts');
    const migration = read('supabase/migrations/20261123000000_platform_legal.sql');
    const consoleSource = read('src/pages/platform-admin/console.tsx');
    const legalForm = read('src/pages/platform-admin/legal.tsx');
    const hook = read('src/marketing/hooks/usePlatformLegal.ts');

    expect(api).toContain("action === 'legal'");
    expect(api).toContain("action: 'public_legal'");
    for (const action of ['public_legal', 'platform_legal_get', 'platform_legal_save']) {
      expect(edge).toContain(`'${action}'`);
    }
    expect(migration).toContain('platform_get_legal');
    expect(migration).toContain('platform_set_legal');
    expect(consoleSource).toContain("'Реквизиты'");
    expect(legalForm).toContain('platform_legal_save');
    expect(hook).toContain('/api/platform?action=legal');
  });
});

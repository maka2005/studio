import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('platform admin filters, exports and pagination contracts', () => {
  it('shared module provides reusable filters, CSV and paging helpers', () => {
    const shared = read('src/pages/platform-admin/shared.tsx');
    for (const token of [
      'usePlatformFilters',
      'FilterBar',
      'downloadCsv',
      'exportAllRows',
      'exportPagedRows',
      'useDebouncedValue',
    ]) {
      expect(shared).toContain(token);
    }
    expect(shared).toContain('localStorage.setItem(storageKey');
    expect(shared).toContain('\\ufeff');
  });

  it('audit, support, leads, subscriptions and payments use shared filters and CSV', () => {
    const operations = read('src/pages/platform-admin/operations.tsx');
    for (const key of [
      'platform-audit-filters',
      'platform-support-filters',
      'platform-leads-filters',
    ]) {
      expect(operations).toContain(key);
    }
    const billing = read('src/pages/platform-admin/billing.tsx');
    for (const key of ['platform-subscriptions-filters', 'platform-payments-filters']) {
      expect(billing).toContain(key);
    }
    for (const file of [operations, billing]) {
      expect(file).toContain('<FilterBar');
      expect(file).toContain('downloadCsv(');
    }
    expect(operations).toContain("exportPagedRows<Row>('support_tickets'");
    expect(operations).toContain("exportPagedRows<Row>('business_leads'");
    expect(billing).toContain("exportAllRows<Row>('subscriptions'");
    expect(billing).toContain("exportAllRows<Row>('payments'");
  });

  it('migration adds offsets to subscriptions and notifications', () => {
    const sql = read('supabase/migrations/20261118150000_platform_admin_pagination.sql');
    expect(sql).toContain('platform_list_subscriptions');
    expect(sql).toContain('platform_notifications');
    expect(sql.match(/p_offset int default 0/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain('offset greatest(p_offset,0)');
  });

  it('edge function forwards offsets and lead search', () => {
    const edge = read('supabase/functions/platform-admin/index.ts');
    expect(edge).toContain("case 'subscriptions':");
    expect(edge).toContain('p_offset: Math.max(0, Number(body.offset) || 0)');
    expect(edge).toContain("case 'notifications':");
    expect(edge).toContain('const search=str(body.search,80)');
    expect(edge).toContain('business_name.ilike');
  });

  it('subscription and notice lists render pagination controls', () => {
    const billing = read('src/pages/platform-admin/billing.tsx');
    expect(billing).toContain("aria-label='Подписки'");
    expect(billing).toContain('hasNext');
    const operations = read('src/pages/platform-admin/operations.tsx');
    expect(operations).toContain('noticePage');
    expect(operations).toContain('hasNoticeNext');
  });
});

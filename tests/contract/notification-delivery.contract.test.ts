import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('notification delivery contracts', () => {
  it('owner proxy allowlists template and delivery RPCs', () => {
    const api = read('api/owner.js');
    for (const rpc of [
      'owner_notification_templates',
      'owner_upsert_notification_template',
      'owner_notification_jobs',
      'owner_notification_retry',
      'owner_notification_bounces',
    ]) {
      expect(api).toContain(`'${rpc}'`);
    }
  });

  it('frontend exposes template and delivery methods', () => {
    const api = read('src/lib/api.ts');
    for (const method of [
      'notificationTemplates',
      'upsertNotificationTemplate',
      'notificationJobs',
      'notificationRetry',
      'notificationBounces',
    ]) {
      expect(api).toContain(`${method}:`);
    }
    expect(read('src/pages/owner/notifications.tsx')).toContain('owner.notificationJobs');
  });

  it('migration creates templates, bounces and scoped RPCs', () => {
    const sql = read('supabase/migrations/20261118140000_notification_delivery.sql');
    for (const token of [
      'create table public.notification_templates',
      'create table public.bounce_suppressions',
      'add column template_code text',
      'add column bounced_at timestamptz',
      'owner_upsert_notification_template',
      'owner_notification_retry',
      'platform_notification_delivery',
      'record_email_bounce',
      'grant execute on function',
    ]) {
      expect(sql).toContain(token);
    }
  });

  it('worker applies saved templates and records the template code', () => {
    const worker = read('supabase/functions/notify-dispatch/index.ts');
    expect(worker).toContain('loadTemplates');
    expect(worker).toContain('buildOwnerTemplateMessage');
    expect(worker).toContain('p_template_code: templateCode');
    const format = read('supabase/functions/notify-dispatch/format.ts');
    expect(format).toContain('export function renderTemplate');
  });

  it('platform admin exposes delivery actions to every role and dispatch', () => {
    const edge = read('supabase/functions/platform-admin/index.ts');
    for (const action of ['notification_delivery', 'notification_bounces']) {
      expect(edge).toContain(`'${action}'`);
      expect(edge).toContain(`case '${action}'`);
    }
    for (const roleSet of ['readActions', 'financeActions', 'supportActions']) {
      const start = edge.indexOf(`const ${roleSet} = new Set(`);
      const end = edge.indexOf(']);', start);
      const block = edge.slice(start, end);
      expect(block).toContain('notification_delivery');
      expect(block).toContain('notification_bounces');
    }
  });

  it('bounce webhook is wired to the recording RPC', () => {
    const fn = read('supabase/functions/email-bounce-webhook/index.ts');
    expect(fn).toContain('withEdgeObservability');
    expect(fn).toContain('record_email_bounce');
    expect(fn).toContain('x-webhook-secret');
  });
});

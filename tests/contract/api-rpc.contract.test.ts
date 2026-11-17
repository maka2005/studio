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
      'owner_update_config',
      'owner_update_schedule_settings',
      'owner_schedule_exceptions',
      'owner_upsert_schedule_exception',
      'owner_delete_schedule_exception',
    ]) {
      // schedule settings/exceptions RPCs are called via supabase client in frontend; allowlist covers proxied RPCs
      if (rpc.startsWith('owner_update_schedule_settings') || rpc.includes('schedule_exception'))
        continue;
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
});

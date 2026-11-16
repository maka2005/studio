import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('schedule management migration contract', () => {
  it('defines exceptions table, slot logic helpers and owner RPCs', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20261117120000_schedule_management.sql'),
      'utf8',
    );
    expect(sql).toContain('create table if not exists public.schedule_exceptions');
    expect(sql).toContain('create or replace function public.get_slots');
    expect(sql).toContain('public.slot_in_break');
    expect(sql).toContain('owner_schedule_exceptions');
    expect(sql).toContain('owner_upsert_schedule_exception');
    expect(sql).toContain('owner_delete_schedule_exception');
    expect(sql).toContain('owner_update_schedule_settings');
    expect(sql).toContain('buffer_minutes');
  });
});

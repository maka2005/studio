import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261122170000_owner_config_media_keys.sql'),
  'utf8',
);

describe('owner_update_config media keys', () => {
  it('restores images, gallery and route_url in the config allowlist', () => {
    expect(migration).toContain('public.owner_tenant_owner(p_slug)');
    expect(migration).toMatch(/e\.key in \('phone'[\s\S]{0,220}'images'[\s\S]{0,60}'route_url'/);
  });

  it('validates uploaded media URLs and keeps Telegram opt-out cleanup', () => {
    expect(migration).toContain(
      "coalesce(p_patch->'images'->>'logo', '') !~ '^(https://|images/)'",
    );
    expect(migration).toContain("coalesce(g->>'image', '') !~ '^(https://|images/)'");
    expect(migration).toContain('delete from public.booking_telegram_links where tenant_id = t');
  });

  it('does not expose the RPC to anonymous callers', () => {
    expect(migration).toContain(
      'revoke all on function public.owner_update_config(text, jsonb) from public, anon;',
    );
    expect(migration).toContain(
      'grant execute on function public.owner_update_config(text, jsonb) to authenticated;',
    );
  });
});

describe('owner_update_config local asset paths', () => {
  const localPaths = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20261122180000_owner_config_local_asset_paths.sql'),
    'utf8',
  );

  it('accepts static paths used by existing tenant configs', () => {
    const pattern = localPaths.match(/!~ '\^\(([^']+)\)'/)?.[1];
    expect(pattern).toBeTruthy();
    const allowed = new RegExp(`^(${pattern})`);
    expect(allowed.test('https://example.supabase.co/storage/v1/object/public/a/b.png')).toBe(true);
    expect(allowed.test('images/logo.png')).toBe(true);
    expect(allowed.test('/servio-default.svg')).toBe(true);
    expect(allowed.test('/tenants/graphite/hero.jpg')).toBe(true);
    expect(allowed.test('//evil.example/logo.png')).toBe(false);
    expect(allowed.test('javascript:alert(1)')).toBe(false);
  });

  it('keeps the media keys while relaxing only the URL validation', () => {
    expect(localPaths).toMatch(/e\.key in \('phone'[\s\S]{0,220}'images'/);
    expect(localPaths).toContain('public.owner_tenant_owner(p_slug)');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/health.js';

function createRes() {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      headers[String(name).toLowerCase()] = String(value);
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
  };
  return { res, headers };
}

describe('GET /api/health contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.SITE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_ANON_KEY;
  });

  it('returns method_not_allowed for non-GET', async () => {
    const { res } = createRes();
    await handler({ method: 'POST', headers: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'method_not_allowed' });
  });

  it('returns status payload with checks and cache headers', async () => {
    process.env.SITE_URL = 'https://example.test';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })) as any);
    const { res, headers } = createRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(headers['cache-control']).toContain('s-maxage=30');
    expect(res.body).toMatchObject({ status: expect.any(String), checks: expect.any(Array) });
    expect(res.body.checks.map((c: any) => c.key)).toEqual([
      'web',
      'api',
      'database',
      'auth',
      'edge',
    ]);
  });
});

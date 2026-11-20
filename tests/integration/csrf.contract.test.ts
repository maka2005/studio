import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ownerHandler from '../../api/owner.js';
import platformHandler from '../../api/platform.js';

const TOKEN = 'csrf-token-for-test';
const ORIGIN = { host: 'example.test', origin: 'https://example.test' };

function createRes() {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 0,
    bodyText: '',
    setHeader(name: string, value: unknown) {
      headers[name.toLowerCase()] = Array.isArray(value)
        ? value.map(String).join('; ')
        : String(value);
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    end(body?: unknown) {
      if (typeof body === 'string') res.bodyText = body;
      return res;
    },
  };
  return { res, headers };
}

function createReq(
  options: {
    api?: 'owner' | 'platform';
    method?: string;
    action?: string;
    token?: string | null;
    headerToken?: string | null;
    body?: Record<string, unknown>;
  } = {},
) {
  const api = options.api ?? 'owner';
  const cookieName = api === 'owner' ? 'studio_owner_csrf' : 'platform_csrf';
  const token = options.token === undefined ? TOKEN : options.token;
  const headerToken = options.headerToken === undefined ? token : options.headerToken;
  return {
    method: options.method ?? 'POST',
    url: `/api/${api}`,
    query: { action: options.action ?? 'logout' },
    headers: {
      ...ORIGIN,
      cookie: token ? `${cookieName}=${token}` : '',
      ...(headerToken ? { 'x-csrf-token': headerToken } : {}),
    },
    body: options.body ?? {},
  };
}

const bodyOf = (res: { bodyText: string }) => JSON.parse(res.bodyText || '{}');

describe('CSRF double-submit on /api/owner and /api/platform', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  });

  it('rejects owner POST without the token header', async () => {
    const { res } = createRes();
    await ownerHandler(createReq({ token: null }), res);
    expect(res.statusCode).toBe(403);
    expect(bodyOf(res)).toEqual({ error: 'csrf_failed' });
  });

  it('accepts owner POST with a matching token', async () => {
    const { res } = createRes();
    await ownerHandler(createReq(), res);
    expect(res.statusCode).toBe(200);
    expect(bodyOf(res)).toEqual({ ok: true });
  });

  it('rejects a mismatched token', async () => {
    const { res } = createRes();
    await ownerHandler(createReq({ headerToken: 'another-token' }), res);
    expect(res.statusCode).toBe(403);
    expect(bodyOf(res)).toEqual({ error: 'csrf_failed' });
  });

  it('rejects platform POST without the token header and accepts it with one', async () => {
    const missing = createRes();
    await platformHandler(createReq({ api: 'platform', token: null }), missing.res);
    expect(missing.res.statusCode).toBe(403);
    expect(bodyOf(missing.res)).toEqual({ error: 'csrf_failed' });

    const valid = createRes();
    await platformHandler(createReq({ api: 'platform' }), valid.res);
    expect(valid.res.statusCode).toBe(200);
    expect(bodyOf(valid.res)).toEqual({ ok: true });
  });

  it('does not require a token for GET', async () => {
    const owner = createRes();
    await ownerHandler(createReq({ method: 'GET', action: 'session', token: null }), owner.res);
    expect(owner.res.statusCode).toBe(200);
    expect(bodyOf(owner.res)).toEqual({ user: null });

    const platform = createRes();
    await platformHandler(
      createReq({ api: 'platform', method: 'GET', action: 'session', token: null }),
      platform.res,
    );
    expect(platform.res.statusCode).toBe(200);
    expect(bodyOf(platform.res)).toEqual({ user: null });
  });

  it('issues a readable csrf cookie together with the owner session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          session: { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 },
          user: { id: 'u1' },
        }),
      })),
    );
    const { res, headers } = createRes();
    await ownerHandler(createReq({ action: 'login', body: { slug: 'demo' } }), res);
    expect(res.statusCode).toBe(200);
    expect(headers['set-cookie']).toContain(`studio_owner_csrf=${TOKEN}`);
    expect(headers['set-cookie'].split(`studio_owner_csrf=${TOKEN}`)[1]).not.toContain('HttpOnly');
  });

  it('clears the csrf cookie on logout', async () => {
    const { res, headers } = createRes();
    await ownerHandler(createReq({ token: TOKEN }), res);
    expect(res.statusCode).toBe(200);
    expect(headers['set-cookie']).toContain('studio_owner_csrf=;');
    expect(headers['set-cookie']).toContain('Max-Age=0');
  });
});

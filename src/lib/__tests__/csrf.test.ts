import { afterEach, describe, expect, it, vi } from 'vitest';
import { csrfFetch, getCsrfToken, installCsrfFetchGuard, readCookie } from '../csrf';

const clearCookies = () => {
  for (const name of ['studio_owner_csrf', 'platform_csrf']) {
    document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
};

describe('csrf helper', () => {
  afterEach(() => {
    clearCookies();
    vi.unstubAllGlobals();
  });

  it('bootstraps a token when the cookie is missing (first login)', () => {
    clearCookies();
    const token = getCsrfToken('owner');
    expect(token).toMatch(/^[0-9a-f-]{32,}$/);
    expect(readCookie('studio_owner_csrf')).toBe(token);
    expect(document.cookie).not.toContain('HttpOnly');
  });

  it('reuses the server-issued cookie value instead of rotating it', () => {
    clearCookies();
    document.cookie = 'studio_owner_csrf=server-token; Path=/; SameSite=Strict';
    expect(getCsrfToken('owner')).toBe('server-token');
  });

  it('adds the header on POSTs through csrfFetch', async () => {
    clearCookies();
    const token = getCsrfToken('platform');
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true }));
    vi.stubGlobal('fetch', fetchSpy);
    await csrfFetch('platform', '/api/platform?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/platform?action=login');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe(token);
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('global guard covers direct POSTs from pages but leaves GET unchanged', async () => {
    clearCookies();
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true }));
    vi.stubGlobal('fetch', fetchSpy);
    installCsrfFetchGuard();

    await window.fetch('/api/platform?action=invoke', { method: 'POST' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/platform?action=invoke');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe(readCookie('platform_csrf'));

    await window.fetch('/api/platform?action=session', { method: 'GET' });
    expect((fetchSpy.mock.calls[1] as [string, RequestInit | undefined])[1]?.headers).toBeUndefined();
  });
});

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { withObservability } from './_observability.js';

const COOKIE = process.env.NODE_ENV === 'production' ? '__Host-platform_admin' : 'platform_admin';
const IDLE_SECONDS = 30 * 60;
const SECURE = process.env.NODE_ENV === 'production';
const OWNER_ACCESS = SECURE ? '__Host-studio_owner_access' : 'studio_owner_access';
const OWNER_REFRESH = SECURE ? '__Host-studio_owner_refresh' : 'studio_owner_refresh';
const IMP_SESSION = SECURE ? '__Host-studio_owner_imp_session' : 'studio_owner_imp_session';
const IMP_ADMIN = SECURE ? '__Host-studio_owner_imp_admin' : 'studio_owner_imp_admin';
const IMP_EXP = SECURE ? '__Host-studio_owner_imp_exp' : 'studio_owner_imp_exp';
// CSRF double-submit: читается JS, поэтому без HttpOnly (в проде — только Secure/__Host-).
const CSRF = SECURE ? '__Host-platform_csrf' : 'platform_csrf';
const CSRF_MAX_AGE = 60 * 60 * 24 * 30;

const getConfig = () => ({
  url: (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, ''),
  anon: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
});

const clientIp = (req) =>
  String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();

// Секрет прокси: Edge Function доверяет x-client-ip только вместе с ним (иначе IP подделать может любой, anon-ключ публичный).
const publicHeaders = (cfg, req) => ({
  apikey: cfg.anon,
  Authorization: `Bearer ${cfg.anon}`,
  'Content-Type': 'application/json',
  'x-client-ip': clientIp(req),
  ...(process.env.PLATFORM_PROXY_SECRET
    ? { 'x-proxy-secret': process.env.PLATFORM_PROXY_SECRET }
    : {}),
});

const send = (res, status, body, headers = {}) => {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(body));
};

const cookieHeader = (value, age) =>
  `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}SameSite=Strict; Max-Age=${age}`;

const csrfCookie = (value, age = CSRF_MAX_AGE) =>
  `${CSRF}=${encodeURIComponent(value)}; Path=/; ${SECURE ? 'Secure; ' : ''}SameSite=Strict; Max-Age=${age}`;

const readCookie = (header = '', name = COOKIE) => {
  const item = header
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + '='));
  try {
    return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
  } catch {
    return '';
  }
};

const readCsrfCookie = (header) => readCookie(header, CSRF);

const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
};

// Origin/SameSite проверка выше остаётся; double-submit требуется только для POST.
const csrfValid = (req) =>
  req.method !== 'POST' ||
  safeEqual(req.headers['x-csrf-token'], readCsrfCookie(req.headers.cookie));

const originAllowed = (req) => {
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    return false;
  }
  const origin = req.headers.origin;
  if (!origin) {
    return req.method === 'GET';
  }
  try {
    const u = new URL(origin);
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0]
      .trim();
    return (
      u.host.toLowerCase() === host.toLowerCase() &&
      (u.protocol === 'https:' ||
        (process.env.NODE_ENV !== 'production' &&
          ['localhost', '127.0.0.1'].includes(u.hostname)))
    );
  } catch {
    return false;
  }
};

const MAX_BODY_BYTES = 64 * 1024;

const parseBody = async (req) => {
  if (Number(req.headers['content-length'] || 0) > MAX_BODY_BYTES) {
    const error = new Error('payload_too_large');
    error.status = 413;
    throw error;
  }
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  const parts = [];
  let total = 0;
  for await (const part of req) {
    total += part.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error('payload_too_large');
      error.status = 413;
      throw error;
    }
    parts.push(Buffer.from(part));
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
};

const authFetch = (cfg, token, path, init = {}) =>
  fetch(cfg.url + path, {
    ...init,
    headers: {
      apikey: cfg.anon,
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });

const refreshSession = async (cfg, token) => {
  const r = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: cfg.anon,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: token }),
  });
  return r.ok ? r.json() : null;
};

const jwtExpiry = (token) => {
  try {
    return (
      Number(
        JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).exp
      ) || 0
    );
  } catch {
    return 0;
  }
};

const encodeSession = (session) =>
  Buffer.from(JSON.stringify(session)).toString('base64url');

const decodeSession = (value) => {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

const updateCookie = (res, session, csrf = randomUUID()) => {
  res.setHeader('Set-Cookie', [
    cookieHeader(encodeSession(session), IDLE_SECONDS),
    csrfCookie(csrf),
  ]);
};

const ownerCookie = (name, value, age) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; ${SECURE ? 'Secure; ' : ''}SameSite=Strict; Max-Age=${age}`;

const clearCookie = (res) => {
  res.setHeader('Set-Cookie', [cookieHeader('', 0), csrfCookie('', 0)]);
};

const edge = async (cfg, token, action, body = {}) => {
  const r = await fetch(`${cfg.url}/functions/v1/platform-admin`, {
    method: 'POST',
    headers: {
      apikey: cfg.anon,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...body }),
  });
  return {
    ok: r.ok,
    status: r.status,
    payload: await r.json().catch(() => ({})),
  };
};

export const config = { api: { bodyParser: false } };

async function handler(req, res) {
  if (!originAllowed(req)) {
    return send(res, 403, { error: 'forbidden' });
  }

  const cfg = getConfig();
  if (!cfg.url || !cfg.anon) {
    return send(res, 503, { error: 'temporarily_unavailable' });
  }

  const csrf = readCsrfCookie(req.headers.cookie) || randomUUID();
  if (!csrfValid(req)) {
    return send(res, 403, { error: 'csrf_failed' });
  }

  let body = {};
  try {
    if (req.method === 'POST') {
      body = await parseBody(req);
    }
  } catch {
    return send(res, 400, { error: 'bad_request' });
  }

  const action = String(req.query?.action || '');

  try {
    if (req.method === 'POST' && action === 'demo') {
      const r = await fetch(`${cfg.url}/functions/v1/platform-admin`, {
        method: 'POST',
        headers: publicHeaders(cfg, req),
        body: JSON.stringify({ action: 'public_demo_start', lead: body }),
      });
      const result = await r.json().catch(() => ({}));
      return send(res, r.status, result);
    }

    if (req.method === 'POST' && action === 'connect') {
      const r = await fetch(`${cfg.url}/functions/v1/platform-admin`, {
        method: 'POST',
        headers: publicHeaders(cfg, req),
        body: JSON.stringify({ action: 'public_connect_start', lead: body }),
      });
      const result = await r.json().catch(() => ({}));
      return send(res, r.status, result);
    }

    if (req.method === 'POST' && action === 'lead') {
      const r = await fetch(`${cfg.url}/functions/v1/platform-admin`, {
        method: 'POST',
        headers: publicHeaders(cfg, req),
        body: JSON.stringify({ action: 'public_lead_submit', lead: body }),
      });
      const result = await r.json().catch(() => ({}));
      return send(res, r.status, result);
    }

    if (req.method === 'GET' && action === 'plans') {
      const r = await fetch(`${cfg.url}/functions/v1/platform-admin`, {
        method: 'POST',
        headers: {
          apikey: cfg.anon,
          Authorization: `Bearer ${cfg.anon}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'public_plans' }),
      });
      const result = await r.json().catch(() => ({}));
      return send(
        res,
        r.status,
        result,
        r.ok
          ? { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' }
          : {}
      );
    }

    if (req.method === 'GET' && action === 'legal') {
      const r = await fetch(`${cfg.url}/functions/v1/platform-admin`, {
        method: 'POST',
        headers: {
          apikey: cfg.anon,
          Authorization: `Bearer ${cfg.anon}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'public_legal' }),
      });
      const result = await r.json().catch(() => ({}));
      return send(res, r.status, result);
    }

    if (req.method === 'POST' && action === 'login') {
      const r = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: cfg.anon,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: String(body.email || '').trim(),
          password: String(body.password || ''),
        }),
      });
      const session = await r.json().catch(() => ({}));
      if (!r.ok || !session.access_token || !session.refresh_token) {
        return send(res, 401, { error: 'invalid_credentials' });
      }
      updateCookie(res, session, csrf);
      const user = await authFetch(cfg, session.access_token, '/auth/v1/user');
      if (user.ok) {
        const me = await edge(cfg, session.access_token, 'whoami');
        if (me.ok && me.payload?.data?.mfa_required !== true) {
          await edge(cfg, session.access_token, 'admin_login_event', {
            user_agent: String(req.headers['user-agent'] || ''),
            ip_address: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
          });
        }
      }
      return send(res, 200, { user: user.ok ? await user.json() : null });
    }

    if (req.method === 'POST' && action === 'migrate') {
      const access = String(body.access_token || '');
      const refresh = String(body.refresh_token || '');
      if (!access || !refresh) {
        return send(res, 400, { error: 'bad_request' });
      }
      const user = await authFetch(cfg, access, '/auth/v1/user');
      if (!user.ok) {
        return send(res, 401, { error: 'unauthorized' });
      }
      const me = await edge(cfg, access, 'whoami');
      if (!me.ok) {
        return send(res, me.status, { error: me.payload?.error || 'authorization_check_failed' });
      }
      res.setHeader('Set-Cookie', [
        cookieHeader(
          encodeSession({
            access_token: access,
            refresh_token: refresh,
            expires_at: jwtExpiry(access),
          }),
          IDLE_SECONDS
        ),
        csrfCookie(csrf),
      ]);
      const meData = me.payload?.data || me.payload || {};
      if (meData.mfa_required !== true) {
        await edge(cfg, access, 'admin_login_event', {
          user_agent: String(req.headers['user-agent'] || ''),
          ip_address: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
        });
      }
      return send(res, 200, { ok: true });
    }

    const jarSession = decodeSession(readCookie(req.headers.cookie));
    let session = jarSession;
    if (
      jarSession &&
      jwtExpiry(jarSession.access_token) < Math.floor(Date.now() / 1000) + 60
    ) {
      session = await refreshSession(cfg, jarSession.refresh_token);
    }

    if (req.method === 'POST' && action === 'logout') {
      if (session?.access_token) {
        await authFetch(cfg, session.access_token, '/auth/v1/logout', {
          method: 'POST',
        }).catch(() => {});
      }
      clearCookie(res);
      return send(res, 200, { ok: true });
    }

    if (!session?.access_token) {
      clearCookie(res);
      if (action === 'session') {
        return send(res, 200, { user: null });
      }
      return send(res, 401, { error: 'unauthorized' });
    }

    updateCookie(res, session, csrf);

    if (req.method === 'GET' && action === 'session') {
      const u = await authFetch(cfg, session.access_token, '/auth/v1/user');
      if (!u.ok) {
        return send(res, 200, { user: null });
      }
      const result = await edge(cfg, session.access_token, 'whoami');
      const data = result.payload?.data || result.payload || {};
      return send(res, 200, {
        user: await u.json(),
        authorized: result.ok,
        role: data.role,
        mfa_required: data.mfa_required === true,
        aal: data.aal,
      });
    }

    if (req.method === 'GET' && action === 'factors') {
      // В Supabase Auth нет GET /factors (ответ 405): список факторов приходит в объекте пользователя.
      const r = await authFetch(cfg, session.access_token, '/auth/v1/user');
      const account = await r.json().catch(() => ({}));
      if (!r.ok) {
        return send(res, r.status, { error: 'factors_unavailable' });
      }
      const totp = (Array.isArray(account.factors) ? account.factors : [])
        .filter((f) => f.factor_type === 'totp' && f.status === 'verified')
        .map((f) => ({
          id: f.id,
          friendly_name: f.friendly_name,
          status: f.status,
        }));
      return send(res, 200, { factors: { totp } });
    }

    if (req.method === 'POST' && action === 'mfa_enroll') {
      const r = await authFetch(cfg, session.access_token, '/auth/v1/factors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          factor_type: 'totp',
          friendly_name: String(body.friendly_name || 'platform-admin'),
        }),
      });
      return send(res, r.status, await r.json().catch(() => ({})));
    }

    if (req.method === 'POST' && action === 'mfa_verify') {
      const factor = encodeURIComponent(String(body.factor_id || ''));
      const r = await authFetch(
        cfg,
        session.access_token,
        `/auth/v1/factors/${factor}/challenge`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }
      );
      const challenge = await r.json().catch(() => ({}));
      if (!r.ok || !challenge.id) {
        return send(res, r.status, { error: 'mfa_challenge_failed' });
      }
      const verified = await authFetch(
        cfg,
        session.access_token,
        `/auth/v1/factors/${factor}/verify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challenge_id: challenge.id,
            code: String(body.code || '').trim(),
          }),
        }
      );
      const result = await verified.json().catch(() => ({}));
      if (!verified.ok) {
        return send(res, verified.status, { error: 'mfa_verify_failed' });
      }
      if (result.access_token && result.refresh_token) {
        updateCookie(res, result, csrf);
      }
      if (result.access_token) {
        const me = await edge(cfg, result.access_token, 'whoami');
        if (me.ok && me.payload?.data?.mfa_required !== true) {
          await edge(cfg, result.access_token, 'admin_login_event', {
            user_agent: String(req.headers['user-agent'] || ''),
            ip_address: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
          });
        }
      }
      return send(res, 200, result);
    }

    if (req.method === 'POST' && action === 'impersonate_start') {
      const result = await edge(cfg, session.access_token, 'impersonation_start', {
        tenant_id: body.tenant_id,
        reason: body.reason,
      });
      const d = result.payload?.data;
      if (!result.ok || !d?.owner_session) {
        return send(res, result.status, result.payload);
      }
      const age = Math.max(1, Math.floor((new Date(d.expires_at).getTime() - Date.now()) / 1000));
      const existing = res.getHeader('Set-Cookie');
      const headers = Array.isArray(existing)
        ? existing
        : existing
          ? [String(existing)]
          : [];
      headers.push(
        ownerCookie(OWNER_ACCESS, d.owner_session.access_token, age),
        ownerCookie(OWNER_REFRESH, d.owner_session.refresh_token, age),
        ownerCookie(IMP_SESSION, d.session_id, age),
        ownerCookie(IMP_ADMIN, session.access_token, age),
        ownerCookie(IMP_EXP, String(new Date(d.expires_at).getTime()), age)
      );
      res.setHeader('Set-Cookie', headers);
      return send(res, 200, {
        ok: true,
        tenant_slug: d.tenant_slug,
        expires_at: d.expires_at,
      });
    }

    if (req.method === 'POST' && action === 'export') {
      const r = await fetch(cfg.url + '/functions/v1/tenant-export', {
        method: 'POST',
        headers: {
          apikey: cfg.anon,
          Authorization: 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        return send(res, r.status, await r.json().catch(() => ({ error: 'export_failed' })));
      }
      const bytes = Buffer.from(await r.arrayBuffer());
      res.statusCode = 200;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        r.headers.get('content-disposition') || 'attachment; filename="tenant-export.zip"'
      );
      return res.end(bytes);
    }

    if (req.method === 'POST' && action === 'invoke') {
      const edgeAction = String(body.action || '');
      const result = await edge(cfg, session.access_token, edgeAction, body.body || {});
      return send(res, result.status, result.payload);
    }

    return send(res, 404, { error: 'not_found' });
  } catch (error) {
    const status = Number(error?.status) || (error instanceof SyntaxError ? 400 : 400);
    const code = status === 413 ? 'payload_too_large' : 'bad_request';
    console.warn(JSON.stringify({ level: 'warn', at: new Date().toISOString(), service: 'vercel-api', handler: 'platform', request_id: req.requestId, event: 'platform_api_error', error: String(error?.message || error).slice(0, 500) }));
    return send(res, status, { error: code });
  }
}

export default withObservability(handler, { name: 'platform' });

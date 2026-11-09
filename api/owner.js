const SECURE_COOKIE = process.env.NODE_ENV === 'production';
const ACCESS = SECURE_COOKIE ? '__Host-studio_owner_access' : 'studio_owner_access';
const REFRESH = SECURE_COOKIE ? '__Host-studio_owner_refresh' : 'studio_owner_refresh';
const OWNER_RPCS = new Set([
  'owner_me','owner_access','owner_bookings','staff_bookings','owner_stats','owner_repeat_stats','owner_audit_history',
  'owner_set_status','staff_set_status','owner_cancel','owner_erase_customer','owner_reschedule','owner_create_booking',
  'owner_block','owner_add_payment','owner_upsert_service','owner_delete_service','owner_upsert_resource','owner_delete_resource',
  'owner_notification_settings','owner_update_notification_settings','owner_update_config','owner_update_legal','owner_telegram_code',
  'owner_telegram_links','owner_notification_status','owner_telegram_unlink','owner_waitlist','owner_waitlist_status',
  'owner_subscription','owner_promo_codes','owner_upsert_promo','owner_delete_promo','owner_reviews','owner_publish_review','owner_source_stats',
]);

const getConfig = () => ({
  url: (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, ''),
  anon: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
});
const send = (res, status, body, extra = {}) => {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [name, value] of Object.entries(extra)) res.setHeader(name, value);
  res.end(JSON.stringify(body));
};
const cookies = (header = '') => Object.fromEntries(header.split(';').map((part) => {
  const i = part.indexOf('='); return i < 0 ? ['', ''] : [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
}));
const cookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; ${SECURE_COOKIE ? 'Secure; ' : ''}SameSite=Strict; Max-Age=${maxAge}`;
const clearCookies = () => [cookie(ACCESS, '', 0), cookie(REFRESH, '', 0)];
const originAllowed = (req) => {
  const origin = req.headers.origin;
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite === 'cross-site') return false;
  if (!origin) return req.method === 'GET';
  try {
    const originUrl = new URL(origin);
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const localDev = process.env.NODE_ENV !== 'production' && ['localhost','127.0.0.1'].includes(originUrl.hostname) && ['localhost','127.0.0.1'].includes(host.split(':')[0]);
    return originUrl.host.toLowerCase() === host.toLowerCase() && (originUrl.protocol === 'https:' || localDev);
  } catch { return false; }
};
const parseBody = async (req) => {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
};
const setSessionCookies = (res, session) => {
  const maxAccess = Math.max(60, Number(session.expires_in) || 3600);
  res.setHeader('Set-Cookie', [cookie(ACCESS, session.access_token, maxAccess), cookie(REFRESH, session.refresh_token, 60 * 60 * 24 * 30)]);
};
const supabaseFetch = (url, anon, token, path, init = {}) => fetch(`${url}${path}`, {
  ...init,
  headers: { apikey: anon, Authorization: `Bearer ${token}`, ...(init.headers || {}) },
});
const getSession = async (req, res, cfg) => {
  const jar = cookies(req.headers.cookie);
  let access = jar[ACCESS] || '';
  const refresh = jar[REFRESH] || '';
  if (access) {
    const r = await supabaseFetch(cfg.url, cfg.anon, access, '/auth/v1/user');
    if (r.ok) return { access, user: await r.json() };
  }
  if (!refresh) return null;
  const r = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: cfg.anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!r.ok) { res.setHeader('Set-Cookie', clearCookies()); return null; }
  const session = await r.json();
  setSessionCookies(res, session);
  access = session.access_token;
  return { access, user: session.user };
};

export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  if (!originAllowed(req)) return send(res, 403, { error: 'forbidden' });
  const cfg = getConfig();
  if (!cfg.url || !cfg.anon) return send(res, 503, { error: 'temporarily_unavailable' });
  const action = String(req.query?.action || '');
  try {
    if (req.method === 'GET' && action === 'session') {
      const session = await getSession(req, res, cfg);
      return send(res, 200, { user: session?.user || null });
    }
    if (req.method === 'POST' && action === 'logout') return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookies() });
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

    const session = await getSession(req, res, cfg);
    if (action === 'login') {
      const body = await parseBody(req);
      const result = await fetch(`${cfg.url}/functions/v1/owner-login`, {
        method: 'POST', headers: { apikey: cfg.anon, 'Content-Type': 'application/json', 'x-real-ip': String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() }, body: JSON.stringify(body),
      });
      const payload = await result.json().catch(() => ({}));
      if (!result.ok || !payload.session) return send(res, result.status, payload);
      setSessionCookies(res, payload.session);
      return send(res, 200, { user: payload.user || null });
    }
    if (action === 'recover') {
      const body = await parseBody(req);
      const result = await fetch(`${cfg.url}/functions/v1/owner-team`, {
        method: 'POST', headers: { apikey: cfg.anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, action: 'recover' }),
      });
      return send(res, result.status, await result.json().catch(() => ({ error: 'request_failed' })));
    }
    if (!session?.access) return send(res, 401, { error: 'session_expired' });

    if (action === 'rpc') {
      const body = await parseBody(req);
      if (!OWNER_RPCS.has(body.fn)) return send(res, 400, { error: 'bad_request' });
      const result = await supabaseFetch(cfg.url, cfg.anon, session.access, `/rest/v1/rpc/${encodeURIComponent(body.fn)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body.args || {}),
      });
      const text = await result.text();
      res.statusCode = result.status; res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', result.headers.get('content-type') || 'application/json'); return res.end(text);
    }
    if (action === 'team') {
      const body = await parseBody(req);
      const result = await fetch(`${cfg.url}/functions/v1/owner-team`, {
        method: 'POST', headers: { apikey: cfg.anon, Authorization: `Bearer ${session.access}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return send(res, result.status, await result.json().catch(() => ({ error: 'request_failed' })));
    }
    if (action === 'password') {
      const body = await parseBody(req);
      if (typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 1024) return send(res, 400, { error: 'bad_request' });
      const result = await supabaseFetch(cfg.url, cfg.anon, session.access, '/auth/v1/user', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: body.password, data: { must_change_password: false } }),
      });
      if (!result.ok) return send(res, result.status, { error: 'password_update_failed' });
      return send(res, 200, { ok: true });
    }
    if (action === 'services' || action === 'resources' || action === 'tenant') {
      const body = await parseBody(req);
      const slug = encodeURIComponent(String(body.slug || ''));
      if (!/^[a-z0-9-]{2,40}$/.test(decodeURIComponent(slug))) return send(res, 400, { error: 'bad_request' });
      const membership = await supabaseFetch(cfg.url, cfg.anon, session.access, '/rest/v1/rpc/owner_me', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_slug: decodeURIComponent(slug) }),
      });
      if (!membership.ok || await membership.json().catch(() => false) !== true) return send(res, 403, { error: 'forbidden' });
      if (action === 'services' && body.includeInactive === true) {
        const roleResponse = await supabaseFetch(cfg.url, cfg.anon, session.access, '/rest/v1/rpc/owner_access', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_slug: decodeURIComponent(slug) }),
        });
        const role = await roleResponse.text();
        if (!roleResponse.ok || !['"owner"','"manager"'].includes(role)) return send(res, 403, { error: 'forbidden' });
      }
      const table = action === 'services' ? 'services' : action === 'resources' ? 'resources' : 'tenants';
      const select = action === 'services' ? 'id,name,category,price_cents,duration_minutes,active,tenants!inner(slug)' : action === 'resources' ? 'id,name,tenants!inner(slug)' : 'id';
      const filters = [`select=${encodeURIComponent(select)}`, action === 'tenant' ? `slug=eq.${slug}` : `tenants.slug=eq.${slug}`];
      if (action === 'services' && body.includeInactive !== true) filters.push('active=eq.true');
      if (action === 'services') filters.push('order=price_cents.asc');
      const result = await supabaseFetch(cfg.url, cfg.anon, session.access, `/rest/v1/${table}?${filters.join('&')}`);
      return send(res, result.status, await result.json().catch(() => []));
    }
    if (action === 'export') {
      const body = await parseBody(req);
      const slug = String(body.slug || '');
      if (!/^[a-z0-9-]{2,40}$/.test(slug)) return send(res, 400, { error: 'bad_request' });
      const result = await fetch(`${cfg.url}/functions/v1/tenant-export`, {
        method: 'POST', headers: { apikey: cfg.anon, Authorization: `Bearer ${session.access}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }),
      });
      if (!result.ok) return send(res, result.status, await result.json().catch(() => ({ error: 'request_failed' })));
      const buf = Buffer.from(await result.arrayBuffer());
      res.statusCode = 200; res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', result.headers.get('content-disposition') || `attachment; filename="${slug}-export.zip"`);
      return res.end(buf);
    }
    if (action === 'media') {
      const { Readable } = await import('node:stream');
      const result = await fetch(`${cfg.url}/functions/v1/media-management`, {
        method: 'POST', headers: { apikey: cfg.anon, Authorization: `Bearer ${session.access}`, 'Content-Type': String(req.headers['content-type'] || '') },
        body: Readable.toWeb(req), duplex: 'half',
      });
      return send(res, result.status, await result.json().catch(() => ({ error: 'request_failed' })));
    }
    return send(res, 404, { error: 'not_found' });
  } catch {
    return send(res, 400, { error: 'bad_request' });
  }
}

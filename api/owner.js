const SECURE_COOKIE = process.env.NODE_ENV === 'production';
const ACCESS = SECURE_COOKIE ? '__Host-studio_owner_access' : 'studio_owner_access';
const REFRESH = SECURE_COOKIE ? '__Host-studio_owner_refresh' : 'studio_owner_refresh';
const IMP_SESSION = SECURE_COOKIE ? '__Host-studio_owner_imp_session' : 'studio_owner_imp_session';
const IMP_ADMIN = SECURE_COOKIE ? '__Host-studio_owner_imp_admin' : 'studio_owner_imp_admin';
const IMP_EXP = SECURE_COOKIE ? '__Host-studio_owner_imp_exp' : 'studio_owner_imp_exp';
const OWNER_RPCS = new Set([
  'owner_me','owner_access','owner_bookings','staff_bookings','owner_stats','owner_repeat_stats','owner_audit_history',
  'owner_set_status','staff_set_status','owner_cancel','owner_erase_customer','owner_reschedule','owner_create_booking',
  'owner_block','owner_add_payment','owner_upsert_service','owner_delete_service','owner_upsert_resource','owner_delete_resource',
  'owner_notification_settings','owner_update_notification_settings','owner_update_config','owner_update_legal','owner_telegram_code',
  'owner_telegram_links','owner_notification_status','owner_telegram_unlink','owner_waitlist','owner_waitlist_status',
  'owner_subscription','owner_plan_usage','owner_pending_price_change','owner_mark_price_changes_read','owner_billing_notifications','owner_mark_billing_notifications_read','owner_respond_price_change','owner_promo_codes','owner_upsert_promo','owner_delete_promo','owner_reviews','owner_publish_review','owner_source_stats',
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
const clearImpersonationCookies = () => [cookie(IMP_SESSION, '', 0), cookie(IMP_ADMIN, '', 0), cookie(IMP_EXP, '', 0)];
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
const setSessionCookies = (res, session, maxAge = 60 * 60 * 24 * 30) => {
  const maxAccess = Math.max(1, Math.min(maxAge, Number(session.expires_in) || 3600));
  res.setHeader('Set-Cookie', [cookie(ACCESS, session.access_token, maxAccess), cookie(REFRESH, session.refresh_token, maxAge)]);
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
  const impersonationExpiry = Number(jar[IMP_EXP]);
  const remaining = jar[IMP_SESSION] ? (Number.isFinite(impersonationExpiry) ? Math.floor((impersonationExpiry - Date.now()) / 1000) : 0) : 60 * 60 * 24 * 30;
  if (remaining <= 0) { res.setHeader('Set-Cookie',[...clearCookies(),...clearImpersonationCookies()]); return null; }
  setSessionCookies(res, session, remaining);
  access = session.access_token;
  return { access, user: session.user };
};
const platformAction = async (cfg, adminToken, action, body = {}) => {
  const r = await fetch(`${cfg.url}/functions/v1/platform-admin`, { method: 'POST', headers: { apikey: cfg.anon, Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
  return { ok: r.ok, status: r.status, payload: await r.json().catch(() => ({})) };
};

export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  if (!originAllowed(req)) return send(res, 403, { error: 'forbidden' });
  const cfg = getConfig();
  if (!cfg.url || !cfg.anon) return send(res, 503, { error: 'temporarily_unavailable' });
  const action = String(req.query?.action || '');
  try {
    const jar = cookies(req.headers.cookie);
    if (req.method === 'POST' && action === 'impersonate_start') {
      const body = await parseBody(req);
      const adminToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!adminToken) return send(res, 401, { error: 'unauthorized' });
      const started = await platformAction(cfg, adminToken, 'impersonation_start', { tenant_id: body.tenant_id, reason: body.reason });
      if (!started.ok || !started.payload?.data?.owner_session) return send(res, started.status, started.payload);
      const d = started.payload.data;
      const maxAge=Math.max(1,Math.floor((new Date(d.expires_at).getTime()-Date.now())/1000));
      res.setHeader('Set-Cookie', [cookie(ACCESS,d.owner_session.access_token,maxAge),cookie(REFRESH,d.owner_session.refresh_token,maxAge),cookie(IMP_SESSION,d.session_id,maxAge),cookie(IMP_ADMIN,adminToken,maxAge),cookie(IMP_EXP,String(new Date(d.expires_at).getTime()),maxAge)]);
      return send(res, 200, { ok:true, tenant_slug:d.tenant_slug, expires_at:d.expires_at });
    }
    if (req.method === 'POST' && action === 'impersonate_stop') {
      if (jar[IMP_SESSION] && jar[IMP_ADMIN]) await platformAction(cfg,jar[IMP_ADMIN],'impersonation_end',{session_id:jar[IMP_SESSION]});
      return send(res,200,{ok:true},{'Set-Cookie':[...clearCookies(),...clearImpersonationCookies()]});
    }
    if (req.method === 'GET' && action === 'session') {
      const session = await getSession(req, res, cfg);
      if (!session) return send(res, 200, { user:null });
      if (jar[IMP_SESSION] && jar[IMP_ADMIN]) {
        const check = await platformAction(cfg,jar[IMP_ADMIN],'impersonation_check',{session_id:jar[IMP_SESSION]});
        if (!check.ok) return send(res,200,{user:null},{'Set-Cookie':[...clearCookies(),...clearImpersonationCookies()]});
        return send(res,200,{user:session.user,impersonation:check.payload.data});
      }
      return send(res, 200, { user: session.user });
    }
    if (req.method === 'POST' && action === 'logout') {
      if (jar[IMP_SESSION] && jar[IMP_ADMIN]) await platformAction(cfg,jar[IMP_ADMIN],'impersonation_end',{session_id:jar[IMP_SESSION]});
      return send(res, 200, { ok: true }, { 'Set-Cookie': [...clearCookies(),...clearImpersonationCookies()] });
    }
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

    let impersonation = null;
    if (jar[IMP_SESSION] || jar[IMP_ADMIN]) {
      if (!jar[IMP_SESSION] || !jar[IMP_ADMIN]) return send(res,401,{error:'impersonation_expired'},{'Set-Cookie':[...clearCookies(),...clearImpersonationCookies()]});
      const check = await platformAction(cfg,jar[IMP_ADMIN],'impersonation_check',{session_id:jar[IMP_SESSION]});
      if (!check.ok) return send(res,401,{error:'impersonation_expired'},{'Set-Cookie':[...clearCookies(),...clearImpersonationCookies()]});
      impersonation = check.payload.data;
    }

    if (action === 'rpc') {
      const body = await parseBody(req);
      if (!OWNER_RPCS.has(body.fn)) return send(res, 400, { error: 'bad_request' });
      if (impersonation) {
        const args=body.args||{};
        if (args.p_slug && args.p_slug !== impersonation.tenant_slug) return send(res,403,{error:'forbidden'});
        const scopedTables={owner_set_status:'bookings',staff_set_status:'bookings',owner_cancel:'bookings',owner_erase_customer:'bookings',owner_reschedule:'bookings',owner_add_payment:'bookings',owner_delete_service:'services',owner_delete_resource:'resources',owner_waitlist_status:'waitlist',owner_telegram_unlink:'telegram_links'};
        const recordId=args.p_booking||args.p_id;
        if (!args.p_slug) {
          const table=scopedTables[body.fn];
          if (!table||!recordId) return send(res,403,{error:'forbidden'});
          const scope=await supabaseFetch(cfg.url,cfg.anon,session.access,`/rest/v1/${table}?select=tenant_id&id=eq.${encodeURIComponent(String(recordId))}`);
          const rows=await scope.json().catch(()=>[]);
          if (!scope.ok||!Array.isArray(rows)||!rows.some((row)=>row.tenant_id===impersonation.tenant_id)) return send(res,403,{error:'forbidden'});
        }
      }
      const result = await supabaseFetch(cfg.url, cfg.anon, session.access, `/rest/v1/rpc/${encodeURIComponent(body.fn)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body.args || {}),
      });
      const text = await result.text();
      const auditedOwnerMutations=new Set(['owner_set_status','staff_set_status','owner_cancel','owner_erase_customer','owner_reschedule','owner_create_booking','owner_block','owner_add_payment','owner_upsert_service','owner_delete_service','owner_upsert_resource','owner_delete_resource','owner_update_notification_settings','owner_update_config','owner_update_legal','owner_telegram_unlink','owner_waitlist_status','owner_upsert_promo','owner_delete_promo','owner_publish_review','owner_respond_price_change']);
      if (impersonation && auditedOwnerMutations.has(body.fn)) await platformAction(cfg,jar[IMP_ADMIN],'impersonation_log',{session_id:jar[IMP_SESSION],owner_action:body.fn,succeeded:result.ok});
      res.statusCode = result.status; res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', result.headers.get('content-type') || 'application/json'); return res.end(text);
    }
    if (action === 'team') {
      const body = await parseBody(req);
      if (impersonation) return send(res,403,{error:'forbidden'});
      const result = await fetch(`${cfg.url}/functions/v1/owner-team`, {
        method: 'POST', headers: { apikey: cfg.anon, Authorization: `Bearer ${session.access}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return send(res, result.status, await result.json().catch(() => ({ error: 'request_failed' })));
    }
    if (action === 'password') {
      if (impersonation) return send(res,403,{error:'forbidden'});
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
      if (impersonation && body.slug !== impersonation.tenant_slug) return send(res,403,{error:'forbidden'});
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
      if (impersonation) return send(res,403,{error:'forbidden'});
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
      if (impersonation) return send(res,403,{error:'forbidden'});
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

import { createClient } from 'npm:@supabase/supabase-js@2';
import { strToU8, zipSync } from 'npm:fflate@0.8.2';

// Экспорт данных организации: ZIP с CSV (записи, клиенты, услуги, отзывы, платежи студии).
// Доступен владельцу организации и суперадмину платформы. Подписка НЕ проверяется:
// экспорт работает и в статусе suspended. Каждый экспорт пишется в platform_audit_logs.

const site = (Deno.env.get('SITE_URL') ?? '').trim();
const allowed = new Set<string>();
try { if (site) allowed.add(new URL(site).origin); } catch { /* configured by deployment */ }
try { if (['localhost', '127.0.0.1'].includes(new URL(Deno.env.get('SUPABASE_URL') ?? '').hostname)) { allowed.add('http://localhost:5173'); allowed.add('http://127.0.0.1:5173'); } } catch { /* prod: SITE_URL only */ }
const corsFor = (req: Request) => {
  const origin = req.headers.get('origin') ?? '';
  return allowed.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : { 'Vary': 'Origin' };
};
const baseHeaders = (req: Request) => ({ ...corsFor(req), 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Expose-Headers': 'content-disposition' });
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...baseHeaders(req), 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// CSV с защитой от formula injection (=, +, -, @ в начале ячейки) и BOM для корректной кириллицы в Excel.
const cell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows: Record<string, unknown>[]): string => {
  if (!rows.length) return '\uFEFF';
  const cols = [...rows.reduce((set, r) => { Object.keys(r).forEach((k) => set.add(k)); return set; }, new Set<string>())];
  return '\uFEFF' + [cols.map(cell).join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: baseHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  const origin = req.headers.get('origin');
  if (origin && !allowed.has(origin)) return json(req, { error: 'forbidden' }, 403);

  const url = Deno.env.get('SUPABASE_URL') ?? '', anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '', service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !anon || !service) return json(req, { error: 'temporarily_unavailable' }, 503);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(req, { error: 'unauthorized' }, 401);
  const caller = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await caller.auth.getUser(token);
  if (authError || !user) return json(req, { error: 'unauthorized' }, 401);
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const slug = typeof body?.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  const tenantId = typeof body?.tenant_id === 'string' && UUID.test(body.tenant_id) ? body.tenant_id : '';
  if (!/^[a-z0-9-]{2,40}$/.test(slug) && !tenantId) return json(req, { error: 'bad_request' }, 400);

  const q = tenantId ? admin.from('tenants').select('id,slug').eq('id', tenantId) : admin.from('tenants').select('id,slug').eq('slug', slug);
  const { data: tenant, error: tenantError } = await q.maybeSingle();
  if (tenantError) return json(req, { error: 'temporarily_unavailable' }, 503);
  if (!tenant) return json(req, { error: 'not_found' }, 404);

  // доступ: владелец этой организации ИЛИ суперадмин платформы
  const [{ data: member }, { data: isAdmin }] = await Promise.all([
    admin.from('tenant_members').select('role').eq('tenant_id', tenant.id).eq('user_id', user.id).maybeSingle(),
    admin.rpc('is_platform_admin', { p_user: user.id }),
  ]);
  const byOwner = member?.role === 'owner';
  if (!byOwner && isAdmin !== true) return json(req, { error: 'forbidden' }, 403);
  if (byOwner) {
    const { data: allowed, error: featureError } = await admin.rpc('tenant_feature_enabled', { p_tenant: tenant.id, p_feature: 'export' });
    if (featureError) return json(req, { error: 'temporarily_unavailable' }, 503);
    if (allowed !== true) return json(req, { error: 'feature_disabled' }, 403);
  }

  const rate = await admin.rpc('consume_platform_rate', { p_scope: 'platform_export', p_key: `user:${user.id}`, p_limit: 10, p_window: 3600 });
  if (rate.error) return json(req, { error: 'temporarily_unavailable' }, 503);
  if (rate.data !== true) return json(req, { error: 'rate_limited' }, 429);

  const { data, error } = await admin.rpc('tenant_export_data', { p_tenant: tenant.id });
  if (error || !data) { console.error('export failed:', error?.message); return json(req, { error: 'operation_failed' }, 500); }

  const tables = data as Record<string, Record<string, unknown>[]>;
  const files: Record<string, Uint8Array> = {};
  const names: Record<string, string> = { bookings: 'bookings.csv', customers: 'customers.csv', services: 'services.csv', reviews: 'reviews.csv', payments: 'studio_payments.csv' };
  const counts: Record<string, number> = {};
  for (const [key, file] of Object.entries(names)) { const rows = tables[key] ?? []; counts[key] = rows.length; files[file] = strToU8(toCsv(rows)); }
  files['README.txt'] = strToU8(`Экспорт данных организации ${tenant.slug}\r\nСформирован: ${new Date().toISOString()}\r\nФайлы: ${Object.values(names).join(', ')}\r\nКодировка: UTF-8 (BOM), разделитель: запятая.\r\n`);

  await admin.rpc('platform_log', { p_actor: user.id, p_action: 'tenant.export', p_tenant: tenant.id, p_payload: { by: byOwner ? 'owner' : 'platform_admin', counts } });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(zipSync(files), { status: 200, headers: { ...baseHeaders(req), 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${tenant.slug}-export-${stamp}.zip"`, 'Cache-Control': 'no-store' } });
});

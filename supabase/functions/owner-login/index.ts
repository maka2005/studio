import { createClient } from 'npm:@supabase/supabase-js@2';

const site = (Deno.env.get('SITE_URL') ?? '').trim();
const allowedOrigins = new Set<string>();
try { if (site) allowedOrigins.add(new URL(site).origin); } catch { /* configured by deployment */ }
allowedOrigins.add('http://localhost:5173');
allowedOrigins.add('http://127.0.0.1:5173');
const corsFor = (req: Request) => {
  const origin = req.headers.get('origin') ?? '';
  return allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {};
};
const json = (req: Request, body: unknown, status = 200) => {
  return new Response(JSON.stringify(body), { status, headers: { ...corsFor(req), 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' } });
};
const ipOf = (r: Request) => r.headers.get('cf-connecting-ip') ?? r.headers.get('x-real-ip') ?? 'unknown';
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, '0')).join('');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { ...corsFor(req), 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  const origin = req.headers.get('origin');
  if (origin && !allowedOrigins.has(origin)) return json(req, { error: 'forbidden' }, 403);
  const p = await req.json().catch(() => null) as Record<string, unknown> | null;
  const email = typeof p?.email === 'string' ? p.email.trim().toLowerCase().slice(0, 254) : '';
  const password = typeof p?.password === 'string' ? p.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 1 || password.length > 1024) return json(req, { error: 'bad_request' }, 400);
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !anon || !service) return json(req, { error: 'temporarily_unavailable' }, 503);
  const admin = createClient(url, service);
  const [ipHash, emailHash] = await Promise.all([sha(ipOf(req)), sha(email)]);
  const [ipAllowed, emailAllowed] = await Promise.all([
    admin.rpc('consume_public_rate', { p_scope: 'admin_login', p_key: `ip:${ipHash}`, p_limit: 8, p_window: 900 }),
    admin.rpc('consume_public_rate', { p_scope: 'admin_login', p_key: `email:${emailHash}`, p_limit: 10, p_window: 3600 }),
  ]);
  if (ipAllowed.error || emailAllowed.error) return json(req, { error: 'temporarily_unavailable' }, 503);
  if (ipAllowed.data !== true || emailAllowed.data !== true) return json(req, { error: 'rate_limited' }, 429);
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.session) return json(req, { error: 'bad_credentials' }, 401);
  return json(req, { session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } });
});

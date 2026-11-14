const config = () => ({
  url: (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, ''),
  anon: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
});

async function check(key, label, url, init = {}) {
  if (!url) return { key, label, state: 'unknown' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
    return {
      key,
      label,
      state: response.ok ? 'operational' : 'down',
    };
  } catch (error) {
    return {
      key,
      label,
      state: 'down',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { url, anon } = config();
  const headers = anon ? { apikey: anon } : {};
  const configured = Boolean(url && anon);
  const origin = process.env.SITE_URL || 'https://studio-omega-lemon-53.vercel.app';
  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const siteUrl = forwardedHost ? `https://${forwardedHost}` : '';
  const [web, database, auth, edge] = await Promise.all([
    check('web', 'Веб-приложение', siteUrl),
    check('database', 'База данных', configured ? `${url}/rest/v1/platform_service_status?select=id&limit=1` : '', { headers }),
    check('auth', 'Авторизация', configured ? `${url}/auth/v1/settings` : '', { headers }),
    check('edge', 'Серверные функции', configured ? `${url}/functions/v1/platform-admin` : '', {
      method: 'OPTIONS',
      headers: { ...headers, Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,apikey' },
    }),
  ]);

  const api = { key: 'api', label: 'API и мониторинг', state: 'operational' };
  const down = [web, database, auth, edge].filter(item => item.state === 'down').length;
  const unknown = [web, database, auth, edge].some(item => item.state === 'unknown');
  const checks = [
    web,
    api,
    database,
    auth,
    edge,
  ];
  res.status(200).json({
    checked_at: new Date().toISOString(),
    status: down >= 2 ? 'outage' : down > 0 || unknown ? 'degraded' : 'operational',
    checks,
  });
}

import { withObservability } from './_observability.js';

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const requestId = req.requestId || req.headers?.['x-request-id'] || null;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString('utf8').slice(0, 20000);
    let report = raw;
    try { report = JSON.parse(raw); } catch {}
    console.warn(JSON.stringify({
      level: 'warn',
      at: new Date().toISOString(),
      service: 'vercel-api',
      event: 'csp-report',
      request_id: requestId,
      ua: String(req.headers['user-agent'] || '').slice(0, 300),
      report,
    }).slice(0, 8000));
  } catch (error) {
    console.warn(JSON.stringify({
      level: 'warn',
      at: new Date().toISOString(),
      service: 'vercel-api',
      event: 'csp-report-failed',
      request_id: requestId,
      error: String(error?.message || error).slice(0, 500),
    }));
  }
  res.status(204).end();
}

export default withObservability(handler, { name: 'csp-report' });

import { withObservability } from './_observability.js';

const MAX_CSP_BYTES = 20_000;

const cleanUri = (value) => {
  try {
    const url = new URL(String(value || ''));
    return `${url.origin}${url.pathname}`.slice(0, 300);
  } catch {
    return '';
  }
};

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (Number(req.headers['content-length'] || 0) > MAX_CSP_BYTES) {
    return res.status(413).end();
  }

  const requestId = req.requestId || req.headers?.['x-request-id'] || null;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_CSP_BYTES) return res.status(413).end();
      chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const entry = parsed && typeof parsed === 'object' ? parsed['csp-report'] ?? parsed : null;
    const report = entry && typeof entry === 'object'
      ? {
          document_uri: cleanUri(entry['document-uri']),
          blocked_uri: cleanUri(entry['blocked-uri']),
          violated_directive: String(entry['violated-directive'] ?? '').slice(0, 120),
          effective_directive: String(entry['effective-directive'] ?? '').slice(0, 120),
          status_code: Number(entry['status-code']) || 0,
        }
      : null;

    console.warn(JSON.stringify({
      level: 'warn',
      at: new Date().toISOString(),
      service: 'vercel-api',
      event: 'csp-report',
      request_id: requestId,
      ua: String(req.headers['user-agent'] || '').slice(0, 200),
      report,
    }).slice(0, 4000));
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

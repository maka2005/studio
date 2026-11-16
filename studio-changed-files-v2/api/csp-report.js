export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString('utf8').slice(0, 20000);
    let report = raw;
    try { report = JSON.parse(raw); } catch {}
    console.warn('csp-report', JSON.stringify({ at: new Date().toISOString(), ua: String(req.headers['user-agent'] || '').slice(0, 300), report }).slice(0, 8000));
  } catch (error) {
    console.warn('csp-report-failed', error?.message || error);
  }
  res.status(204).end();
}

const randomId = () => {
  try { return crypto.randomUUID(); } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
};

const getRequestId = (req) => {
  const fromHeader = req?.headers?.['x-request-id'] || req?.headers?.['x-correlation-id'];
  const id = String(Array.isArray(fromHeader) ? fromHeader[0] : fromHeader || '').trim();
  return id && id.length <= 128 ? id : randomId();
};

export function withObservability(handler, opts = {}) {
  const name = opts.name || handler?.name || 'api';
  return async function observed(req, res) {
    const start = Date.now();
    const requestId = getRequestId(req);
    const method = String(req?.method || 'GET').toUpperCase();
    const path = String(req?.url || '/').split('?')[0];
    req.requestId = requestId;
    try { res.setHeader('x-request-id', requestId); } catch {}

    let logged = false;
    const log = (status, extra = {}) => {
      if (logged) return;
      logged = true;
      const durationMs = Date.now() - start;
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
      const payload = {
        level,
        at: new Date().toISOString(),
        service: 'vercel-api',
        handler: name,
        request_id: requestId,
        method,
        path,
        status,
        duration_ms: durationMs,
        ...extra,
      };
      const line = JSON.stringify(payload);
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    };

    const origEnd = res.end;
    res.end = function patchedEnd(...args) {
      const status = Number(res.statusCode || 200);
      log(status);
      return origEnd.apply(this, args);
    };

    try {
      const result = await handler(req, res);
      // If handler returned without ending (unlikely), log best-effort.
      if (!logged) log(Number(res.statusCode || 200));
      return result;
    } catch (error) {
      const status = Number(res.statusCode || 500);
      log(status >= 400 ? status : 500, {
        error: String(error?.message || error || 'internal_error').slice(0, 500),
      });
      if (!res.headersSent && !res.writableEnded) {
        try {
          res.statusCode = status >= 400 ? status : 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'internal_error', request_id: requestId }));
        } catch {}
      }
      throw error;
    }
  };
}

export function logApi(level, event, fields = {}) {
  const payload = {
    level,
    at: new Date().toISOString(),
    service: 'vercel-api',
    event,
    ...fields,
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

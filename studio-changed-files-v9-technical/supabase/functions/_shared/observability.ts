export type LogLevel = 'info' | 'warn' | 'error';

export const getRequestId = (req: Request) => {
  const id = (req.headers.get('x-request-id') || req.headers.get('x-correlation-id') || '').trim();
  return id && id.length <= 128 ? id : crypto.randomUUID();
};

export const jsonLog = (level: LogLevel, payload: Record<string, unknown>) => {
  const line = JSON.stringify({ level, at: new Date().toISOString(), service: 'edge-function', ...payload });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

export function withEdgeObservability(
  fnName: string,
  handler: (req: Request, ctx: { requestId: string }) => Promise<Response> | Response,
) {
  return async (req: Request): Promise<Response> => {
    const start = Date.now();
    const requestId = getRequestId(req);
    const method = req.method.toUpperCase();
    const path = new URL(req.url).pathname;
    try {
      const res = await handler(req, { requestId });
      const headers = new Headers(res.headers);
      headers.set('x-request-id', requestId);
      const wrapped = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      jsonLog(res.status >= 500 ? 'error' : res.status >= 400 ? 'warn' : 'info', {
        function: fnName,
        request_id: requestId,
        method,
        path,
        status: wrapped.status,
        duration_ms: Date.now() - start,
      });
      return wrapped;
    } catch (error) {
      jsonLog('error', {
        function: fnName,
        request_id: requestId,
        method,
        path,
        status: 500,
        duration_ms: Date.now() - start,
        error: String((error as Error)?.message || error || 'internal_error').slice(0, 500),
      });
      return new Response(JSON.stringify({ error: 'internal_error', request_id: requestId }), {
        status: 500,
        headers: { 'content-type': 'application/json', 'x-request-id': requestId },
      });
    }
  };
}

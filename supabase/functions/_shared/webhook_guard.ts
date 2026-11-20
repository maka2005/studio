const enc = new TextEncoder();

export class WebhookError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Constant-time comparison for shared secrets and signatures. */
export function safeEqual(a: string, b: string): boolean {
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i]! ^ bb[i]!;
  return diff === 0;
}

/** Read a request body with a hard byte cap, independent of content-length. */
export async function readTextBody(req: Request, maxBytes = 64 * 1024): Promise<string> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new WebhookError('body_too_large', 413);
  }
  if (!req.body) return '';

  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new WebhookError('body_too_large', 413);
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
  return text;
}

export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Optional replay envelope. Providers that can send these headers get
 * timestamp + nonce + HMAC protection; others keep working with the shared
 * secret alone and are deduplicated by the server-side event ledger.
 */
export async function verifyEnvelope(
  secret: string,
  req: Request,
  rawBody: string,
  maxSkewMs = 300_000,
): Promise<boolean> {
  const ts = Number(req.headers.get('x-webhook-timestamp') ?? '');
  const nonce = String(req.headers.get('x-webhook-nonce') ?? '');
  const sig = String(req.headers.get('x-webhook-signature') ?? '');
  if (!ts && !nonce && !sig) return true;
  if (!Number.isSafeInteger(ts) || Math.abs(Date.now() - ts) > maxSkewMs) return false;
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(nonce)) return false;
  const expected = await hmacHex(secret, `${ts}.${nonce}.${rawBody}`);
  return safeEqual(sig, expected);
}

/** Remove emails, bearer tokens and bot tokens before writing logs. */
export const redact = (value: unknown, max = 300): string =>
  String(value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/bot\d+:[A-Za-z0-9_-]+/gi, 'bot[redacted]')
    .slice(0, max);

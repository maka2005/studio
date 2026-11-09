export type OwnerUser = { id: string; email?: string; user_metadata?: Record<string, unknown> }

export async function ownerRequest<T = Record<string, unknown>>(action: string, body?: unknown, method: 'GET' | 'POST' = 'POST'): Promise<T> {
  const response = await fetch(`/api/owner?action=${encodeURIComponent(action)}`, {
    method,
    credentials: 'same-origin',
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(payload?.error || `request_failed_${response.status}`));
    Object.assign(error, { status: response.status });
    throw error;
  }
  return payload as T;
}

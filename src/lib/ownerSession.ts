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

// Скачивание ZIP с данными организации через прокси (токен владельца остаётся в HttpOnly-cookie).
export async function downloadOwnerExport(slug: string): Promise<void> {
  const response = await fetch('/api/owner?action=export', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(String(payload?.error || `request_failed_${response.status}`));
  }
  const blob = await response.blob();
  const name = /filename="?([^";]+)"?/i.exec(response.headers.get('content-disposition') || '')?.[1] || `${slug}-export.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

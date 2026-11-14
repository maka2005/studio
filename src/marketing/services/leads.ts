export interface LeadPayload {
  name: string;
  phone: string;
  businessType: string;
  requestType: 'connect' | 'demo';
  plan: string;
  comment: string;
}

export async function submitLead(payload: LeadPayload): Promise<void> {
  const response = await fetch('/api/platform?action=lead', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.error) throw new Error(String(result?.error ?? 'lead_submit_failed'));
}

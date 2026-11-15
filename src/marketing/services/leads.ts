export interface LeadPayload {
  businessName: string;
  ownerName: string;
  ownerEmail: string;
  phone: string;
  businessType: string;
  requestType: 'connect' | 'demo';
  plan: string;
  comment: string;
  consent: boolean;
}

export interface LeadResult {
  /** demo — организация создана автоматически; lead — заявка сохранена для менеджера */
  mode: 'demo' | 'lead';
  slug?: string;
  inviteSent?: boolean;
}

export async function submitLead(payload: LeadPayload): Promise<LeadResult> {
  const demo = payload.requestType === 'demo';
  const response = await fetch(`/api/platform?action=${demo ? 'demo' : 'lead'}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.error) throw new Error(String(result?.error ?? 'lead_submit_failed'));
  return {
    mode: result?.mode === 'demo' ? 'demo' : 'lead',
    slug: typeof result?.slug === 'string' ? result.slug : undefined,
    inviteSent: result?.invite_sent === true,
  };
}

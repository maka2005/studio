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
  /** Ловушка для ботов: должно оставаться пустым. */
  hp?: string;
  /** Сколько мс форма была открыта до отправки. */
  elapsedMs?: number;
  turnstileToken?: string;
}

export interface LeadResult {
  /** demo — демо создано; connect — организация подключена на пробный период; lead — заявка сохранена для менеджера */
  mode: 'demo' | 'connect' | 'lead' | 'accepted';
  slug?: string;
  inviteSent?: boolean;
  /** Только для connect: сколько и когда платить после пробного периода. */
  planName?: string;
  priceKzt?: number;
  periodMonths?: number;
  trialDays?: number;
  trialEndsAt?: string;
}

export async function submitLead(payload: LeadPayload): Promise<LeadResult> {
  const action = payload.requestType === 'demo' ? 'demo' : 'connect';
  const response = await fetch(`/api/platform?action=${action}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.error) throw new Error(String(result?.error ?? 'lead_submit_failed'));
  const mode = result?.mode === 'demo' ? 'demo' : result?.mode === 'connect' ? 'connect' : result?.mode === 'accepted' ? 'accepted' : 'lead';
  return {
    mode,
    slug: typeof result?.slug === 'string' ? result.slug : undefined,
    inviteSent: result?.invite_sent === true,
    planName: typeof result?.plan_name === 'string' ? result.plan_name : undefined,
    priceKzt: typeof result?.price_kzt === 'number' ? result.price_kzt : undefined,
    periodMonths: typeof result?.period_months === 'number' ? result.period_months : undefined,
    trialDays: typeof result?.trial_days === 'number' ? result.trial_days : undefined,
    trialEndsAt: typeof result?.trial_ends_at === 'string' ? result.trial_ends_at : undefined,
  };
}

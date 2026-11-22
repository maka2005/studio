import { maskPhone } from '../../../lib/phone';
import { attributionPayload } from '../../../lib/attribution';
import { getFunnelSessionId, trackEvent } from '../../../lib/observability';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { businessTypes } from '../../data/content';
import { useMarketingCopy } from '../../data/copy';
import { submitLead, type LeadPayload, type LeadResult } from '../../services/leads';
import { usePlans, useTrialDays } from '../../hooks/usePlans';
import { Button } from '../ui/Button';
import { Turnstile, turnstileEnabled } from './Turnstile';
import './ContactForm.scss';

type Status = 'idle' | 'sending' | 'sent' | 'validation-error' | 'consent-error' | 'error' | 'trial-used' | 'limited' | 'captcha-error';

export function ContactForm() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<Status>('idle');
  const plans = usePlans();
  const trialDays = useTrialDays();
  const copy = useMarketingCopy();
  const formCopy = copy.ui.contactForm;
  const orderCopy = formCopy.order;
  const money = (n: number) => `${n.toLocaleString(copy.ui.numberLocale)} ₸`;
  const [form, setForm] = useState<LeadPayload>({
    businessName: '',
    ownerName: '',
    ownerEmail: '',
    phone: maskPhone(params.get('phone') ?? ''),
    businessType: businessTypes[0] ?? 'СТО / автосервис',
    requestType: params.get('type') === 'demo' ? 'demo' : 'connect',
    plan: params.get('plan') ?? '',
    comment: '',
    consent: false,
  });
  const [result, setResult] = useState<LeadResult | null>(null);
  const [copied, setCopied] = useState(false);
  const openedAt = useRef(Date.now());
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaReset, setCaptchaReset] = useState(0);

  // «Демо» — начало воронки: фиксируем открытие формы, а не только отправку.
  useEffect(() => {
    if (form.requestType === 'demo') trackEvent('demo_start', { plan: form.plan || 'none' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update =
    (field: Exclude<keyof LeadPayload, 'consent' | 'elapsedMs'>) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const selectedPlan = plans.find((p) => p.id === form.plan.toLowerCase()) ?? plans[0];
  const connecting = form.requestType === 'connect';
  const trialEnd = trialDays ? new Date(Date.now() + trialDays * 86400_000) : null;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const digits = form.phone.replace(/\D/g, '');
    if (!form.businessName.trim() || !form.ownerName.trim() || !form.ownerEmail.trim() || digits.length !== 11) {
      setStatus('validation-error');
      return;
    }
    if (!form.consent) {
      setStatus('consent-error');
      return;
    }
    if (turnstileEnabled && !captchaToken) {
      setStatus('captcha-error');
      return;
    }
    setStatus('sending');
    try {
      const payload: LeadPayload = {
        ...(connecting && selectedPlan ? { ...form, plan: selectedPlan.id } : form),
        elapsedMs: Date.now() - openedAt.current,
        sessionId: getFunnelSessionId(),
        attribution: attributionPayload(),
        ...(captchaToken ? { turnstileToken: captchaToken } : {}),
      };
      setResult(await submitLead(payload));
      setStatus('sent');
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setStatus(code === 'trial_already_used' ? 'trial-used' : code === 'rate_limited' ? 'limited' : code === 'captcha_failed' ? 'captcha-error' : 'error');
    } finally {
      // Токен Turnstile одноразовый: после любой попытки нужен новый.
      setCaptchaToken('');
      setCaptchaReset((n) => n + 1);
    }
  };

  if (status === 'sent') {
    if (result?.mode === 'accepted') {
      return (
        <div className="contact-form contact-form--success" role="status">
          <h2>{connecting ? formCopy.success.acceptedConnectTitle : formCopy.success.acceptedDemoTitle}</h2>
          <p>{formCopy.success.acceptedBody(form.ownerEmail)}</p>
          {connecting && selectedPlan && <p>{formCopy.success.planLine(selectedPlan.name, trialDays)}</p>}
        </div>
      );
    }
    if (result?.mode === 'demo' && result.slug) {
      const bookingUrl = `${window.location.origin}/s/${result.slug}`;
      return (
        <div className="contact-form contact-form--success" role="status">
          <h2>{formCopy.success.demoReadyTitle}</h2>
          <p>
            {formCopy.success.demoCreated}{' '}
            {result.inviteSent
              ? formCopy.success.inviteSent(form.ownerEmail)
              : formCopy.success.inviteFailed}
          </p>
          <p>{formCopy.success.bookingUrlLabel}</p>
          <p>
            <a href={bookingUrl} target="_blank" rel="noopener noreferrer"><b>{bookingUrl}</b></a>
          </p>
          <div className="contact-form__actions">
            <Button href={`/s/${result.slug}/owner`}>{formCopy.success.openCabinet}</Button>
            <Button variant="secondary" href={bookingUrl}>{formCopy.success.openBooking}</Button>
            <Button
              variant="ghost"
              onClick={() => {
                navigator.clipboard?.writeText(bookingUrl).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? formCopy.buttons.copied : formCopy.buttons.copy}
            </Button>
          </div>
        </div>
      );
    }
    if (result?.mode === 'connect' && result.slug) {
      const bookingUrl = `${window.location.origin}/s/${result.slug}`;
      const trialEndsAt = result.trialEndsAt ? new Date(result.trialEndsAt) : trialEnd;
      return (
        <div className="contact-form contact-form--success" role="status">
          <h2>{formCopy.success.connectedTitle}</h2>
          <p>
            {result.inviteSent
              ? formCopy.success.inviteSent(form.ownerEmail)
              : formCopy.success.inviteFailed}
          </p>
          <div className="order-summary" aria-label={orderCopy.aria}>
            <div className="order-summary__row"><span>{orderCopy.plan}</span><b>{result.planName}</b></div>
            <div className="order-summary__row">
              <span>{orderCopy.trial}</span>
              <b>{formCopy.success.trialSummary(result.trialDays ?? trialDays, trialEndsAt)}</b>
            </div>
            <div className="order-summary__row"><span>{orderCopy.payToday}</span><b>0 ₸</b></div>
            {result.priceKzt !== undefined && (
              <div className="order-summary__row order-summary__row--total">
                <span>{orderCopy.afterTrial}</span>
                <b>{money(result.priceKzt)} / {result.periodMonths && result.periodMonths > 1 ? `${result.periodMonths} ${copy.ui.pricing.monthShort}` : copy.ui.pricing.monthShort}</b>
              </div>
            )}
          </div>
          <p>{formCopy.success.connectedNote}</p>
          <p>{formCopy.success.bookingUrlLabel}</p>
          <p><a href={bookingUrl} target="_blank" rel="noopener noreferrer"><b>{bookingUrl}</b></a></p>
          <div className="contact-form__actions">
            <Button href={`/s/${result.slug}/owner`}>{formCopy.success.openCabinet}</Button>
            <Button variant="secondary" href={bookingUrl}>{formCopy.success.openBooking}</Button>
            <Button
              variant="ghost"
              onClick={() => {
                navigator.clipboard?.writeText(bookingUrl).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? formCopy.buttons.copied : formCopy.buttons.copy}
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="contact-form contact-form--success" role="status">
        <h2>{formCopy.success.sentTitle}</h2>
        <p>
          {result?.mode === 'lead' && form.requestType === 'connect'
            ? formCopy.success.leadConnect
            : form.requestType === 'demo'
            ? formCopy.success.leadDemo
            : formCopy.success.leadGeneric}
        </p>
      </div>
    );
  }

  return (
    <form className="contact-form" onSubmit={handleSubmit} noValidate>
      <div className="contact-form__field">
        <label htmlFor="businessName">{formCopy.labels.businessName}</label>
        <input id="businessName" name="businessName" autoComplete="organization" value={form.businessName} onChange={update('businessName')} />
      </div>

      <div className="contact-form__field">
        <label htmlFor="ownerName">{formCopy.labels.ownerName}</label>
        <input id="ownerName" name="ownerName" autoComplete="name" value={form.ownerName} onChange={update('ownerName')} />
      </div>

      <div className="contact-form__field">
        <label htmlFor="ownerEmail">{formCopy.labels.ownerEmail}</label>
        <input id="ownerEmail" name="ownerEmail" type="email" autoComplete="email" value={form.ownerEmail} onChange={update('ownerEmail')} />
      </div>

      <div className="contact-form__field">
        <label htmlFor="phone">{formCopy.labels.phone}</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+7 (777) 123-45-67"
          inputMode="tel"
          maxLength={18}
          value={form.phone}
          onChange={(e) => setForm((prev) => ({ ...prev, phone: maskPhone(e.target.value, prev.phone) }))}
        />
      </div>

      <div className="contact-form__row">
        <div className="contact-form__field">
          <label htmlFor="requestType">{formCopy.labels.purpose}</label>
          <select id="requestType" name="requestType" value={form.requestType} onChange={update('requestType')}>
            <option value="connect">{formCopy.options.connect(trialDays)}</option>
            <option value="demo">{formCopy.options.demo}</option>
          </select>
        </div>

        <div className="contact-form__field">
          <label htmlFor="businessType">{formCopy.labels.businessType}</label>
          <select id="businessType" name="businessType" value={form.businessType} onChange={update('businessType')}>
            {businessTypes.map((type) => (
              <option key={type} value={type}>{formCopy.businessTypeLabels[type] ?? type}</option>
            ))}
          </select>
        </div>
      </div>

      {connecting && selectedPlan && (
        <>
          <div className="contact-form__field">
            <label htmlFor="plan">{formCopy.labels.plan}</label>
            <select id="plan" name="plan" value={selectedPlan.id} onChange={update('plan')}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{formCopy.planOption(p.name, p.price)}</option>
              ))}
            </select>
          </div>
          <div className="order-summary" aria-label={orderCopy.aria}>
            <div className="order-summary__row"><span>{orderCopy.plan}</span><b>{selectedPlan.name}</b></div>
            <div className="order-summary__row"><span>{orderCopy.trial}</span><b>{formCopy.success.trialSummary(trialDays, trialEnd)}</b></div>
            <div className="order-summary__row"><span>{orderCopy.payToday}</span><b>0 ₸</b></div>
            <div className="order-summary__row order-summary__row--total">
              <span>{orderCopy.afterTrial}</span>
              <b>{money(selectedPlan.price)} / {copy.ui.pricing.monthShort}</b>
            </div>
            <p className="contact-form__hint">{orderCopy.hint}</p>
          </div>
        </>
      )}

      <div className="contact-form__field">
        <label htmlFor="comment">{formCopy.labels.comment}</label>
        <textarea id="comment" name="comment" rows={4} value={form.comment} onChange={update('comment')} />
      </div>

      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label htmlFor="hp_field">{formCopy.labels.hp}</label>
        <input id="hp_field" name="hp_field" type="text" tabIndex={-1} autoComplete="off" value={form.hp ?? ''} onChange={update('hp')} />
      </div>

      <div className="contact-form__consent">
        <input
          id="consent"
          name="consent"
          type="checkbox"
          checked={form.consent}
          onChange={(e) => setForm((prev) => ({ ...prev, consent: e.target.checked }))}
        />
        <label htmlFor="consent">
          {formCopy.consent}{' '}
          <Link to="/privacy" target="_blank">{formCopy.privacyLink}</Link>
        </label>
      </div>

      <Turnstile onToken={setCaptchaToken} resetKey={captchaReset} />

      {status !== 'idle' && status !== 'sending' && (
        <p className="contact-form__error" role="alert">
          {status === 'validation-error' && formCopy.errors.validation}
          {status === 'captcha-error' && formCopy.errors.captcha}
          {status === 'consent-error' && formCopy.errors.consent}
          {status === 'trial-used' && formCopy.errors.trialUsed}
          {status === 'limited' && formCopy.errors.limited}
          {status === 'error' && formCopy.errors.error}
        </p>
      )}

      <Button type="submit" fullWidth>
        {status === 'sending'
          ? form.requestType === 'demo' ? formCopy.buttons.creatingDemo : formCopy.buttons.connecting
          : form.requestType === 'demo' ? formCopy.buttons.demo : formCopy.buttons.connect(selectedPlan?.name)}
      </Button>
      {form.requestType === 'demo' && (
        <p className="contact-form__hint">{formCopy.demoHint}</p>
      )}
    </form>
  );
}

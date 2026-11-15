import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { businessTypes } from '../../data/content';
import { submitLead, type LeadPayload, type LeadResult } from '../../services/leads';
import { usePlans } from '../../hooks/usePlans';
import { Button } from '../ui/Button';
import './ContactForm.scss';

const TRIAL_DAYS = 3;
const money = (n: number) => `${n.toLocaleString('ru-RU')} ₸`;
const dateRu = (d: Date) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(d);

type Status = 'idle' | 'sending' | 'sent' | 'validation-error' | 'consent-error' | 'error' | 'trial-used' | 'limited';

export function ContactForm() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<Status>('idle');
  const plans = usePlans();
  const [form, setForm] = useState<LeadPayload>({
    businessName: '',
    ownerName: '',
    ownerEmail: '',
    phone: '',
    businessType: businessTypes[0] ?? 'Автосервис',
    requestType: params.get('type') === 'demo' ? 'demo' : 'connect',
    plan: params.get('plan') ?? '',
    comment: '',
    consent: false,
  });
  const [result, setResult] = useState<LeadResult | null>(null);
  const [copied, setCopied] = useState(false);

  const update =
    (field: Exclude<keyof LeadPayload, 'consent'>) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const selectedPlan = plans.find((p) => p.id === form.plan.toLowerCase()) ?? plans[0];
  const connecting = form.requestType === 'connect';
  const trialEnd = new Date(Date.now() + TRIAL_DAYS * 86400_000);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const digits = form.phone.replace(/\D/g, '');
    if (!form.businessName.trim() || !form.ownerName.trim() || !form.ownerEmail.trim() || digits.length < 10) {
      setStatus('validation-error');
      return;
    }
    if (!form.consent) {
      setStatus('consent-error');
      return;
    }
    setStatus('sending');
    try {
      setResult(await submitLead(connecting && selectedPlan ? { ...form, plan: selectedPlan.id } : form));
      setStatus('sent');
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setStatus(code === 'trial_already_used' ? 'trial-used' : code === 'rate_limited' ? 'limited' : 'error');
    }
  };

  if (status === 'sent') {
    if (result?.mode === 'accepted') {
      return (
        <div className="contact-form contact-form--success" role="status">
          <h2>{connecting ? 'Заявка на подключение принята' : 'Заявка на демо принята'}</h2>
          <p>
            Проверьте почту {form.ownerEmail}: если для неё можно создать организацию, мы отправили письмо со ссылкой для установки пароля и входа в кабинет.
            Не пришло в течение нескольких минут — загляните в «Спам». Если автоматически подключить не получилось, наша команда свяжется с вами.
          </p>
          {connecting && selectedPlan && <p>Тариф: <b>{selectedPlan.name}</b>. Пробный период — {TRIAL_DAYS} дня, оплата после него по согласованию с менеджером.</p>}
        </div>
      );
    }
    if (result?.mode === 'demo' && result.slug) {
      const bookingUrl = `${window.location.origin}/s/${result.slug}`;
      return (
        <div className="contact-form contact-form--success" role="status">
          <h2>Демо-версия готова</h2>
          <p>
            Мы создали вашу организацию в Servio.{' '}
            {result.inviteSent
              ? `Письмо для установки пароля отправлено на ${form.ownerEmail}. Откройте его, задайте пароль и войдите в кабинет.`
              : 'Письмо с доступом отправить не удалось — наша команда свяжется с вами и поможет войти.'}
          </p>
          <p>Адрес записи для клиентов:</p>
          <p>
            <a href={bookingUrl} target="_blank" rel="noopener noreferrer"><b>{bookingUrl}</b></a>
          </p>
          <div className="contact-form__actions">
            <Button href={`/s/${result.slug}/owner`}>Перейти в кабинет</Button>
            <Button variant="secondary" href={bookingUrl}>Открыть страницу записи</Button>
            <Button
              variant="ghost"
              onClick={() => {
                navigator.clipboard?.writeText(bookingUrl).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? 'Ссылка скопирована ✓' : 'Скопировать ссылку'}
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
          <h2>Servio подключён</h2>
          <p>
            {result.inviteSent
              ? `Письмо для установки пароля отправлено на ${form.ownerEmail}. Откройте его, задайте пароль и войдите в кабинет.`
              : 'Письмо с доступом отправить не удалось — наша команда свяжется с вами и поможет войти.'}
          </p>
          <div className="order-summary" aria-label="Ваш заказ">
            <div className="order-summary__row"><span>Тариф</span><b>{result.planName}</b></div>
            <div className="order-summary__row"><span>Пробный период</span><b>{result.trialDays ?? TRIAL_DAYS} дня, до {dateRu(trialEndsAt)}</b></div>
            <div className="order-summary__row"><span>К оплате сейчас</span><b>0 ₸</b></div>
            {result.priceKzt !== undefined && (
              <div className="order-summary__row order-summary__row--total">
                <span>К оплате после пробного периода</span>
                <b>{money(result.priceKzt)} / {result.periodMonths && result.periodMonths > 1 ? `${result.periodMonths} мес.` : 'мес.'}</b>
              </div>
            )}
          </div>
          <p>С вами свяжутся, чтобы согласовать оплату. Пока идёт пробный период, система работает без ограничений тарифа.</p>
          <p>Адрес записи для клиентов:</p>
          <p><a href={bookingUrl} target="_blank" rel="noopener noreferrer"><b>{bookingUrl}</b></a></p>
          <div className="contact-form__actions">
            <Button href={`/s/${result.slug}/owner`}>Перейти в кабинет</Button>
            <Button variant="secondary" href={bookingUrl}>Открыть страницу записи</Button>
            <Button
              variant="ghost"
              onClick={() => {
                navigator.clipboard?.writeText(bookingUrl).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? 'Ссылка скопирована ✓' : 'Скопировать ссылку'}
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="contact-form contact-form--success" role="status">
        <h2>Заявка отправлена</h2>
        <p>
          {result?.mode === 'lead' && form.requestType === 'connect'
            ? 'Для этой почты или телефона пробный период уже использовался либо аккаунт уже существует, поэтому автоматически подключить не получилось. Мы свяжемся с вами и подключим Servio вручную.'
            : form.requestType === 'demo'
            ? 'Для этой почты уже есть аккаунт, поэтому демо автоматически не создавалось. Мы свяжемся с вами и подключим демонстрацию вручную.'
            : 'Мы свяжемся с вами в ближайшее время, чтобы уточнить детали.'}
        </p>
      </div>
    );
  }

  return (
    <form className="contact-form" onSubmit={handleSubmit} noValidate>
      <div className="contact-form__field">
        <label htmlFor="businessName">Название бизнеса *</label>
        <input id="businessName" name="businessName" autoComplete="organization" value={form.businessName} onChange={update('businessName')} />
      </div>

      <div className="contact-form__field">
        <label htmlFor="ownerName">Имя владельца *</label>
        <input id="ownerName" name="ownerName" autoComplete="name" value={form.ownerName} onChange={update('ownerName')} />
      </div>

      <div className="contact-form__field">
        <label htmlFor="ownerEmail">Почта владельца *</label>
        <input id="ownerEmail" name="ownerEmail" type="email" autoComplete="email" value={form.ownerEmail} onChange={update('ownerEmail')} />
      </div>

      <div className="contact-form__field">
        <label htmlFor="phone">Телефон *</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+7 777 000 00 00"
          value={form.phone}
          onChange={update('phone')}
        />
      </div>

      <div className="contact-form__row">
        <div className="contact-form__field">
          <label htmlFor="requestType">Цель обращения</label>
          <select id="requestType" name="requestType" value={form.requestType} onChange={update('requestType')}>
            <option value="connect">Подключить Servio ({TRIAL_DAYS} дня бесплатно)</option>
            <option value="demo">Демонстрация системы</option>
          </select>
        </div>

        <div className="contact-form__field">
          <label htmlFor="businessType">Тип бизнеса</label>
          <select id="businessType" name="businessType" value={form.businessType} onChange={update('businessType')}>
            {businessTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
      </div>

      {connecting && selectedPlan && (
        <>
          <div className="contact-form__field">
            <label htmlFor="plan">Тариф</label>
            <select id="plan" name="plan" value={selectedPlan.id} onChange={update('plan')}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {money(p.price)} в месяц</option>
              ))}
            </select>
          </div>
          <div className="order-summary" aria-label="Ваш заказ">
            <div className="order-summary__row"><span>Тариф</span><b>{selectedPlan.name}</b></div>
            <div className="order-summary__row"><span>Пробный период</span><b>{TRIAL_DAYS} дня, до {dateRu(trialEnd)}</b></div>
            <div className="order-summary__row"><span>К оплате сегодня</span><b>0 ₸</b></div>
            <div className="order-summary__row order-summary__row--total">
              <span>После пробного периода</span>
              <b>{money(selectedPlan.price)} / мес.</b>
            </div>
            <p className="contact-form__hint">Доступ откроется сразу после отправки. Для оплаты с вами свяжутся — карту вводить не нужно.</p>
          </div>
        </>
      )}

      <div className="contact-form__field">
        <label htmlFor="comment">Комментарий</label>
        <textarea id="comment" name="comment" rows={4} value={form.comment} onChange={update('comment')} />
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
          Я согласен(на) на обработку персональных данных в соответствии с{' '}
          <Link to="/privacy" target="_blank">политикой конфиденциальности</Link>
        </label>
      </div>

      {status !== 'idle' && status !== 'sending' && (
        <p className="contact-form__error" role="alert">
          {status === 'validation-error' && 'Укажите название бизнеса, имя и почту владельца, а также корректный номер телефона.'}
          {status === 'consent-error' && 'Чтобы отправить заявку, подтвердите согласие на обработку персональных данных.'}
          {status === 'trial-used' && 'Для этой почты или телефона демо уже использовалось. Выберите «Подключение к Servio» — мы свяжемся с вами.'}
          {status === 'limited' && 'Слишком много попыток. Попробуйте позже.'}
          {status === 'error' && 'Не удалось отправить заявку. Проверьте подключение и попробуйте ещё раз.'}
        </p>
      )}

      <Button type="submit" fullWidth>
        {status === 'sending'
          ? form.requestType === 'demo' ? 'Создаём демо…' : 'Подключаем…'
          : form.requestType === 'demo' ? 'Запустить демо' : `Подключить${selectedPlan ? ` ${selectedPlan.name}` : ''} и получить доступ`}
      </Button>
      {form.requestType === 'demo' && (
        <p className="contact-form__hint">Демо запускается сразу: мы создадим вашу организацию и отправим письмо для входа.</p>
      )}
    </form>
  );
}

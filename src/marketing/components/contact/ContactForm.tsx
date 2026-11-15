import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { businessTypes } from '../../data/content';
import { submitLead, type LeadPayload, type LeadResult } from '../../services/leads';
import { Button } from '../ui/Button';
import './ContactForm.scss';

type Status = 'idle' | 'sending' | 'sent' | 'validation-error' | 'consent-error' | 'error' | 'trial-used' | 'limited';

export function ContactForm() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<Status>('idle');
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

  const update =
    (field: Exclude<keyof LeadPayload, 'consent'>) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

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
      setResult(await submitLead(form));
      setStatus('sent');
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setStatus(code === 'trial_already_used' ? 'trial-used' : code === 'rate_limited' ? 'limited' : 'error');
    }
  };

  if (status === 'sent') {
    if (result?.mode === 'demo' && result.slug) {
      return (
        <div className="contact-form contact-form--success" role="status">
          <h2>Демо-версия готова</h2>
          <p>
            Мы создали вашу организацию в Servio.{' '}
            {result.inviteSent
              ? `Письмо для установки пароля отправлено на ${form.ownerEmail}. Откройте его, задайте пароль и войдите в кабинет.`
              : 'Письмо с доступом отправить не удалось — наша команда свяжется с вами и поможет войти.'}
          </p>
          <p>
            Адрес записи для клиентов: <b>/s/{result.slug}</b>
          </p>
          <p>
            <a className="btn btn--primary" href={`/s/${result.slug}/owner`}>Перейти в кабинет</a>
          </p>
        </div>
      );
    }
    return (
      <div className="contact-form contact-form--success" role="status">
        <h2>Заявка отправлена</h2>
        <p>
          {form.requestType === 'demo'
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
            <option value="connect">Подключение к Servio</option>
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

      <div className="contact-form__field">
        <label htmlFor="comment">Комментарий</label>
        <textarea id="comment" name="comment" rows={4} value={form.comment} onChange={update('comment')} />
      </div>

      {form.plan && (
        <p className="contact-form__hint">Интересующий тариф: {form.plan.toUpperCase()}</p>
      )}

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
          ? form.requestType === 'demo' ? 'Создаём демо…' : 'Отправляем…'
          : form.requestType === 'demo' ? 'Запустить демо' : 'Отправить заявку'}
      </Button>
      {form.requestType === 'demo' && (
        <p className="contact-form__hint">Демо запускается сразу: мы создадим вашу организацию и отправим письмо для входа.</p>
      )}
    </form>
  );
}

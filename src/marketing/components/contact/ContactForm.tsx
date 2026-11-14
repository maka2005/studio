import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { businessTypes } from '../../data/content';
import { submitLead, type LeadPayload } from '../../services/leads';
import { Button } from '../ui/Button';
import './ContactForm.scss';

type Status = 'idle' | 'sending' | 'sent' | 'validation-error' | 'error';

export function ContactForm() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<Status>('idle');
  const [form, setForm] = useState<LeadPayload>({
    name: '',
    phone: '',
    businessType: businessTypes[0] ?? 'Автосервис',
    requestType: params.get('type') === 'demo' ? 'demo' : 'connect',
    plan: params.get('plan') ?? '',
    comment: '',
  });

  const update =
    (field: keyof LeadPayload) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const digits = form.phone.replace(/\D/g, '');
    if (!form.name.trim() || digits.length < 10) {
      setStatus('validation-error');
      return;
    }
    setStatus('sending');
    try {
      await submitLead(form);
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  };

  if (status === 'sent') {
    return (
      <div className="contact-form contact-form--success" role="status">
        <h2>Заявка отправлена</h2>
        <p>Мы свяжемся с вами в ближайшее время, чтобы уточнить детали.</p>
      </div>
    );
  }

  return (
    <form className="contact-form" onSubmit={handleSubmit} noValidate>
      <div className="contact-form__field">
        <label htmlFor="name">Имя и фамилия *</label>
        <input id="name" name="name" autoComplete="name" value={form.name} onChange={update('name')} />
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

      {(status === 'error' || status === 'validation-error') && (
        <p className="contact-form__error" role="alert">{status === 'validation-error' ? 'Укажите имя и корректный номер телефона.' : 'Не удалось отправить заявку. Проверьте подключение и попробуйте ещё раз.'}</p>
      )}

      <Button type="submit" fullWidth>
        {status === 'sending' ? 'Отправляем…' : 'Отправить заявку'}
      </Button>
    </form>
  );
}

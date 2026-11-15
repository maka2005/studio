import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { isFullPhone, maskPhone, PHONE_PLACEHOLDER } from '../../../lib/phone';
import { useTrialDays } from '../../hooks/usePlans';
import { daysText } from '../../lib/trial';
import { Button } from '../ui/Button';
import './FinalCta.scss';

export function FinalCta() {
  const navigate = useNavigate();
  const trialDays = useTrialDays();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isFullPhone(phone)) {
      setError(true);
      return;
    }
    navigate(`/contact?type=demo&phone=${encodeURIComponent(phone)}`);
  };

  return (
    <section className="final-cta">
      <div className="container final-cta__inner">
        <h2 className="final-cta__title">Готовы навести порядок в записях и расписании?</h2>
        <p className="final-cta__text">
          Оставьте номер — покажем систему на примере вашего сервиса. Или подключитесь сами: {trialDays ? `первые ${daysText(trialDays)} бесплатно` : 'пробный период бесплатно'}.
        </p>

        <form className="final-cta__form" onSubmit={submit} noValidate>
          <label className="visually-hidden" htmlFor="cta-phone">Ваш телефон</label>
          <input
            id="cta-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={18}
            placeholder={PHONE_PLACEHOLDER}
            value={phone}
            aria-invalid={error}
            onChange={(e) => {
              setPhone(maskPhone(e.target.value, phone));
              setError(false);
            }}
          />
          <button type="submit" className="btn btn--primary">Записаться на демо</button>
        </form>
        {error && <p className="final-cta__error" role="alert">Введите номер полностью: {PHONE_PLACEHOLDER}</p>}

        <div className="final-cta__actions">
          <Button variant="secondary" to="/contact">Подключить Renvio</Button>
        </div>
      </div>
    </section>
  );
}

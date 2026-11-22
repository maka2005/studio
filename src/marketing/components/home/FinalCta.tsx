import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { isFullPhone, maskPhone, PHONE_PLACEHOLDER } from '../../../lib/phone';
import { useLocale } from '../../../lib/locale';
import { useTrialDays } from '../../hooks/usePlans';
import { daysText } from '../../lib/trial';
import { Button } from '../ui/Button';
import './FinalCta.scss';

export function FinalCta() {
  const navigate = useNavigate();
  const trialDays = useTrialDays();
  const { locale, t } = useLocale();
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

  const trial = trialDays
    ? t.finalCtaTrialDays.replace(
        '{days}',
        locale === 'kk' ? String(trialDays) : daysText(trialDays),
      )
    : t.finalCtaTrialFree;

  return (
    <section className="final-cta">
      <div className="container final-cta__inner">
        <h2 className="final-cta__title">{t.finalCtaTitle}</h2>
        <p className="final-cta__text">{t.finalCtaText.replace('{trial}', trial)}</p>

        <form className="final-cta__form" onSubmit={submit} noValidate>
          <label className="visually-hidden" htmlFor="cta-phone">
            {t.finalCtaPhoneLabel}
          </label>
          <input
            id="cta-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={18}
            placeholder={PHONE_PLACEHOLDER}
            value={phone}
            aria-invalid={error}
            aria-describedby={error ? 'cta-phone-error' : undefined}
            onChange={(e) => {
              setPhone(maskPhone(e.target.value, phone));
              setError(false);
            }}
          />
          <button type="submit" className="btn btn--primary">
            {t.demoBook}
          </button>
        </form>
        {error && (
          <p className="final-cta__error" id="cta-phone-error" role="alert">
            {t.finalCtaPhoneError.replace('{phone}', PHONE_PLACEHOLDER)}
          </p>
        )}

        <div className="final-cta__actions">
          <Button variant="secondary" to="/contact">
            {t.connect}
          </Button>
        </div>
      </div>
    </section>
  );
}

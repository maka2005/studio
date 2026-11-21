import { useMarketingCopy } from '../../data/copy';
import { SITE } from '../../config/site';
import './ContactInfo.scss';

export function ContactInfo() {
  const copy = useMarketingCopy().ui.contactInfo;
  const { phone, whatsapp, email } = SITE.contacts;
  const telHref = `tel:${phone.replace(/[^+\d]/g, '')}`;
  const waHref = `https://wa.me/${whatsapp.replace(/\D/g, '')}`;
  const hasContacts = Boolean(phone || whatsapp || email);

  return (
    <aside className="contact-info" aria-label={copy.aria}>
      <h2 className="contact-info__title">{copy.title}</h2>
      <ol className="contact-info__steps">
        {copy.steps.map((step) => <li key={step}>{step}</li>)}
      </ol>

      {hasContacts && (
        <dl className="contact-info__list">
          {phone && (
            <div>
              <dt>{copy.phone}</dt>
              <dd><a href={telHref}>{phone}</a></dd>
            </div>
          )}
          {whatsapp && (
            <div>
              <dt>{copy.whatsapp}</dt>
              <dd><a href={waHref} target="_blank" rel="noopener noreferrer">{copy.whatsappLink}</a></dd>
            </div>
          )}
          {email && (
            <div>
              <dt>{copy.email}</dt>
              <dd><a href={`mailto:${email}`}>{email}</a></dd>
            </div>
          )}
        </dl>
      )}

      <p className="contact-info__note">{copy.note}</p>
    </aside>
  );
}

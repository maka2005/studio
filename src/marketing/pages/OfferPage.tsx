import { useMarketingCopy } from '../data/copy';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { SITE, hasLegalPlaceholders } from '../config/site';
import { Section } from '../components/ui/Section';
import './PrivacyPage.scss';

export function OfferPage() {
  const copy = useMarketingCopy();
  useDocumentMeta(copy.seo.offer);
  const offer = copy.ui.offer;
  const { operator, bin, address } = SITE.legal;
  const { email, phone } = SITE.contacts;
  const operatorFull = `${operator || SITE.name}${bin ? `, БИН ${bin}` : ''}${address ? `, ${address}` : ''}`;
  const hasContacts = Boolean(email || phone);

  return (
    <>
      <header className="page-intro">
        <div className="container">
          <h1>{offer.title}</h1>
          <p>{offer.updatedLabel} {offer.updated}</p>
        </div>
      </header>

      <Section>
        <div className="privacy">
          {hasLegalPlaceholders() && <p className="legal-notice">{offer.notice}</p>}
          {offer.sections.map((section) => {
            const body = section.body
              ?.replace('{operator}', operatorFull)
              .replace('{bin}', '')
              .replace('{address}', '')
              .replace('{site}', SITE.url.replace('https://', ''));
            const contacts = body?.includes('{contacts}') ? body.split('{contacts}') : null;
            return (
              <div key={section.title}>
                <h2>{section.title}</h2>
                {section.items ? (
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>
                        {item
                          .replace('{operator}', operatorFull)
                          .replace('{bin}', '')
                          .replace('{address}', '')
                          .replace('{site}', SITE.url.replace('https://', ''))}
                      </li>
                    ))}
                  </ul>
                ) : contacts ? (
                  <p>
                    {contacts[0]}
                    {hasContacts ? offer.contactsPrefix : offer.contactsFallback}
                    {email && <a href={`mailto:${email}`}>{email}</a>}
                    {email && phone ? ', ' : ''}
                    {phone && <a href={`tel:${phone.replace(/[^+\d]/g, '')}`}>{phone}</a>}
                    {hasContacts ? '.' : ''}
                  </p>
                ) : (
                  <p>{body}</p>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}

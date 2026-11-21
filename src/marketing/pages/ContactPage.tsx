import { useMarketingCopy } from '../data/copy';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { ContactForm } from '../components/contact/ContactForm';
import { ContactInfo } from '../components/contact/ContactInfo';
import { Section } from '../components/ui/Section';
import './ContactPage.scss';

export function ContactPage() {
  const copy = useMarketingCopy();
  useDocumentMeta(copy.seo.contact);

  return (
    <>
      <header className="page-intro">
        <div className="container">
          <h1>{copy.ui.contactPage.title}</h1>
          <p>{copy.ui.contactPage.text}</p>
        </div>
      </header>

      <Section>
        <div className="contact-page__grid">
          <ContactForm />
          <ContactInfo />
        </div>
      </Section>
    </>
  );
}

import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { seo } from '../data/content';
import { ContactForm } from '../components/contact/ContactForm';
import { ContactInfo } from '../components/contact/ContactInfo';
import { Section } from '../components/ui/Section';
import './ContactPage.scss';

export function ContactPage() {
  useDocumentMeta(seo.contact);

  return (
    <>
      <header className="page-intro">
        <div className="container">
          <h1>Подключите Servio или запишитесь на демонстрацию</h1>
          <p>Оставьте заявку — мы свяжемся с вами, покажем систему и поможем начать работу.</p>
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

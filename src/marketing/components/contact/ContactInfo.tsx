import { SITE } from '../../config/site';
import './ContactInfo.scss';

export function ContactInfo() {
  const { phone, whatsapp, email } = SITE.contacts;
  const telHref = `tel:${phone.replace(/[^+\d]/g, '')}`;
  const waHref = `https://wa.me/${whatsapp.replace(/\D/g, '')}`;
  const hasContacts = Boolean(phone || whatsapp || email);

  return (
    <aside className="contact-info" aria-label="Контактная информация">
      <h2 className="contact-info__title">Что будет дальше</h2>
      <ol className="contact-info__steps">
        <li>Мы получим вашу заявку и свяжемся по указанному номеру.</li>
        <li>Ответим на вопросы и покажем систему на примере вашего типа сервиса.</li>
        <li>Договоримся о подключении и поможем настроить услуги, цены и сотрудников.</li>
      </ol>

      {hasContacts && (
        <dl className="contact-info__list">
          {phone && (
            <div>
              <dt>Телефон</dt>
              <dd><a href={telHref}>{phone}</a></dd>
            </div>
          )}
          {whatsapp && (
            <div>
              <dt>WhatsApp</dt>
              <dd><a href={waHref} target="_blank" rel="noopener noreferrer">Написать в WhatsApp</a></dd>
            </div>
          )}
          {email && (
            <div>
              <dt>Почта</dt>
              <dd><a href={`mailto:${email}`}>{email}</a></dd>
            </div>
          )}
        </dl>
      )}

      <p className="contact-info__note">Заявка попадает команде Servio. Данные используются только для связи с вами.</p>
    </aside>
  );
}

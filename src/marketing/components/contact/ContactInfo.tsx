import './ContactInfo.scss';

export function ContactInfo() {
  return (
    <aside className="contact-info" aria-label="Контактная информация">
      <h2 className="contact-info__title">Что будет дальше</h2>
      <p className="contact-info__note">Ваша заявка попадёт команде Servio. Мы свяжемся с вами по указанному номеру, ответим на вопросы и договоримся о демонстрации или подключении.</p>
    </aside>
  );
}

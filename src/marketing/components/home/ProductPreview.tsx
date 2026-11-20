import { useLocale } from '../../../lib/locale';
import './ProductPreview.scss';

const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];

const staff = [
  { name: 'Мастер 1', slots: [{ top: 8, h: 26, t: 'Диагностика', c: 'blue' }, { top: 44, h: 34, t: 'Замена масла', c: 'teal' }] },
  { name: 'Мастер 2', slots: [{ top: 20, h: 40, t: 'Полировка кузова', c: 'violet' }, { top: 68, h: 22, t: 'Шиномонтаж', c: 'amber' }] },
  { name: 'Мастер 3', slots: [{ top: 4, h: 30, t: 'Химчистка салона', c: 'teal' }, { top: 48, h: 36, t: 'Керамика', c: 'blue' }] },
];

/** Иллюстрация интерфейса Renvio: календарь, показатели и всплывающие уведомления. Данные вымышленные. */
export function ProductPreview() {
  const { t } = useLocale();
  return (
    <div className="preview" role="img" aria-label="Иллюстрация: календарь записей Renvio с загрузкой мастеров и уведомлением о новой записи">
      <div className="preview__window" aria-hidden="true">
        <div className="preview__bar">
          <span /><span /><span />
          <em>servio.kz · Календарь</em>
        </div>

        <div className="preview__body">
          <aside className="preview__side">
            <b>Renvio</b>
            <i className="is-active">Календарь</i>
            <i>Записи</i>
            <i>{t.services}</i>
            <i>Сотрудники</i>
            <i>Отчёты</i>
          </aside>

          <div className="preview__main">
            <div className="preview__stats">
              <div><small>Записей сегодня</small><b>18</b></div>
              <div><small>Загрузка</small><b>82%</b></div>
              <div><small>Выручка за неделю</small><b>1,2 млн ₸</b></div>
            </div>

            <div className="preview__days">
              {days.map((d, i) => (
                <span key={d} className={i === 2 ? 'is-today' : ''}>{d}</span>
              ))}
            </div>

            <div className="preview__grid">
              {staff.map((s) => (
                <div key={s.name} className="preview__col">
                  <small>{s.name}</small>
                  <div className="preview__track">
                    {s.slots.map((slot) => (
                      <span
                        key={slot.t}
                        className={`preview__slot preview__slot--${slot.c}`}
                        style={{ top: `${slot.top}%`, height: `${slot.h}%` }}
                      >
                        {slot.t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="preview__toast preview__toast--booking" aria-hidden="true">
        <span className="preview__dot" />
        <div><b>Новая онлайн-запись</b><small>Завтра, 14:30 · Детейлинг</small></div>
      </div>
      <div className="preview__toast preview__toast--tg" aria-hidden="true">
        <span className="preview__tg">✈</span>
        <div><b>Напоминание отправлено</b><small>Клиент увидит его в Telegram</small></div>
      </div>
    </div>
  );
}

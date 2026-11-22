import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { call, errText, useLoad, type Row } from './shared';

type Fields = {
  operator: string;
  bin: string;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
};

const EMPTY: Fields = { operator: '', bin: '', address: '', phone: '', whatsapp: '', email: '' };

const STR_FIELD: [keyof Fields, number][] = [
  ['operator', 200],
  ['bin', 12],
  ['address', 250],
  ['phone', 40],
  ['whatsapp', 20],
  ['email', 120],
];

function fromRow(row: Row | null): Fields {
  if (!row) return EMPTY;
  const result = { ...EMPTY };
  for (const [key, max] of STR_FIELD) {
    const value = row[key];
    if (typeof value === 'string') result[key] = value.slice(0, max);
  }
  return result;
}

function validate(f: Fields): string | null {
  if (f.operator.trim().length < 2 || f.operator.trim().length > 200)
    return 'Укажите наименование оператора (от 2 до 200 символов).';
  if (!/^\d{12}$/.test(f.bin.trim())) return 'БИН/ИИН должен содержать ровно 12 цифр.';
  if (f.address.trim().length < 5 || f.address.trim().length > 250)
    return 'Укажите юридический адрес (от 5 до 250 символов).';
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()))
    return 'Проверьте email для обращений.';
  return null;
}

/** Реквизиты оператора платформы для публичных /offer и /privacy. */
export function PlatformLegal() {
  const { data, err, loading, reload } = useLoad<Row>('platform_legal_get');
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [msg, setMsg] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setFields(fromRow(data));
  }, [data]);

  const set = (key: keyof Fields) => (e: ChangeEvent<HTMLInputElement>) => {
    setFields((f) => ({ ...f, [key]: e.target.value }));
    setSaved(false);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMsg('');
    setSaved(false);
    const error = validate(fields);
    if (error) {
      setMsg(error);
      return;
    }
    try {
      await call('platform_legal_save', {
        legal: {
          operator: fields.operator.trim(),
          bin: fields.bin.trim(),
          address: fields.address.trim(),
          phone: fields.phone.trim(),
          whatsapp: fields.whatsapp.replace(/\D/g, ''),
          email: fields.email.trim(),
        },
      });
      setSaved(true);
      await reload();
    } catch (e) {
      setMsg(errText(e));
    }
  };

  return (
    <div className="col">
      <div className="admin-subheading">
        <div>
          <h2>Реквизиты платформы</h2>
          <p className="muted small">
            Эти данные подставляются в публичную оферту и политику конфиденциальности Renvio.
          </p>
        </div>
      </div>

      <form className="card col pf-form" onSubmit={(e) => void save(e)}>
        <label className="pf-label">
          Оператор (ТОО, ИП или ФИО)
          <input
            className="field"
            required
            maxLength={200}
            placeholder="ТОО «Название»"
            value={fields.operator}
            onChange={set('operator')}
          />
        </label>
        <label className="pf-label">
          БИН / ИИН (12 цифр)
          <input
            className="field"
            required
            inputMode="numeric"
            maxLength={12}
            placeholder="123456789012"
            value={fields.bin}
            onChange={set('bin')}
          />
        </label>
        <label className="pf-label">
          Юридический адрес
          <input
            className="field"
            required
            maxLength={250}
            placeholder="г. Алматы, ул. ..., ..."
            value={fields.address}
            onChange={set('address')}
          />
        </label>
        <label className="pf-label">
          Email для обращений
          <input
            className="field"
            type="email"
            maxLength={120}
            placeholder="hello@example.kz"
            value={fields.email}
            onChange={set('email')}
          />
        </label>
        <div className="row wrap">
          <label className="pf-label">
            Телефон
            <input
              className="field"
              maxLength={40}
              placeholder="+7 777 000 00 00"
              value={fields.phone}
              onChange={set('phone')}
            />
          </label>
          <label className="pf-label">
            WhatsApp (цифры)
            <input
              className="field"
              inputMode="numeric"
              maxLength={20}
              placeholder="77770000000"
              value={fields.whatsapp}
              onChange={set('whatsapp')}
            />
          </label>
        </div>

        <button className="btn" type="submit">
          Сохранить реквизиты
        </button>
        {msg && <p className="err" role="alert">{msg}</p>}
        {saved && (
          <p className="muted small" role="status">
            Сохранено. Публичные страницы /offer и /privacy покажут новые реквизиты после обновления
            данных; предупреждение о заполнителях скроется автоматически.
          </p>
        )}
      </form>

      <section className="card col">
        <b>Публичные страницы</b>
        <p className="muted small">
          Проверить результат можно на страницах оферты и конфиденциальности. Контакты также
          появятся в подвале сайта и на странице «Контакты».
        </p>
        <div className="row wrap">
          <a href="/offer" target="_blank" rel="noreferrer">Публичная оферта →</a>
          <a href="/privacy" target="_blank" rel="noreferrer">Политика конфиденциальности →</a>
        </div>
      </section>

      {err && <p className="err" role="alert">{err}</p>}
      {loading && !data && <p className="muted small">Загружаем реквизиты…</p>}
    </div>
  );
}

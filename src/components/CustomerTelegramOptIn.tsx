import { useState } from 'react';
import { Link } from 'react-router-dom';
import { createCustomerTelegramLink } from '../lib/api';

const BOT = (import.meta.env.VITE_TELEGRAM_BOT as string | undefined)?.trim().replace(/^@/, '');

export function CustomerTelegramOptIn({ slug, token }: { slug: string; token: string }) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const botReady = !!BOT && /^[A-Za-z0-9_]{5,32}$/.test(BOT);

  const connect = async () => {
    if (!consent || busy || !botReady || !BOT) return;
    setBusy(true); setMessage(null);
    try {
      const code = await createCustomerTelegramLink(token);
      if (!code) setMessage('Уведомления по этой записи уже подключены. Чтобы сменить чат, сначала отправьте боту команду /stop.');
      else setUrl(`https://t.me/${BOT}?start=${code}`);
    } catch (error) {
      const m = String((error as Error)?.message ?? error);
      setMessage(m.includes('rate_limited') ? 'Слишком много попыток. Подождите немного и попробуйте снова.'
      : m.includes('booking_unavailable') ? 'Подключить уведомления можно только для будущей подтверждённой записи.'
        : m.includes('feature_disabled') ? 'Уведомления Telegram сейчас выключены в настройках студии.'
        : 'Не удалось подготовить ссылку. Попробуйте ещё раз.');
    } finally { setBusy(false); }
  };

  return <div className="card col customer-telegram-opt-in">
    <b>Получать напоминания в Telegram?</b>
    <p className="muted small">Без регистрации на сайте. Бот подтвердит запись и напомнит о визите за сутки.</p>
    <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
      <span className="small">Согласен(на) получать сообщения по этой записи. Telegram получит идентификатор чата и данные записи. Отказаться можно командой /stop. <Link to={`/s/${slug}/legal/privacy`} target="_blank" rel="noreferrer">Подробнее</Link>.</span></label>
    {!url ? <button className="btn ghost" disabled={!consent || busy || !botReady} onClick={() => void connect()}>
      {busy ? 'Готовим ссылку…' : 'Подключить Telegram'}
    </button> : <>
      <a className="btn" href={url} target="_blank" rel="noreferrer">Открыть Telegram</a>
      <p className="muted small" role="status">В чате с ботом нажмите «Запустить», чтобы завершить подключение.</p>
    </>}
    {!botReady && <p className="muted small">Подключение Telegram сейчас недоступно.</p>}
    {message && <p className="muted small" role="status">{message}</p>}
  </div>;
}

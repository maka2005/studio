import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createCustomerTelegramLink, getCustomerTelegramStatus } from '../lib/api';

const BOT = (import.meta.env.VITE_TELEGRAM_BOT as string | undefined)?.trim().replace(/^@/, '');

export function CustomerTelegramOptIn({ slug, token }: { slug: string; token: string }) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const botReady = !!BOT && /^[A-Za-z0-9_]{5,32}$/.test(BOT);

  useEffect(() => {
    let active = true;
    let attempts = 0;
    let timer: number | undefined;
    const check = async () => {
      try {
        if (await getCustomerTelegramStatus(token)) {
          if (active) { setConnected(true); setWaiting(false); }
          if (timer) window.clearInterval(timer);
          return;
        }
      } catch { /* Keep the opt-in usable if the status check is temporarily unavailable. */ }
      attempts++;
      if (attempts >= 40 && timer) { window.clearInterval(timer); if (active) setWaiting(false); }
    };
    void check();
    if (url && !connected) timer = window.setInterval(() => void check(), 3000);
    return () => { active = false; if (timer) window.clearInterval(timer); };
  }, [token, url, connected]);

  const connect = async () => {
    if (!consent || busy || !botReady || !BOT) return;
    setBusy(true); setMessage(null);
    try {
      const code = await createCustomerTelegramLink(token);
      if (!code) { setConnected(true); setMessage(null); }
      else { setUrl(`https://t.me/${BOT}?start=${code}`); setWaiting(true); }
    } catch (error) {
      const m = String((error as Error)?.message ?? error);
      setMessage(m.includes('rate_limited') ? 'Слишком много попыток. Подождите немного и попробуйте снова.'
      : m.includes('booking_unavailable') ? 'Подключить уведомления можно только для будущей подтверждённой записи.'
        : m.includes('feature_disabled') ? 'Уведомления Telegram сейчас выключены в настройках студии.'
        : 'Не удалось подготовить ссылку. Попробуйте ещё раз.');
    } finally { setBusy(false); }
  };

  return <div className="card col customer-telegram-opt-in">
    {connected ? <>
      <b role="status">✅ Telegram подключён</b>
      <p className="muted small">Готово! Бот пришлёт подтверждение записи, напомнит о визите за сутки и сообщит, если запись отменится. Отключить сообщения можно командой /stop в боте.</p>
    </> : <>
    <b>Получать напоминания в Telegram?</b>
    <p className="muted small">Без регистрации на сайте. Бот подтвердит запись и напомнит о визите за сутки.</p>
    <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
      <span className="small">Согласен(на) получать сообщения по этой записи. Telegram получит идентификатор чата и данные записи. Отказаться можно командой /stop. <Link to={`/s/${slug}/legal/privacy`} target="_blank" rel="noreferrer">Подробнее</Link>.</span></label>
    {!url ? <button className="btn ghost" disabled={!consent || busy || !botReady} onClick={() => void connect()}>
      {busy ? 'Готовим ссылку…' : 'Подключить Telegram'}
    </button> : <>
      <a className="btn" href={url} target="_blank" rel="noreferrer">Открыть Telegram</a>
      <p className="muted small" role="status">{waiting ? 'Нажмите «Запустить» в Telegram. После этого здесь появится подтверждение подключения.' : 'Подключение не завершено. Откройте бота и нажмите «Запустить».'}</p>
    </>}
    {!botReady && <p className="muted small">Подключение Telegram сейчас недоступно.</p>}
    {message && <p className="muted small" role="status">{message}</p>}
    </>}
  </div>;
}

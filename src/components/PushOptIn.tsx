import { useEffect, useState } from 'react';
import { subscribePush, type PushKind } from '../lib/api';
import { Bell } from '../lib/icons';
import { clientErrText, useClientMessages } from '../lib/clientLocale';
import { sameApplicationServerKey, unsupportedNotice } from '../lib/pushSupport';

const VAPID = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim();

/** serviceWorker.ready висит, если регистрация не удалась — не держим кнопку в «подключаем…» вечно. */
function serviceWorkerReady(): Promise<ServiceWorkerRegistration> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('request_failed')), 8000);
    void navigator.serviceWorker.ready.then(
      (registration) => { window.clearTimeout(timer); resolve(registration); },
      (error: unknown) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

function urlBase64ToUint8Array(key: string): Uint8Array {
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded);
  const result = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) result[i] = raw.charCodeAt(i);
  return result;
}

/** Один раз за загрузку страницы восстанавливаем подписку, потерянную на сервере. */
const restored = new Set<string>();

/** Подписка на push-напоминания по приватному токену записи или заявки. */
export function PushOptIn({ token, kind, compact = false, onNotice }: {
  token: string; kind: PushKind; compact?: boolean; onNotice?: (text: string) => void;
}) {
  const { m } = useClientMessages();
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const supported = typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && !!VAPID;
  const unsupportedText = unsupportedNotice(
    m.push,
    typeof navigator === 'undefined' ? '' : navigator.userAgent,
    typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1,
  );

  // Возвращающийся клиент уже подписан: не показывает повторное «подключить»,
  // но и не прячет кнопку «Напомнить».
  useEffect(() => {
    if (!compact || !supported || !token) return;
    let alive = true;
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then(async (subscription) => {
        // После ротации VAPID браузер может хранить старую подписку: она
        // бесполезна, поэтому не помечаем кнопку как «включено».
        if (!alive || !subscription || !sameApplicationServerKey(
          subscription.options.applicationServerKey,
          urlBase64ToUint8Array(VAPID!),
        )) return;
        setStatus('done');
        // Браузер помнит подписку, а сервер мог потерять её (например, при
        // ротации ключей). Тихо регистрируем её заново без нажатия кнопки.
        if (restored.has(token)) return;
        restored.add(token);
        try { await subscribePush(token, kind, subscription.toJSON()); } catch { /* повторит клик */ }
      })
      .catch(() => { /* без подписки показываем обычную кнопку */ });
    return () => { alive = false; };
  }, [compact, supported, token, kind]);

  if (!token) return null;

  const notice = (text: string) => { setError(text); onNotice?.(text); };

  const enable = async () => {
    if (status === 'busy') return;
    setStatus('busy');
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        notice(m.push.denied);
        setStatus('error');
        return;
      }
      const registration = await serviceWorkerReady();
      const key = urlBase64ToUint8Array(VAPID!);
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !sameApplicationServerKey(subscription.options.applicationServerKey, key)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key as BufferSource,
        });
      }
      await subscribePush(token, kind, subscription.toJSON());
      setStatus('done');
      if (compact) notice(m.push.enabled);
    } catch (e) {
      const text = clientErrText(e, m.errors);
      const message = text === m.errors.default ? m.push.error : text;
      notice(message);
      setStatus('error');
    }
  };

  // Компактная кнопка заменила скачивание .ics в «Моей записи». Она остаётся
  // видимой и после подписки, но больше не скачивает файл вместо push: при
  // недоступности уведомлений показывается явная причина.
  if (compact) return (
    <button className="act" disabled={status === 'busy'}
      title={status === 'done' ? m.push.enabled : error ?? unsupportedText}
      onClick={() => {
        if (!supported) { notice(unsupportedText); return; }
        if (Notification.permission === 'denied') { notice(m.push.denied); return; }
        // Повторный клик должен восстановить подписку на сервере и обновить
        // ключ, даже если браузер считает, что подписка уже активна.
        void enable();
      }}>
      <span className="ico"><Bell size={16} /></span>{status === 'busy' ? m.push.enabling : m.my.remind}
    </button>
  );

  if (!supported) return null;

  return (
    <div className="card col">
      <b>{m.push.title}</b>
      {status === 'done' ? (
        <p className="note" role="status">
          {m.push.enabled}
        </p>
      ) : (
        <button className="btn ghost" disabled={status === 'busy' || Notification.permission === 'denied'} onClick={() => void enable()}>
          {status === 'busy' ? m.push.enabling : m.push.enable}
        </button>
      )}
      {(error || Notification.permission === 'denied') && (
        <p className="muted small" role="status">
          {error ?? m.push.denied}
        </p>
      )}
      <p className="muted small">{m.push.beta}</p>
    </div>
  );
}

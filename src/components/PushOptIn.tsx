import { useState } from 'react';
import { subscribePush, type PushKind } from '../lib/api';
import { Bell } from '../lib/icons';
import { clientErrText, useClientMessages } from '../lib/clientLocale';

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

/** Подписка на push-напоминания по приватному токену записи или заявки. */
export function PushOptIn({ token, kind, compact = false }: { token: string; kind: PushKind; compact?: boolean }) {
  const { m } = useClientMessages();
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const supported = typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && !!VAPID;
  if (!supported || !token) return null;

  const enable = async () => {
    if (status === 'busy') return;
    setStatus('busy');
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setError(m.push.denied);
        setStatus('error');
        return;
      }
      const registration = await serviceWorkerReady();
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID!) as BufferSource,
      });
      await subscribePush(token, kind, subscription.toJSON());
      setStatus('done');
    } catch (e) {
      const text = clientErrText(e, m.errors);
      setError(text === m.errors.default ? m.push.error : text);
      setStatus('error');
    }
  };

  // Compact form replaces the old "remind me" .ics download button in "Моя запись".
  if (compact) return status === 'done' ? (
    <span className="act done" role="status" title={m.push.enabled}>
      <span className="ico"><Bell size={16} /></span>{m.push.enabled}
    </span>
  ) : (
    <button className="act" disabled={status === 'busy' || Notification.permission === 'denied'}
      title={error ?? m.push.title} onClick={() => void enable()}>
      <span className="ico"><Bell size={16} /></span>{status === 'busy' ? m.push.enabling : m.my.remind}
    </button>
  );

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
    </div>
  );
}

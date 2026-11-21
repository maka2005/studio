import type { ClientMessages } from './clientLocale';

/**
 * WebKit поддерживает Web Push не везде: на iOS/iPadOS только у web app,
 * добавленной «На главный экран» (16.4+), на macOS — в Safari 16.4+ и у
 * приложения в Dock (Safari 17+). Обычная вкладка Mobile Safari push не
 * поддерживает, поэтому к общему сообщению добавляем конкретную инструкцию.
 */
/** Подписка, созданная с другим VAPID-ключом, не сможет получать push после ротации ключей. */
export function sameApplicationServerKey(
  subscriptionKey: BufferSource | null | undefined,
  expected: Uint8Array,
): boolean {
  if (!subscriptionKey) return false;
  const bytes = subscriptionKey instanceof Uint8Array
    ? subscriptionKey
    : new Uint8Array(subscriptionKey as ArrayBuffer);
  return bytes.length === expected.length && bytes.every((byte, i) => byte === expected[i]);
}

export function unsupportedNotice(
  push: ClientMessages['push'],
  userAgent: string,
  touchMac = false,
): string {
  const ios = /iPad|iPhone|iPod/.test(userAgent) || touchMac;
  if (ios) return `${push.unsupported} ${push.safariIos}`;

  const safari = /Safari/.test(userAgent)
    && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|OPR|Android/.test(userAgent);
  return safari ? `${push.unsupported} ${push.safariMac}` : push.unsupported;
}

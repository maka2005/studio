import { useEffect, useState } from 'react';
import { SITE } from '../config/site';

export interface PlatformLegal {
  legal: { operator: string; bin: string; address: string };
  contacts: { phone: string; whatsapp: string; email: string };
}

const FALLBACK: PlatformLegal = { legal: SITE.legal, contacts: SITE.contacts };

const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

function toInfo(json: unknown): PlatformLegal | null {
  const root = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
  const legal = root?.legal && typeof root.legal === 'object' ? (root.legal as Record<string, unknown>) : null;
  const contacts = root?.contacts && typeof root.contacts === 'object' ? (root.contacts as Record<string, unknown>) : null;
  if (!legal || !contacts) return null;
  // Пустые поля из базы не перебивают запасные значения: пока реквизиты не заполнены,
  // на юридических страницах остаётся предупреждение о заполнителях.
  return {
    legal: {
      operator: str(legal.operator, 200) || FALLBACK.legal.operator,
      bin: str(legal.bin, 12) || FALLBACK.legal.bin,
      address: str(legal.address, 250) || FALLBACK.legal.address,
    },
    contacts: {
      phone: str(contacts.phone, 40) || FALLBACK.contacts.phone,
      whatsapp: str(contacts.whatsapp, 20) || FALLBACK.contacts.whatsapp,
      email: str(contacts.email, 120) || FALLBACK.contacts.email,
    },
  };
}

let cache: PlatformLegal | null = null;
let pending: Promise<PlatformLegal> | null = null;

/** Один запрос на всех: реквизиты из админки, при ошибке остаются значения из SITE. */
function loadInfo(): Promise<PlatformLegal> {
  if (cache) return Promise.resolve(cache);
  pending ??= fetch('/api/platform?action=legal')
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      const info = toInfo(json);
      if (info) cache = info;
      return info ?? FALLBACK;
    })
    .catch(() => FALLBACK)
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Реквизиты платформы: задаются в админке, до загрузки — запасные значения из кода. */
export function usePlatformLegal(): PlatformLegal {
  const [info, setInfo] = useState<PlatformLegal>(cache ?? FALLBACK);

  useEffect(() => {
    if (cache) return;
    let alive = true;
    void loadInfo().then((next) => {
      if (alive) setInfo(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  return info;
}

/** Пока хоть одно поле оператора — заполнитель вида [...], на юрстраницах висит предупреждение. */
export function hasPlaceholders(legal: PlatformLegal['legal']): boolean {
  return Object.values(legal).some((value) => /\[[^\]]+\]/.test(value));
}

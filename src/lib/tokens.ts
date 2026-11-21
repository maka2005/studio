// Секретные токены записей и заявок этого устройства. Храним списки, а не только
// последний токен: «Моя запись» показывает все записи визита и все заявки.
const listKey = (slug: string) => `bookings:${slug}`;
const waitlistKey = (slug: string) => `waitlist:${slug}`;

function readList(key: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

export function allTokens(slug: string): string[] {
  const arr = readList(listKey(slug));
  try {
    const last = localStorage.getItem(`booking:${slug}`);
    if (last && !arr.includes(last)) arr.push(last);
  } catch { /* приватный режим */ }
  return arr;
}
export function saveToken(slug: string, token: string) {
  try {
    const arr = allTokens(slug); if (!arr.includes(token)) arr.push(token);
    localStorage.setItem(listKey(slug), JSON.stringify(arr.slice(-20)));
    localStorage.setItem(`booking:${slug}`, token);
  } catch { /* приватный режим */ }
}

export function allWaitlistTokens(slug: string): string[] {
  return readList(waitlistKey(slug));
}
export function saveWaitlistToken(slug: string, token: string) {
  try {
    const arr = allWaitlistTokens(slug); if (!arr.includes(token)) arr.push(token);
    localStorage.setItem(waitlistKey(slug), JSON.stringify(arr.slice(-20)));
  } catch { /* приватный режим */ }
}

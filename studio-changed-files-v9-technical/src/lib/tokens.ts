// Секретные токены записей этого устройства. Храним список, а не только последний, чтобы профиль мог привязать все записи.
const listKey = (slug: string) => `bookings:${slug}`;
export function allTokens(slug: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(listKey(slug)) ?? '[]');
    const arr = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    const last = localStorage.getItem(`booking:${slug}`);
    if (last && !arr.includes(last)) arr.push(last);
    return arr;
  } catch { return []; }
}
export function saveToken(slug: string, token: string) {
  try {
    const arr = allTokens(slug); if (!arr.includes(token)) arr.push(token);
    localStorage.setItem(listKey(slug), JSON.stringify(arr.slice(-20)));
    localStorage.setItem(`booking:${slug}`, token);
  } catch { /* приватный режим */ }
}

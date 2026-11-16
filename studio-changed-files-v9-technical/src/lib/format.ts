export const duration = (m: number): string =>
  m >= 1440 ? (m % 1440 === 0 ? `${m / 1440} д` : `${Math.floor(m / 1440)} д ${duration(m % 1440)}`)
  : m < 60 ? `${m} мин` : m % 60 === 0 ? `${m / 60} ч` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
export const telHref = (p: string) => `tel:${p.replace(/[^\d+]/g, '')}`;   // пробелы и скобки в ссылке мешают набору
export const money = (n: number, cur: string) => `${n.toLocaleString('ru-RU')} ${cur}`;
export const plural = (n: number, f: [string, string, string]) => {
  const a = n % 10, b = n % 100;
  return `${n} ${a === 1 && b !== 11 ? f[0] : a >= 2 && a <= 4 && (b < 12 || b > 14) ? f[1] : f[2]}`;
};
export const randomToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, '0')).join('');

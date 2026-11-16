// Маска телефона: +7 (777) 123-45-67. Один формат для всего сайта.
const nationalDigits = (value: string): string => {
  const d = value.replace(/\D/g, '');
  if (d.length === 10 && !value.trim().startsWith('+')) return d;   // вставили 10 цифр без кода страны
  return (d[0] === '7' || d[0] === '8' ? d.slice(1) : d).slice(0, 10);
};

const build = (n: string): string => {
  if (!n) return '+7';
  let out = '+7 (' + n.slice(0, 3);
  if (n.length >= 3) out += ')';
  if (n.length > 3) out += ' ' + n.slice(3, 6);
  if (n.length > 6) out += '-' + n.slice(6, 8);
  if (n.length > 8) out += '-' + n.slice(8, 10);
  return out;
};

/** value — новое значение поля, prev — прежнее (нужно, чтобы Backspace удалял цифру, а не символ маски). */
export function maskPhone(value: string, prev = ''): string {
  if (!value.replace(/\D/g, '')) return '';
  let n = nationalDigits(value);
  if (value.length < prev.length && n === nationalDigits(prev)) n = n.slice(0, -1);
  return build(n);
}

export const phoneDigitsCount = (value: string): number => value.replace(/\D/g, '').length;
/** Полный номер: +7 и 10 цифр. */
export const isFullPhone = (value: string): boolean => phoneDigitsCount(value) === 11;
export const PHONE_PLACEHOLDER = '+7 (777) 123-45-67';

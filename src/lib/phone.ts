// Международный ввод: сохраняем '+', цифры, пробелы, скобки и дефисы, не навязывая код страны.
const MAX_DIGITS = 15;
const MAX_LENGTH = 24;
const ALLOWED = /[^\d+()\-\s]/g;

const nationalMask = (digits: string): string => {
  const n = digits.length === 11 && (digits[0] === '7' || digits[0] === '8') ? digits.slice(1) : digits;
  return `+7 (${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6, 8)}-${n.slice(8, 10)}`;
};

/** value — новое значение поля, prev — прежнее. Цифры и разделители пользователя сохраняются. */
export function maskPhone(value: string, prev = ''): string {
  const cleaned = value.replace(ALLOWED, '');
  const digits = cleaned.replace(/\D/g, '').slice(0, MAX_DIGITS);
  if (!digits) return cleaned.includes('+') ? '+' : '';
  // Быстрый ввод одними цифрами: оставляем привычную локальную маску.
  if (/^\d+$/.test(value.trim())) {
    if ((digits.length === 10 || digits.length === 11) && (digits[0] === '7' || digits[0] === '8' || digits.length === 10)) {
      const masked = nationalMask(digits);
      if (value.length < prev.length && prev.replace(/\D/g, '') === digits) return masked.slice(0, -1);
      return masked;
    }
    return `+${digits}`;
  }
  let out = '';
  let count = 0;
  let plus = false;
  for (const ch of cleaned) {
    if (out.length >= MAX_LENGTH) break;
    if (ch === '+') {
      if (plus) continue;
      plus = true;
    } else if (/\d/.test(ch)) {
      if (count >= MAX_DIGITS) continue;
      count++;
    }
    out += ch;
  }
  return out;
}

export const phoneDigitsCount = (value: string): number => value.replace(/\D/g, '').length;
/** Полный международный номер: от 10 до 15 цифр. */
export const isFullPhone = (value: string): boolean => {
  const count = phoneDigitsCount(value);
  return count >= 10 && count <= 15;
};
export const PHONE_PLACEHOLDER = '+7 777 123 45 67';

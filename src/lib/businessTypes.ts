/**
 * Типы бизнеса: человекочитаемое название (для формы и заявок) и стабильный код (config.business_type организации).
 * Тот же словарь продублирован в supabase/functions/platform-admin/index.ts (businessTypeCode): при изменении правьте оба места.
 */
export const BUSINESS_TYPES = [
  { code: 'autoservice', label: 'СТО / автосервис' },
  { code: 'detailing', label: 'Детейлинг-студия' },
  { code: 'carwash', label: 'Автомойка' },
  { code: 'tires', label: 'Шиномонтаж' },
  { code: 'barbershop', label: 'Барбершоп' },
  { code: 'beauty', label: 'Салон красоты' },
  { code: 'other', label: 'Другое' },
] as const;

export type BusinessTypeCode = (typeof BUSINESS_TYPES)[number]['code'];

const AUTO_CODES: readonly BusinessTypeCode[] = ['autoservice', 'detailing', 'carwash', 'tires'];

/** Авто-категории видят поле «Автомобиль», остальные — нейтральное «Пожелания». */
export function isAutoBusiness(type?: string | null): boolean {
  return !type || AUTO_CODES.includes(type as BusinessTypeCode);
}

/** Подпись и запасное значение для дополнительного поля записи. */
export function extraField(type?: string | null) {
  return isAutoBusiness(type)
    ? { label: 'Автомобиль', placeholder: 'Например, Toyota Camry', empty: '', error: 'Проверьте автомобиль.' }
    : { label: 'Пожелания', placeholder: 'Например, мастер или пожелания', empty: 'Без пожеланий', error: 'Проверьте пожелания.' };
}

/** Название из заявки (или уже готовый код) → код. Неизвестное значение считается «other». */
export function businessTypeCode(value: string): BusinessTypeCode {
  const v = value.trim().toLowerCase();
  const hit = BUSINESS_TYPES.find((t) => t.label.toLowerCase() === v || t.code === v);
  return hit ? hit.code : 'other';
}

import type { Svc } from './api';
import { isAutoBusiness } from './businessTypes';
import type { Locale } from './locale';

export const SERVICE_CATEGORIES = ['Салон', 'Мойка', 'Полировка', 'Защита кузова', 'Кузовной ремонт', 'Колёса', 'Другое'] as const;
export const SERVICE_CATEGORIES_OTHER = ['Стрижка', 'Окрашивание', 'Укладка', 'Массаж', 'Маникюр', 'Педикюр', 'Уход', 'Другое'] as const;
export const ALL_SERVICES_CATEGORY = 'Все услуги';
export const ALL_SERVICES_CATEGORY_KK = 'Барлық қызметтер';

const CATEGORY_KK: Record<string, string> = {
  салон: 'Салон',
  мойка: 'Жуу',
  полировка: 'Жылтырату',
  'защита кузова': 'Кузовды қорғау',
  'кузовной ремонт': 'Кузов жөндеу',
  колёса: 'Дөңгелектер',
  колеса: 'Дөңгелектер',
  другое: 'Басқа',
  стрижка: 'Шаш қырқу',
  окрашивание: 'Бояу',
  укладка: 'Сәндеу',
  массаж: 'Массаж',
  маникюр: 'Маникюр',
  педикюр: 'Педикюр',
  уход: 'Күтім',
  'все услуги': ALL_SERVICES_CATEGORY_KK,
};

/** Категории услуг зависят от типа бизнеса организации. */
export function serviceCategoriesFor(type?: string | null, locale?: Locale): readonly string[] {
  const list = isAutoBusiness(type) ? SERVICE_CATEGORIES : SERVICE_CATEGORIES_OTHER;
  return locale === 'kk' ? list.map((c) => localizeCategory(c, locale)) : list;
}
const normalize = (value: string) => value.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');

/** Необязательный locale сохраняет совместимость с существующими вызовами (RU по умолчанию). */
export function localizeCategory(category: string, locale?: Locale): string {
  const key = normalize(category);
  return locale === 'kk' ? CATEGORY_KK[key] ?? category : category;
}
export const allServicesCategory = (locale?: Locale): string =>
  locale === 'kk' ? ALL_SERVICES_CATEGORY_KK : ALL_SERVICES_CATEGORY;

export function serviceCategories(services: Pick<Svc, 'category'>[], locale?: Locale) {
  const categories = new Map<string, string>();
  for (const service of services) {
    const label = service.category?.trim();
    if (label && !categories.has(normalize(label))) categories.set(normalize(label), localizeCategory(label, locale));
  }
  return [...categories.values()].sort((a, b) => a.localeCompare(b, locale === 'kk' ? 'kk' : 'ru'));
}

export function filterServices<T extends Pick<Svc, 'name' | 'category'>>(
  services: T[], query: string, category: string, locale?: Locale,
) {
  const needle = normalize(query);
  const all = category === ALL_SERVICES_CATEGORY || category === ALL_SERVICES_CATEGORY_KK;
  return services.filter((service) => {
    const label = localizeCategory(service.category ?? '', locale);
    const categoryMatch = all || normalize(label) === normalize(category);
    const searchable = normalize(`${service.name} ${service.category ?? ''} ${label}`);
    return categoryMatch && (!needle || searchable.includes(needle));
  });
}

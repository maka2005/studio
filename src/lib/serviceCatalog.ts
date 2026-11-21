import type { Svc } from './api';
import { isAutoBusiness } from './businessTypes';

export const SERVICE_CATEGORIES = ['Салон', 'Мойка', 'Полировка', 'Защита кузова', 'Кузовной ремонт', 'Колёса', 'Другое'] as const;
export const SERVICE_CATEGORIES_OTHER = ['Стрижка', 'Окрашивание', 'Укладка', 'Массаж', 'Маникюр', 'Педикюр', 'Уход', 'Другое'] as const;
export const ALL_SERVICES_CATEGORY = 'Все услуги';

/** Категории услуг зависят от типа бизнеса организации. */
export function serviceCategoriesFor(type?: string | null): readonly string[] {
  return isAutoBusiness(type) ? SERVICE_CATEGORIES : SERVICE_CATEGORIES_OTHER;
}
const normalize = (value: string) => value.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');

export function serviceCategories(services: Pick<Svc, 'category'>[]) {
  const categories = new Map<string, string>();
  for (const service of services) {
    const label = service.category?.trim();
    if (label && !categories.has(normalize(label))) categories.set(normalize(label), label);
  }
  return [...categories.values()].sort((a, b) => a.localeCompare(b, 'ru'));
}

export function filterServices<T extends Pick<Svc, 'name' | 'category'>>(
  services: T[], query: string, category: string,
) {
  const needle = normalize(query);
  return services.filter((service) => {
    const categoryMatch = category === ALL_SERVICES_CATEGORY || normalize(service.category ?? '') === normalize(category);
    const searchable = normalize(`${service.name} ${service.category ?? ''}`);
    return categoryMatch && (!needle || searchable.includes(needle));
  });
}

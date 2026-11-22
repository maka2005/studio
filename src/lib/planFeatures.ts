/** Ключи feature_access задаются тарифной миграцией; показываем их по-человечески. */
export const PLAN_FEATURE_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  export: 'Выгрузка данных',
  reviews: 'Отзывы',
};

export const planFeatureLabel = (key: string): string => PLAN_FEATURE_LABELS[key] ?? key;

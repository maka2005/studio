/** «1 день», «3 дня», «14 дней» — склонение по правилам русского языка. */
export function daysText(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? 'день' : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? 'дня' : 'дней';
  return `${n} ${word}`;
}

/** Срок пробного периода приходит из базы (platform_settings.trial_days). Пока он не загружен (null), число не показываем. */
export const trialFreeText = (days: number | null): string => (days ? `${daysText(days)} бесплатно` : 'Бесплатный пробный период');

export function trialSummary(days: number | null, end: Date | null): string {
  const fmt = (d: Date) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(d);
  return [days ? daysText(days) : null, end ? `до ${fmt(end)}` : null].filter(Boolean).join(', ') || 'бесплатно';
}

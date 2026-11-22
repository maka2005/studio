/** Единый набор векторных иконок для маркетингового сайта (без эмодзи). */
export const iconNames = [
  'calendar',
  'bell',
  'hourglass',
  'star',
  'tag',
  'chart',
  'building',
  'lock',
  'box',
  'wrench',
  'sparkles',
  'droplet',
  'tire',
] as const;

export type IconName = (typeof iconNames)[number];

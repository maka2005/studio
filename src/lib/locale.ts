import { useEffect, useSyncExternalStore } from 'react';

/** Поддерживаемые языки маркетинговой части сайта. */
export type Locale = 'ru' | 'kk';

export const LOCALE_STORAGE_KEY = 'studio-locale';
export const DEFAULT_LOCALE: Locale = 'ru';

/** Ключевые строки маркетинговой части, переведённые на оба языка. */
export interface Messages {
  home: string;
  features: string;
  pricing: string;
  contacts: string;
  book: string;
  chooseDateTime: string;
  services: string;
  details: string;
  contact: string;
  heroEyebrow: string;
  heroTitle: string;
  heroTitleAccent: string;
  heroSubtitle: string;
  ticketTitle: string;
  ticketClientLabel: string;
  ticketClient: string;
  ticketTimeLabel: string;
  ticketTime: string;
  ticketServiceLabel: string;
  ticketService: string;
  ticketStatus: string;
  ticketNumberLabel: string;
  tryDemo: string;
  connect: string;
  demoBook: string;
  demoMore: string;
  finalCtaTitle: string;
  finalCtaText: string;
  finalCtaTrialDays: string;
  finalCtaTrialFree: string;
  finalCtaPhoneLabel: string;
  finalCtaPhoneError: string;
  skipToContent: string;
  mainNavigation: string;
  openMenu: string;
  closeMenu: string;
  language: string;
  footerDescription: string;
  footerNavigation: string;
  footerForBusiness: string;
  footerLead: string;
  footerRequest: string;
  footerPrivacy: string;
  footerRights: string;
  footerStatusLoading: string;
  footerStatusOperational: string;
  footerStatusDegraded: string;
  footerStatusOutage: string;
  footerStatusUnknown: string;
}

const ru: Messages = {
  home: 'Главная',
  features: 'Возможности',
  pricing: 'Цены',
  contacts: 'Контакты',
  book: 'Записаться',
  chooseDateTime: 'Выбрать дату и время',
  services: 'Услуги',
  details: 'Подробнее',
  contact: 'Связаться',
  heroEyebrow: 'Для СТО, детейлинга, автомоек и шиномонтажа в Казахстане',
  heroTitle: 'Онлайн-запись и управление автосервисом',
  heroTitleAccent: 'в одной системе',
  heroSubtitle:
    'Renvio принимает записи клиентов 24/7, собирает расписание сотрудников, напоминает клиентам в Telegram и показывает аналитику — вместо звонков, тетрадей и разрозненных таблиц.',
  ticketTitle: 'Наряд-заказ',
  ticketClientLabel: 'Клиент',
  ticketClient: 'Алексей',
  ticketTimeLabel: 'Время',
  ticketTime: 'Сегодня, 14:30',
  ticketServiceLabel: 'Услуга',
  ticketService: 'Детейлинг',
  ticketStatus: 'Запись открыта',
  ticketNumberLabel: 'Номер',
  tryDemo: 'Попробовать демо',
  connect: 'Подключить Renvio',
  demoBook: 'Записаться на демо',
  demoMore: 'Подробнее о возможностях',
  finalCtaTitle: 'Готовы навести порядок в записях и расписании?',
  finalCtaText:
    'Оставьте номер — покажем систему на примере вашего сервиса. Или подключитесь сами: {trial} бесплатно.',
  finalCtaTrialDays: 'первые {days}',
  finalCtaTrialFree: 'пробный период',
  finalCtaPhoneLabel: 'Ваш телефон',
  finalCtaPhoneError: 'Введите номер полностью: {phone}',
  skipToContent: 'Перейти к содержанию',
  mainNavigation: 'Основная навигация',
  openMenu: 'Открыть меню',
  closeMenu: 'Закрыть меню',
  language: 'Язык',
  footerDescription:
    'Облачная система управления автосервисами и сервисными предприятиями в Казахстане.',
  footerNavigation: 'Навигация в подвале',
  footerForBusiness: 'Для автосервисов и СТО',
  footerLead: 'Оставьте заявку — команда Renvio поможет с подключением.',
  footerRequest: 'Оставить заявку',
  footerPrivacy: 'Политика конфиденциальности',
  footerRights: 'Все права защищены.',
  footerStatusLoading: 'Проверяем статус…',
  footerStatusOperational: 'Все системы работают',
  footerStatusDegraded: 'Есть сбой в работе сервиса',
  footerStatusOutage: 'Сервис временно недоступен',
  footerStatusUnknown: 'Статус системы',
};

const kk: Messages = {
  home: 'Басты бет',
  features: 'Мүмкіндіктер',
  pricing: 'Бағалар',
  contacts: 'Байланыс',
  book: 'Жазылу',
  chooseDateTime: 'Күн мен уақытты таңдаңыз',
  services: 'Қызметтер',
  details: 'Толығырақ',
  contact: 'Байланысу',
  heroEyebrow:
    'Қазақстандағы СТО, детейлинг, автомобиль жуу орындары және дөңгелек шеберханалары үшін',
  heroTitle: 'Автосервиске онлайн жазылу және басқару',
  heroTitleAccent: 'бір жүйеде',
  heroSubtitle:
    'Renvio клиенттерді тәулік бойы қабылдайды, қызметкерлердің кестесін жинайды, Telegram арқылы еске салады және аналитиканы көрсетеді — қоңыраулар, дәптерлер мен шашыраңқы кестелердің орнына.',
  ticketTitle: 'Жұмыс тапсырмасы',
  ticketClientLabel: 'Тапсырыс беруші',
  ticketClient: 'Айбек',
  ticketTimeLabel: 'Уақыт',
  ticketTime: 'Бүгін, 14:30',
  ticketServiceLabel: 'Қызмет',
  ticketService: 'Детейлинг қызметі',
  ticketStatus: 'Жазылу ашық',
  ticketNumberLabel: 'Нөмірі',
  tryDemo: 'Демоны сынап көру',
  connect: 'Renvio-ны қосу',
  demoBook: 'Демоға жазылу',
  demoMore: 'Мүмкіндіктер туралы толығырақ',
  finalCtaTitle: 'Жазылу мен кестеде тәртіп орнатуға дайынсыз ба?',
  finalCtaText:
    'Нөміріңізді қалдырыңыз — жүйені қызметіңіз мысалында көрсетеміз. Немесе өзіңіз қосылыңыз: {trial} тегін.',
  finalCtaTrialDays: 'алғашқы {days} күн',
  finalCtaTrialFree: 'сынақ мерзімі',
  finalCtaPhoneLabel: 'Телефон нөміріңіз',
  finalCtaPhoneError: 'Нөмірді толық енгізіңіз: {phone}',
  skipToContent: 'Мазмұнға өту',
  mainNavigation: 'Негізгі навигация',
  openMenu: 'Мәзірді ашу',
  closeMenu: 'Мәзірді жабу',
  language: 'Тіл',
  footerDescription:
    'Қазақстандағы автосервистер мен қызмет көрсету кәсіпорындарын басқарудың бұлттық жүйесі.',
  footerNavigation: 'Астыңғы навигация',
  footerForBusiness: 'Автосервистер мен СТО үшін',
  footerLead: 'Өтініш қалдырыңыз — Renvio тобы қосуға көмектеседі.',
  footerRequest: 'Өтініш қалдыру',
  footerPrivacy: 'Құпиялылық саясаты',
  footerRights: 'Барлық құқықтар қорғалған.',
  footerStatusLoading: 'Күй тексерілуде…',
  footerStatusOperational: 'Барлық жүйелер жұмыс істеуде',
  footerStatusDegraded: 'Қызметте ақаулық бар',
  footerStatusOutage: 'Қызмет уақытша қолжетімсіз',
  footerStatusUnknown: 'Жүйе күйі',
};

export const dictionaries: Record<Locale, Messages> = { ru, kk };
export const messages = dictionaries;

export function getDictionary(locale: Locale): Messages {
  return dictionaries[parseLocale(locale) ?? DEFAULT_LOCALE];
}

export function isLocale(value: unknown): value is Locale {
  return value === 'ru' || value === 'kk';
}

/** Принимает 'kk', 'kk-KZ', 'kk_KZ', 'ru', 'ru-KZ' и т.п. */
export function parseLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'kk' || normalized.startsWith('kk-') || normalized.startsWith('kk_'))
    return 'kk';
  if (normalized === 'ru' || normalized.startsWith('ru-') || normalized.startsWith('ru_'))
    return 'ru';
  return null;
}

/** Читает ?lang=... (приоритет у query-параметра). */
export function localeFromSearch(
  search: string | URLSearchParams | null | undefined,
): Locale | null {
  if (!search) return null;
  try {
    const raw =
      typeof search === 'string'
        ? search.slice(search.indexOf('?') === -1 ? 0 : search.indexOf('?') + 1)
        : search;
    return parseLocale(new URLSearchParams(raw).get('lang'));
  } catch {
    return null;
  }
}

export function readStoredLocale(): Locale | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return parseLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Чистая функция: query → localStorage → 'ru'. */
export function detectLocale(
  search: string | URLSearchParams | null | undefined = typeof window === 'undefined'
    ? undefined
    : window.location.search,
  stored: string | null | undefined = readStoredLocale(),
): Locale {
  return localeFromSearch(search) ?? parseLocale(stored) ?? DEFAULT_LOCALE;
}

/** Синоним detectLocale для удобства вызова из приложения. */
export const resolveLocale = detectLocale;

export function saveLocale(locale: Locale): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Приватный режим может запретить запись — язык всё равно работает в памяти.
  }
}

export function applyDocumentLocale(locale: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

/** Вызывается один раз при старте приложения: определяет язык и выставляет <html lang>. */
export function initLocale(): Locale {
  const locale = getLocale();
  saveLocale(locale);
  applyDocumentLocale(locale);
  return locale;
}

const listeners = new Set<() => void>();
let selectedLocale: Locale | null = null;

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLocale(): Locale {
  return selectedLocale ?? detectLocale();
}

export const getServerLocale = () => DEFAULT_LOCALE;

export function setActiveLocale(locale: Locale): void {
  selectedLocale = parseLocale(locale) ?? DEFAULT_LOCALE;
  saveLocale(selectedLocale);
  applyDocumentLocale(selectedLocale);
  listeners.forEach((listener) => listener());
}

export const setLocale = setActiveLocale;

/** Сброс выбранного в памяти языка (используется в тестах). */
export function resetLocale(): void {
  selectedLocale = null;
}

export interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Messages;
}

/** Реактивный доступ к языку: все подписчики обновляются без перезагрузки страницы. */
export function useLocale(): LocaleState {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getServerLocale);

  useEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);

  return { locale, setLocale: setActiveLocale, t: dictionaries[locale] };
}

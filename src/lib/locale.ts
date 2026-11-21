import { useEffect, useSyncExternalStore } from 'react';

/** Поддерживаемые языки маркетинговой части сайта. */
export type Locale = 'ru' | 'kk';

export const LOCALE_STORAGE_KEY = 'studio-locale';
export const DEFAULT_LOCALE: Locale = 'ru';

export interface TicketRow {
  label: string;
  value: string;
}

/** Данные наряда-заказа: один объект вместо набора разрозненных ticket*-ключей. */
export interface TicketMessages {
  title: string;
  numberLabel: string;
  number: string;
  status: string;
  rows: TicketRow[];
}

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
  ticket: TicketMessages;
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
  pricing: 'Тарифы',
  contacts: 'Контакты',
  book: 'Записаться',
  chooseDateTime: 'Выбрать дату и время',
  services: 'Услуги',
  details: 'Подробнее',
  contact: 'Связаться',
  heroEyebrow: 'Онлайн-запись для сервисов по времени в Казахстане — от СТО до барбершопов',
  heroTitle: 'Запись на услугу без звонков',
  heroTitleAccent: 'и таблиц',
  heroSubtitle:
    'Renvio принимает записи 24/7, показывает загрузку специалистов и напоминает клиентам о визите. Один кабинет вместо телефона, тетради и таблицы.',
  ticket: {
    title: 'Наряд-заказ',
    numberLabel: 'Номер',
    number: 'RNV-0427',
    status: 'Запись открыта',
    rows: [
      { label: 'Клиент', value: 'Алексей' },
      { label: 'Время', value: 'Сегодня, 14:30' },
      { label: 'Услуга', value: 'Детейлинг' },
    ],
  },
  tryDemo: 'Посмотреть демо',
  connect: 'Подключить сервис',
  demoBook: 'Записаться на демо',
  demoMore: 'Подробнее о возможностях',
  finalCtaTitle: 'Покажем Renvio на вашем сервисе',
  finalCtaText:
    'Оставьте номер — покажем запись и календарь на примере ваших услуг. Или подключитесь сами: {trial} бесплатно.',
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
    'Облачная система онлайн-записи и календаря для сервисов в Казахстане — от СТО до барбершопов.',
  footerNavigation: 'Навигация в подвале',
  footerForBusiness: 'Для сервисов с записью по времени',
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
    'Қазақстандағы уақытқа жазылатын қызметтер үшін онлайн жазылу — СТО-дан барбершоптарға дейін',
  heroTitle: 'Қызметке жазылу қоңыраусыз',
  heroTitleAccent: 'және қағаз кестелерсіз',
  heroSubtitle:
    'Renvio клиенттерді тәулік бойы қабылдайды, мамандардың жүктемесін көрсетеді және кездесу алдында еске салады. Бір кабинет — телефон, дәптер және кестелердің орнына.',
  ticket: {
    title: 'Жұмыс тапсырмасы',
    numberLabel: 'Нөмірі',
    number: 'RNV-0427',
    status: 'Жазылу ашық',
    rows: [
      { label: 'Тапсырыс беруші', value: 'Айбек' },
      { label: 'Уақыт', value: 'Бүгін, 14:30' },
      { label: 'Қызмет', value: 'Детейлинг қызметі' },
    ],
  },
  tryDemo: 'Демоны көру',
  connect: 'Қызметті қосу',
  demoBook: 'Демоға жазылу',
  demoMore: 'Мүмкіндіктер туралы толығырақ',
  finalCtaTitle: 'Renvio-ны сіздің қызметіңізде көрсетейік',
  finalCtaText:
    'Нөміріңізді қалдырыңыз — жазылу мен кестені қызметіңіз мысалында көрсетеміз. Немесе өзіңіз қосылыңыз: {trial} тегін.',
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
    'Қазақстандағы сервистерге арналған бұлттық онлайн жазылу мен кесте жүйесі — СТО-дан барбершоптарға дейін.',
  footerNavigation: 'Астыңғы навигация',
  footerForBusiness: 'Уақытқа жазылатын қызметтер үшін',
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

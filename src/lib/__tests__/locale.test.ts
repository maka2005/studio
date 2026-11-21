import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyDocumentLocale,
  DEFAULT_LOCALE,
  detectLocale,
  dictionaries,
  initLocale,
  LOCALE_STORAGE_KEY,
  localeFromSearch,
  parseLocale,
  resetLocale,
  resolveLocale,
  saveLocale,
  useLocale,
} from '../locale';

afterEach(() => {
  resetLocale();
  localStorage.clear();
  window.history.pushState({}, '', '/');
  document.documentElement.lang = DEFAULT_LOCALE;
});

describe('определение локали', () => {
  it('понимает ru/kk и региональные варианты', () => {
    expect(parseLocale('kk')).toBe('kk');
    expect(parseLocale('kk-KZ')).toBe('kk');
    expect(parseLocale('ru_KZ')).toBe('ru');
    expect(parseLocale('de')).toBeNull();
    expect(parseLocale(null)).toBeNull();
  });

  it('читает ?lang=kk и ?lang=ru', () => {
    expect(localeFromSearch('?lang=kk')).toBe('kk');
    expect(localeFromSearch('lang=ru&type=demo')).toBe('ru');
    expect(localeFromSearch('?lang=de')).toBeNull();
  });

  it('выбирает query, затем localStorage, затем ru', () => {
    expect(detectLocale('?lang=kk', 'ru')).toBe('kk');
    expect(detectLocale('?lang=ru', 'kk')).toBe('ru');
    expect(detectLocale('?lang=de', 'kk')).toBe('kk');
    expect(detectLocale('', null)).toBe('ru');
    expect(resolveLocale('', 'kk')).toBe('kk');
  });

  it('читает язык из localStorage браузера и выставляет html lang', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'kk');
    expect(detectLocale(window.location.search)).toBe('kk');
    expect(initLocale()).toBe('kk');
    expect(document.documentElement.lang).toBe('kk');

    applyDocumentLocale('ru');
    expect(document.documentElement.lang).toBe('ru');
  });

  it('сохраняет явный выбор', () => {
    saveLocale('kk');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('kk');
  });
});

describe('словарь', () => {
  it('содержит ключевые строки на обоих языках', () => {
    expect(dictionaries.ru.home).toBe('Главная');
    expect(dictionaries.ru.book).toBe('Записать машину');
    expect(dictionaries.ru.connect).toBe('Подключить студию');
    expect(dictionaries.ru.ticket.title).toBe('Наряд-заказ');
    expect(dictionaries.ru.ticket.number).toBe('RNV-0427');
    expect(dictionaries.ru.ticket.rows).toHaveLength(3);
    expect(dictionaries.ru.chooseDateTime).toBe('Выбрать дату и время');
    expect(dictionaries.ru.services).toBe('Услуги');

    expect(dictionaries.kk.home).toBe('Басты бет');
    expect(dictionaries.kk.features).toBe('Мүмкіндіктер');
    expect(dictionaries.kk.pricing).toBe('Бағалар');
    expect(dictionaries.kk.contacts).toBe('Байланыс');
    expect(dictionaries.kk.book).toBe('Көлігін жазылу');
    expect(dictionaries.kk.connect).toBe('Студияны қосу');
    expect(dictionaries.kk.ticket.title).toBe('Жұмыс тапсырмасы');
    expect(dictionaries.kk.ticket.number).toBe('RNV-0427');
    expect(dictionaries.kk.ticket.rows).toHaveLength(3);
    expect(dictionaries.kk.chooseDateTime).toBe('Күн мен уақытты таңдаңыз');
    expect(dictionaries.kk.services).toBe('Қызметтер');
    expect(dictionaries.kk.details).toBe('Толығырақ');
    expect(dictionaries.kk.contact).toBe('Байланысу');
    expect(dictionaries.kk.heroTitle).toContain('жазылу');
    expect(dictionaries.kk.heroSubtitle).toContain('клиенттерді');
    expect(dictionaries.kk.footerRequest).toBe('Өтініш қалдыру');
  });

  it('переводы на kk не совпадают с русскими и используют казахскую кириллицу', () => {
    const keys = Object.keys(dictionaries.kk) as (keyof typeof dictionaries.kk)[];
    for (const key of keys) {
      expect(dictionaries.kk[key]).not.toBe(dictionaries.ru[key]);
    }
    expect(dictionaries.kk.heroEyebrow).toMatch(/Қазақстандағы/);
    expect(dictionaries.kk.footerDescription).toMatch(/бұлттық/);
  });
});

describe('useLocale', () => {
  it('определяет язык по query и обновляет все подписчики без перезагрузки', () => {
    window.history.pushState({}, '', '/?lang=kk');
    resetLocale();

    const first = renderHook(() => useLocale());
    const second = renderHook(() => useLocale());

    expect(first.result.current.locale).toBe('kk');
    expect(first.result.current.t.home).toBe('Басты бет');
    expect(document.documentElement.lang).toBe('kk');

    act(() => {
      first.result.current.setLocale('ru');
    });

    expect(first.result.current.locale).toBe('ru');
    expect(second.result.current.locale).toBe('ru');
    expect(first.result.current.t.home).toBe('Главная');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
  });
});

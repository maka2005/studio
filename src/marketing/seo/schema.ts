import type { Locale } from '../../lib/locale';
import { SITE } from '../config/site';
import { faqItems } from '../data/content';

const abs = (path: string) => SITE.url + path;

/** Языковая метка schema.org для текущей локали сайта. */
export const localeTag = (locale: Locale = 'ru'): string => (locale === 'kk' ? 'kk-KZ' : 'ru-KZ');

export const organizationLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': abs('/#organization'),
  name: SITE.name,
  url: abs('/'),
  logo: abs('/favicon.svg'),
  areaServed: { '@type': 'Country', name: 'Казахстан' },
  ...(SITE.contacts.email || SITE.contacts.phone
    ? {
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'sales',
          availableLanguage: ['ru', 'kk'],
          ...(SITE.contacts.email ? { email: SITE.contacts.email } : {}),
          ...(SITE.contacts.phone ? { telephone: SITE.contacts.phone } : {}),
        },
      }
    : {}),
});

export const websiteLd = (locale: Locale = 'ru') => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': abs('/#website'),
  name: SITE.name,
  url: abs('/'),
  inLanguage: localeTag(locale),
  publisher: { '@id': abs('/#organization') },
});

export const softwareLd = (
  plans: { name: string; price: number }[],
  locale: Locale = 'ru',
  description?: string,
) => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: SITE.name,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web, iOS, Android',
  description:
    description ??
    'Облачная система онлайн-записи и календаря для сервисов с записью по времени — от СТО до барбершопов: расписание, сотрудники и аналитика.',
  url: abs('/'),
  inLanguage: locale,
  offers: plans.map((p) => ({
    '@type': 'Offer',
    name: p.name,
    price: String(p.price),
    priceCurrency: 'KZT',
    category: 'subscription',
    url: abs('/pricing'),
  })),
});

export const faqLd = (
  trialDays: number | null,
  items: { question: string; answer: string }[] = faqItems(trialDays),
) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: { '@type': 'Answer', text: item.answer },
  })),
});

export const breadcrumbLd = (items: { name: string; path: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: it.name,
    item: abs(it.path),
  })),
});

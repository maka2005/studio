import { SITE } from '../config/site';
import { faqItems } from '../data/content';

const abs = (path: string) => SITE.url + path;

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
          availableLanguage: ['ru'],
          ...(SITE.contacts.email ? { email: SITE.contacts.email } : {}),
          ...(SITE.contacts.phone ? { telephone: SITE.contacts.phone } : {}),
        },
      }
    : {}),
});

export const websiteLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': abs('/#website'),
  name: SITE.name,
  url: abs('/'),
  inLanguage: 'ru-KZ',
  publisher: { '@id': abs('/#organization') },
});

export const softwareLd = (plans: { name: string; price: number }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: SITE.name,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web, iOS, Android',
  description:
    'Облачная система для СТО, автосервисов, детейлинг-студий, автомоек и шиномонтажа: онлайн-запись, расписание, сотрудники, аналитика.',
  url: abs('/'),
  inLanguage: 'ru',
  offers: plans.map((p) => ({
    '@type': 'Offer',
    name: p.name,
    price: String(p.price),
    priceCurrency: 'KZT',
    category: 'subscription',
    url: abs('/pricing'),
  })),
});

export const faqLd = (trialDays: number | null) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqItems(trialDays).map((item) => ({
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

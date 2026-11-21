import { useEffect } from 'react';
import { useLocale, type Locale } from '../../lib/locale';
import { SITE } from '../config/site';
import { useMarketingCopy } from '../data/copy';

type JsonLd = Record<string, unknown>;

interface DocumentMeta {
  title: string;
  description: string;
  path: string;
  /** Структурированные данные schema.org для страницы. */
  jsonLd?: JsonLd[];
  /** Относительный путь к картинке для соцсетей. По умолчанию — /og-image.png. */
  image?: string;
  noindex?: boolean;
}

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function setAlternate(hreflang: string, href: string) {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="alternate"][hreflang="${hreflang}"]`);
  if (!el) {
    el = document.createElement('link');
    el.rel = 'alternate';
    el.hreflang = hreflang;
    document.head.appendChild(el);
  }
  el.href = href;
}

const withLang = (url: string, locale: Locale) =>
  `${url}${url.includes('?') ? '&' : '?'}lang=${locale}`;

/** Выставляет title, description, canonical, Open Graph, Twitter Card, robots, hreflang и JSON-LD для текущей страницы. */
export function useDocumentMeta({
  title,
  description,
  path,
  jsonLd,
  image = '/og-image.png',
  noindex = false,
}: DocumentMeta) {
  const { locale } = useLocale();
  const copy = useMarketingCopy();
  const ld = jsonLd ? JSON.stringify(jsonLd) : '';

  useEffect(() => {
    const url = SITE.url + path;
    const img = SITE.url + image;
    document.title = title;
    setMeta('name', 'description', description);
    setMeta(
      'name',
      'robots',
      noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large, max-snippet:-1',
    );
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:site_name', SITE.name);
    setMeta('property', 'og:locale', locale === 'kk' ? 'kk_KZ' : 'ru_KZ');
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:image', img);
    setMeta('property', 'og:image:width', '1200');
    setMeta('property', 'og:image:height', '630');
    setMeta('property', 'og:image:alt', copy.ogAlt);
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', description);
    setMeta('name', 'twitter:image', img);

    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = url;

    setAlternate('ru', withLang(url, 'ru'));
    setAlternate('kk', withLang(url, 'kk'));
    setAlternate('ru-KZ', withLang(url, 'ru'));
    setAlternate('kk-KZ', withLang(url, 'kk'));

    let script: HTMLScriptElement | null = null;
    if (ld) {
      script = document.createElement('script');
      script.type = 'application/ld+json';
      script.dataset.seo = 'page';
      script.text = ld;
      document.head.appendChild(script);
    }
    return () => {
      script?.remove();
    };
  }, [title, description, path, image, noindex, ld, locale, copy.ogAlt]);
}

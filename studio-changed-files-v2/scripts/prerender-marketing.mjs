import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const distIndex = path.join(root, 'dist', 'index.html');
const site = 'https://servio.kz';
const routes = [
  {
    route: '/',
    file: null,
    title: 'Renvio — программа для автосервиса, СТО и детейлинга: онлайн-запись клиентов',
    description: 'Renvio — облачная CRM для СТО, автосервисов, детейлинг-студий, автомоек и шиномонтажа в Казахстане: онлайн-запись 24/7, расписание, Telegram-напоминания, аналитика. Бесплатный пробный период.',
    h1: 'Renvio — онлайн-запись и управление автосервисом',
    body: `<p>Облачная система для СТО, автосервисов, детейлинг-студий, автомоек и шиномонтажа в Казахстане: онлайн-запись клиентов 24/7, расписание сотрудников, напоминания в Telegram, лист ожидания, промокоды, аналитика и отчёты.</p>
<ul><li><a href="/features">Возможности</a></li><li><a href="/pricing">Тарифы</a></li><li><a href="/contact">Оставить заявку и попробовать бесплатно</a></li><li><a href="/privacy">Политика конфиденциальности</a></li></ul>`,
  },
  {
    route: '/features',
    file: path.join(root, 'dist', 'features', 'index.html'),
    title: 'Возможности Renvio — автоматизация записей и управления автосервисом',
    description: 'Онлайн-запись, календарь, услуги, цены, сотрудники, права доступа, аналитика и промокоды в одной системе для автосервиса.',
    h1: 'Возможности Renvio',
    body: `<p>Всё для автосервиса, детейлинга, автомойки и шиномонтажа в одной системе.</p>
<ul><li>Онлайн-запись клиентов 24/7</li><li>Календарь и расписание сотрудников</li><li>Услуги, категории и цены</li><li>Права доступа и обработка записей</li><li>Telegram-напоминания и лист ожидания</li><li>Промокоды, скидки, аналитика и отчёты</li></ul>
<p><a href="/pricing">Посмотреть тарифы</a> · <a href="/contact">Оставить заявку</a></p>`,
  },
  {
    route: '/pricing',
    file: path.join(root, 'dist', 'pricing', 'index.html'),
    title: 'Тарифы Renvio — START и PRO для автосервиса в Казахстане',
    description: 'Прозрачные тарифы Renvio для автосервисов: START и PRO с ежемесячной оплатой. Подключите управление записями и расписанием.',
    h1: 'Тарифы Renvio',
    body: `<p>Прозрачные тарифы для автосервисов, СТО, детейлинга, автомоек и шиномонтажа.</p>
<ul><li><strong>START</strong> — для бизнеса, который переводит записи и управление в одну систему.</li><li><strong>PRO</strong> — расширенные лимиты и полный набор возможностей Renvio.</li></ul>
<p>Актуальные цены, лимиты и пробный период отображаются на странице при открытии в браузере.</p>
<p><a href="/contact">Подключить Renvio</a> · <a href="/features">Возможности</a></p>`,
  },
  {
    route: '/contact',
    file: path.join(root, 'dist', 'contact', 'index.html'),
    title: 'Заявка на подключение и демонстрация Renvio',
    description: 'Оставьте заявку на подключение Renvio или запишитесь на демонстрацию. Свяжемся с вами в ближайшее время.',
    h1: 'Подключить Renvio для автосервиса или студии',
    body: `<p>Оставьте заявку — мы свяжемся с вами, покажем систему и поможем настроить услуги, цены и сотрудников.</p>
<p>На странице доступны форма заявки, подключение организации и контакты.</p>
<p><a href="/pricing">Тарифы</a> · <a href="/features">Возможности</a></p>`,
  },
  {
    route: '/privacy',
    file: path.join(root, 'dist', 'privacy', 'index.html'),
    title: 'Политика конфиденциальности — Renvio',
    description: 'Как Renvio обрабатывает персональные данные, оставленные в заявке на подключение или демонстрацию.',
    h1: 'Политика конфиденциальности',
    body: `<p>Как Renvio обрабатывает персональные данные, оставленные в заявке на подключение или демонстрацию.</p>
<p>Полный актуальный текст политики доступен на этой странице при открытии в браузере.</p>
<p><a href="/">На главную</a> · <a href="/contact">Контакты</a></p>`,
  },
];

function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function upsert(html, re, replacement, fallbackRe = null) {
  if (re.test(html)) return html.replace(re, replacement);
  if (fallbackRe && fallbackRe.test(html)) return html.replace(fallbackRe, replacement);
  return html;
}

function applyMeta(template, r) {
  const url = site + r.route;
  let html = template;
  html = upsert(html, /<title>[\s\S]*?<\/title>/i, `<title>${esc(r.title)}</title>`);
  html = upsert(html, /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, `<meta name="description" content="${esc(r.description)}" />`);
  html = upsert(html, /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i, `<link rel="canonical" href="${url}" />`);
  html = upsert(html, /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:title" content="${esc(r.title)}" />`);
  html = upsert(html, /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:description" content="${esc(r.description)}" />`);
  html = upsert(html, /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:url" content="${url}" />`);
  html = upsert(html, /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:title" content="${esc(r.title)}" />`);
  html = upsert(html, /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:description" content="${esc(r.description)}" />`);
  // keep existing alternates as ru-KZ/x-default for this domain
  return html;
}

function injectPrerenderBody(html, r) {
  const block = `<div id="root"><main id="seo-prerender" style="font-family:system-ui,sans-serif;max-width:920px;margin:40px auto;padding:0 20px;line-height:1.6"><h1>${esc(r.h1)}</h1>${r.body}</main></div>`;
  if (html.includes('<div id="root"></div>')) return html.replace('<div id="root"></div>', block);
  return html.replace(/<div id="root">[\s\S]*?<\/div>/i, block);
}

if (!fs.existsSync(distIndex)) {
  console.log('prerender: dist/index.html not found, skipping');
  process.exit(0);
}
const template = fs.readFileSync(distIndex, 'utf8');
for (const r of routes) {
  const html = injectPrerenderBody(applyMeta(template, r), r);
  if (!r.file) {
    fs.writeFileSync(distIndex, html, 'utf8');
    console.log('prerendered /');
    continue;
  }
  fs.mkdirSync(path.dirname(r.file), { recursive: true });
  fs.writeFileSync(r.file, html, 'utf8');
  console.log('prerendered', r.route);
}

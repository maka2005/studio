import { expect, test } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173';

test('маркетинговая главная отвечает и не роняет консоль', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('body')).not.toHaveText('', { timeout: 10_000 });
  await expect(page.locator('.hero .btn')).toHaveCount(1);
  await expect(
    page.locator('.hero').getByRole('link', { name: 'Подключить сервис' }),
  ).toBeVisible();
  expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});

test('знак R в логотипе одного цвета в шапке и подвале', async ({ page }) => {
  await page.goto('/');
  // Предрендеренный HTML скрыт до гидратации.
  await expect(page.locator('body')).not.toHaveText('', { timeout: 15_000 });
  const fills = await page.evaluate(() => {
    const mark = (selector: string) =>
      document.querySelector(selector)?.querySelector('path')?.getAttribute('fill') ?? null;
    return { header: mark('.header__logo svg'), footer: mark('.footer__brand svg') };
  });
  expect(fills.header).toBe('#C2410C');
  expect(fills.footer).toBe(fills.header);
});

test('главная показывает пилотные сценарии, страница тарифов не пуста', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).not.toHaveText('', { timeout: 15_000 });
  await expect(page.locator('.case-card')).toHaveCount(3);
  await page.goto('/pricing');
  await expect(page.locator('.pricing-cards .plan').first()).toBeVisible();
});

test('поле телефона в финальном CTA не сжимается на мобильном', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  // Предрендеренный HTML скрыт до гидратации.
  await expect(page.locator('body')).not.toHaveText('', { timeout: 15_000 });
  const sizes = await page.evaluate(() => {
    const input = document.querySelector('.final-cta__form input');
    const button = document.querySelector('.final-cta__form .btn');
    if (!input || !button) return null;
    const a = input.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    return { inputHeight: a.height, buttonHeight: b.height, gap: b.top - a.bottom };
  });
  expect(sizes).not.toBeNull();
  if (!sizes) return;
  expect(sizes.inputHeight).toBeGreaterThanOrEqual(44);
  expect(sizes.inputHeight).toBeCloseTo(sizes.buttonHeight, 0);
  expect(sizes.gap).toBeGreaterThanOrEqual(12);
});

test('юридические страницы показывают реквизиты из админки', async ({ page }) => {
  await page.route('**/api/platform?action=legal*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        legal: {
          operator: 'ТОО «Тест Ренвио»',
          bin: '123456789012',
          address: 'г. Алматы, ул. Тестовая, 1',
        },
        contacts: {
          phone: '+7 777 000 00 00',
          whatsapp: '77770000000',
          email: 'test@example.kz',
        },
      }),
    }),
  );

  for (const route of ['/offer', '/privacy']) {
    await page.goto(route);
    await expect(page.locator('.legal-notice')).toHaveCount(0);
    await expect(page.getByText(/ТОО «Тест Ренвио»/).first()).toBeVisible();
  }

  await page.goto('/');
  await expect(page.locator('.footer__contacts a[href^="mailto:"]')).toHaveText('test@example.kz');
});

test('health endpoint возвращает JSON-контракт, когда доступен', async ({ request }) => {
  const res = await request.get(`${BASE}/api/health`);
  if (res.status() === 404) test.skip(true, 'API route not served by preview server');
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(Array.isArray(json.checks)).toBe(true);
});

test('CSP включён в режиме enforce (не Report-Only)', async ({ request }) => {
  const res = await request.get(BASE);
  expect(res.ok()).toBeTruthy();
  const enforce = res.headers()['content-security-policy'] || '';
  const reportOnly = res.headers()['content-security-policy-report-only'] || '';
  expect(enforce.length).toBeGreaterThan(0);
  expect(enforce).toContain("default-src 'self'");
  expect(enforce).toContain('report-uri /api/csp-report');
  expect(reportOnly).toBe('');
});

test('публичная страница организации и вход для студии', async ({ page }) => {
  const res = await page.goto('/s/graphite');
  expect(res?.ok()).toBeTruthy();
  await expect(page.getByText('KostAutoHub', { exact: false }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('Вход для студии', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Записаться' }).first()).toBeVisible();
});

test('страница входа владельца студии открывается', async ({ page }) => {
  const res = await page.goto('/s/graphite/owner');
  expect(res?.ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Кабинет студии' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('Почта', { exact: true })).toBeVisible();
  await expect(page.getByText('Пароль', { exact: true })).toBeVisible();
});

test('страница входа команды платформы открывается', async ({ page }) => {
  const res = await page.goto('/platform/admin');
  expect(res?.ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Вход для команды' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
});

test('Android-иконки и webmanifest отдаются с кэшем', async ({ request }) => {
  for (const path of [
    '/tenants/graphite/images/icon-192.png',
    '/tenants/graphite/images/icon-512.png',
  ]) {
    const res = await request.get(`${BASE}${path}`);
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toContain('image/png');
    expect(res.headers()['cache-control']).toContain('immutable');
  }

  const manifest = await request.get(`${BASE}/tenants/graphite.webmanifest`);
  expect(manifest.ok()).toBeTruthy();
  const json = await manifest.json();
  expect(json.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', type: 'image/png' }),
      expect.objectContaining({ sizes: '512x512', type: 'image/png' }),
    ]),
  );
});

test('казахские глифы Unbounded загружаются, а не подменяются системным шрифтом', async ({
  page,
}) => {
  await page.goto('/?lang=kk');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await document.fonts.load('700 46px Unbounded', 'ҚӨҰҮІӘ');
  });

  const glyphs = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D недоступен');
    const text = 'ҚӨҰҮІӘ';
    ctx.font = '700 46px Unbounded';
    const displayWidth = ctx.measureText(text).width;
    ctx.font = '700 46px sans-serif';
    const fallbackWidth = ctx.measureText(text).width;
    return {
      checked: document.fonts.check('700 46px Unbounded', text),
      displayWidth,
      fallbackWidth,
    };
  });

  expect(glyphs.checked).toBeTruthy();
  expect(glyphs.displayWidth).toBeGreaterThan(glyphs.fallbackWidth + 2);
  await expect(page.locator('.final-cta__text')).not.toContainText('күн күн');
});

test('ключевые страницы не переполняются по ширине на мобильных экранах', async ({ page }) => {
  const routes = [
    '/',
    '/features',
    '/pricing',
    '/contact',
    '/privacy',
    '/offer',
    '/s/graphite',
    '/s/graphite/services',
    '/s/graphite/booking',
    '/s/graphite/owner',
  ];

  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 800 });
    for (const route of routes) {
      const res = await page.goto(route);
      expect(res?.ok(), `${route} при ${width}px`).toBeTruthy();
      // Предрендеренный HTML скрыт до гидратации: ждём реальный контент и шрифты.
      await expect(page.locator('body')).not.toHaveText('', { timeout: 15_000 });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: window.innerWidth,
      }));
      expect(
        overflow.scroll,
        `${route} переполняет экран ${width}px: scrollWidth=${overflow.scroll}, innerWidth=${overflow.inner}`,
      ).toBeLessThanOrEqual(width + 1);
    }
  }
});

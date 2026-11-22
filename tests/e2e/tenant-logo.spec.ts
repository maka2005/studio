import { expect, test } from '@playwright/test';
import { mockBookingFunnelApi } from './helpers/mock-api';

// 1×1 PNG: original storage object is served after the optimized URL fails.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nLAAAAAASUVORK5CYII=',
  'base64',
);

test('логотип организации появляется, когда трансформация Supabase недоступна', async ({
  page,
}) => {
  await mockBookingFunnelApi(page);
  const original =
    'https://ezqelrhialezszepehco.supabase.co/storage/v1/object/public/tenant-media/logo.png';

  const configResponse = await page.request.get('/tenants/graphite.json');
  const config = await configResponse.json();
  config.images = { ...config.images, logo: original };
  await page.route('**/rest/v1/tenants*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ config }),
    }),
  );
  await page.route('**/storage/v1/render/image/**', (route) =>
    route.fulfill({ status: 403, contentType: 'text/plain', body: 'forbidden' }),
  );
  await page.route('**/storage/v1/object/public/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
  );

  await page.goto('/s/graphite');
  const logo = page.locator('.brand img');
  await expect(logo).toHaveAttribute('src', original);
  await expect(logo).toHaveJSProperty('naturalWidth', 1);
});

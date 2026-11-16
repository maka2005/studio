import { expect, test } from '@playwright/test';

test('marketing home page responds', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator('body')).toBeVisible();
});

test('health endpoint returns JSON contract when available', async ({ request, baseURL }) => {
  // In preview/static mode /api may not be served; this smoke checks endpoint when present.
  const res = await request.get(`${baseURL}/api/health`);
  if (res.status() === 404) test.skip(true, 'API route not served by preview server');
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(Array.isArray(json.checks)).toBe(true);
});

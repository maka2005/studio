import { expect, test, type Route } from '@playwright/test';
import { mockBookingFunnelApi } from './helpers/mock-api';

const USAGE = {
  plan_code: 'base',
  limits: { employees: 5, services: 20, bookings_per_month: 500, branches: null },
  features: { telegram: true, export: true, reviews: true },
  override: { limits: {}, features: {}, reason: null, updated_at: null },
  usage: { employees: 2, services: 5, bookings_per_month: 42 },
};

const SUBSCRIPTION = {
  state: 'open',
  phase: 'active',
  plan_code: 'base',
  plan_name: 'Базовый',
  price_kzt: 15000,
  price_period_months: 1,
  ends_at: '2026-12-31T00:00:00.000Z',
  days_left: 39,
};

const rpcResponse = (fn: string): unknown => {
  switch (fn) {
    case 'owner_me':
      return true;
    case 'owner_access':
      return 'owner';
    case 'owner_subscription':
      return SUBSCRIPTION;
    case 'owner_plan_usage':
      return USAGE;
    case 'owner_billing_notifications_page':
      return { items: [], has_more: false, next_cursor: null };
    case 'owner_archive_status':
      return { archived: false, archived_at: null, deletion_requested_at: null };
    case 'owner_platform_feature_flags':
      return {};
    case 'owner_bookings_page':
      return { rows: [], next_cursor: null, has_more: false };
    case 'owner_stats':
      return [
        {
          day: '',
          visits: 0,
          done: 0,
          booked: 0,
          received_cents: 0,
          expected_cents: 0,
        },
      ];
    default:
      return [];
  }
};

const emptyAction = (route: Route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });

test('кабинет владельца: отступы карточек и русские названия возможностей тарифа', async ({
  page,
}) => {
  await mockBookingFunnelApi(page);
  await page.route('**/api/owner?action=*', async (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if (action === 'session') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { id: 'owner-1', email: 'owner@example.com' } }),
      });
    }
    if (action === 'rpc') {
      const body = route.request().postDataJSON() as { fn: string };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(rpcResponse(body.fn)),
      });
    }
    if (action === 'resources') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      });
    }
    return emptyAction(route);
  });

  await page.goto('/s/graphite/owner');
  const cabinetGroup = page.getByRole('button', { name: 'Мой кабинет', exact: true }).first();
  await expect(cabinetGroup).toBeVisible({ timeout: 15_000 });
  await cabinetGroup.click();
  await page.getByRole('button', { name: 'Личный кабинет', exact: true }).first().click();

  const accountGrid = page.locator('.owner-account-grid').first();
  await expect(accountGrid).toBeVisible();
  const spacing = await accountGrid.evaluate((grid) => {
    const cell = grid.firstElementChild as HTMLElement | null;
    const card = grid.closest('.card');
    return {
      display: getComputedStyle(grid).display,
      gap: parseFloat(getComputedStyle(grid).rowGap),
      cellDisplay: cell ? getComputedStyle(cell).display : '',
      cellPadding: cell ? parseFloat(getComputedStyle(cell).paddingTop) : 0,
      cardGap: card ? parseFloat(getComputedStyle(card).rowGap) : 0,
    };
  });
  expect(spacing.display).toBe('grid');
  expect(spacing.gap).toBeGreaterThan(0);
  expect(spacing.cellDisplay).toBe('grid');
  expect(spacing.cellPadding).toBeGreaterThan(0);
  expect(spacing.cardGap).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Счета и оплата', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Счета и оплата' })).toBeVisible();
  await expect(page.getByText('Выгрузка данных: доступно')).toBeVisible();
  await expect(page.getByText('Отзывы: доступно')).toBeVisible();
  await expect(page.getByText(/^(export|reviews):/i)).toHaveCount(0);

  const billingGrid = page.locator('.owner-account-grid').first();
  await expect(billingGrid).toBeVisible();
  expect(await billingGrid.evaluate((grid) => getComputedStyle(grid).display)).toBe('grid');
});

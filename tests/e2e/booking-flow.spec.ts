import { expect, test } from '@playwright/test';
import { BOOKING_TOKEN, mockBookingFunnelApi } from './helpers/mock-api';

test.describe('полная воронка публичной записи', () => {
  test('запись → перенос → отмена без реальных обращений к Supabase', async ({ page }) => {
    await mockBookingFunnelApi(page);

    await page.goto('/s/graphite');
    await expect(page.getByText('KostAutoHub', { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: 'Записаться' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Выберите услугу' })).toBeVisible({
      timeout: 10_000,
    });

    await dialog.getByRole('button', { name: /Тестовая услуга/ }).click();
    await dialog.getByRole('button', { name: 'Продолжить' }).click();
    await expect(dialog.getByRole('heading', { name: 'Выберите время' })).toBeVisible();
    const slot = dialog.getByRole('button', { name: '10:00', exact: true });
    await expect(slot).toBeVisible({ timeout: 10_000 });
    await slot.click();
    await dialog.getByRole('button', { name: 'Продолжить' }).click();

    await expect(dialog.getByRole('heading', { name: 'Ваши контакты' })).toBeVisible();
    await dialog.locator('#name').fill('Тест Клиент');
    await dialog.locator('#phone').fill('+7 777 123 45 67');
    await dialog.locator('#car').fill('Toyota Camry');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Проверить запись' }).click();

    await expect(dialog.getByRole('heading', { name: 'Проверьте запись' })).toBeVisible();
    await expect(dialog.getByText('Тестовая услуга').first()).toBeVisible();
    await dialog.getByRole('button', { name: /Подтвердить запись/ }).click();

    await expect(page.getByRole('heading', { name: 'Запись подтверждена' })).toBeVisible({
      timeout: 15_000,
    });
    await dialog.getByRole('link', { name: /Моя запись/ }).click();

    await expect(page).toHaveURL(/\/s\/graphite\/booking/);
    await expect(page.getByRole('heading', { name: 'Моя запись' }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('Тестовая услуга').first()).toBeVisible();
    await expect(page.getByText('Подтверждена', { exact: true })).toBeVisible();
    await expect(page.getByText(/10:00/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Перенести', exact: true }).click();
    await expect(page.getByText('Перенести запись')).toBeVisible();
    await page.getByRole('button', { name: '11:00', exact: true }).click();
    await page.getByRole('button', { name: 'Подтвердить перенос' }).click();

    await expect(page.getByText('Время записи изменено.')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/11:00/).first()).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: 'Отменить запись', exact: true }).click();
    await page.getByRole('button', { name: 'Да, отменить запись' }).click();
    await expect(page.getByText('Отменена', { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('несколько услуг в одном визите → все записи видны в «Моей записи»', async ({ page }) => {
    await mockBookingFunnelApi(page);

    await page.goto('/s/graphite');
    await expect(page.getByText('KostAutoHub', { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Записаться' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Выберите услугу' })).toBeVisible();

    await dialog.getByRole('button', { name: /Тестовая услуга/ }).click();
    await dialog.getByRole('button', { name: /Вторая услуга/ }).click();
    await expect(dialog.getByText('Выбрано услуг: 2')).toBeVisible();
    await dialog.getByRole('button', { name: 'Продолжить' }).click();
    await dialog.getByRole('button', { name: '10:00', exact: true }).click();
    await dialog.getByRole('button', { name: 'Продолжить' }).click();

    await dialog.locator('#name').fill('Тест Клиент');
    await dialog.locator('#phone').fill('+7 777 123 45 67');
    await dialog.locator('#car').fill('Toyota Camry');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Проверить запись' }).click();
    await expect(dialog.getByText('Вторая услуга').first()).toBeVisible();
    await dialog.getByRole('button', { name: /Подтвердить запись/ }).click();

    await expect(dialog.getByText('Вторая услуга').first()).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('link', { name: /Моя запись/ }).click();

    await expect(page).toHaveURL(/\/s\/graphite\/booking/);
    await expect(page.getByRole('heading', { name: 'Тестовая услуга' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('heading', { name: 'Вторая услуга' })).toBeVisible();
    await expect(page.getByText('Визит 1 / 2')).toBeVisible();
    await expect(page.getByText('Визит 2 / 2')).toBeVisible();
  });

  test('нет свободных мест → заявка → offer → подтверждение записи', async ({ page }) => {
    await mockBookingFunnelApi(page, { freeSlots: false });

    await page.goto('/s/graphite');
    await expect(page.getByText('KostAutoHub', { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: 'Записаться' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Тестовая услуга/ }).click();
    await dialog.getByRole('button', { name: 'Продолжить' }).click();
    await expect(dialog.getByText('Оставьте заявку', { exact: false })).toBeVisible({
      timeout: 10_000,
    });

    await dialog.getByRole('textbox', { name: 'Имя для листа ожидания' }).fill('Тест Клиент');
    await dialog
      .getByRole('textbox', { name: 'Телефон для листа ожидания' })
      .fill('+7 777 123 45 67');
    await dialog
      .getByRole('textbox', { name: 'Автомобиль для листа ожидания' })
      .fill('Toyota Camry');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Оставить заявку', exact: true }).click();

    await expect(dialog.getByText(/Заявка принята/)).toBeVisible({
      timeout: 10_000,
    });
    await dialog.getByRole('link', { name: /Моя заявка/ }).click();

    await expect(page).toHaveURL(/\/s\/graphite\/waitlist/);
    await expect(page.getByRole('heading', { name: 'Моя заявка' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('Освободилось время')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('Тестовая услуга').first()).toBeVisible();

    await page.getByRole('button', { name: 'Занять время', exact: true }).click();
    await expect(page).toHaveURL(/\/s\/graphite\/booking/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Моя запись' }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('Тестовая услуга').first()).toBeVisible();

    // Заявка доступна без приватной ссылки: токен сохранён на этом устройстве.
    await page.getByRole('tab', { name: 'Лист ожидания' }).click();
    await expect(page.getByRole('link', { name: 'Открыть заявку' }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('Тестовая услуга').first()).toBeVisible();
    await expect(page.getByText('Запись оформлена')).toBeVisible();
  });

  test('Telegram-ссылки: ?a=reschedule и ?a=cancel открывают действие и чистят URL', async ({
    page,
  }) => {
    await mockBookingFunnelApi(page);

    await page.goto(`/s/graphite/booking?a=reschedule#t=${BOOKING_TOKEN}`);
    await expect(page.getByText('Перенести запись')).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/s\/graphite\/booking\/?$/, { timeout: 10_000 });

    await page.goto(`/s/graphite/booking?a=cancel#t=${BOOKING_TOKEN}`);
    await expect(page.getByRole('button', { name: 'Да, отменить запись' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/\/s\/graphite\/booking\/?$/, { timeout: 10_000 });
  });

  test('казахская локаль: мастер записи и «Моя запись» переведены', async ({ page }) => {
    await mockBookingFunnelApi(page);

    await page.goto('/s/graphite?lang=kk');
    await expect(page.locator('html')).toHaveAttribute('lang', 'kk');
    await expect(page.getByRole('button', { name: 'KK', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.getByRole('button', { name: 'Жазылу', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Қызметті таңдаңыз' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('Выберите услугу', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Менің жазылуым', exact: true })).toBeVisible();
    await expect(page.getByText('Моя запись', { exact: true })).toHaveCount(0);
  });
});

test('service worker отдаётся как JavaScript и содержит ожидаемую версию кэша', async ({
  request,
}) => {
  const response = await request.get('/sw.js');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type'] ?? '').toMatch(/javascript/);

  const body = await response.text();
  expect(body).toContain('renvio-v1');
  expect(body).toMatch(/addEventListener\(\s*['"]push['"]/);
  expect(body).toMatch(/addEventListener\(\s*['"]notificationclick['"]/);
});

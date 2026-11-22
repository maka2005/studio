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
    await expect(page.getByRole('button', { name: 'Напомнить', exact: true })).toBeVisible();
    // Без разрешения на уведомления показываем причину, а не скачиваем .ics.
    const downloaded = page.waitForEvent('download', { timeout: 1000 }).then(
      () => true,
      () => false,
    );
    await page.getByRole('button', { name: 'Напомнить', exact: true }).click();
    await expect(page.getByText(/Уведомления запрещены в настройках браузера/)).toBeVisible();
    expect(await downloaded).toBe(false);

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
    // Отменённая запись уходит из активных и появляется в архиве.
    await expect(page.getByText('Отменена', { exact: true })).toHaveCount(0, {
      timeout: 10_000,
    });
    await page.getByRole('tab', { name: 'Архив' }).click();
    await expect(page.getByText('Отменена', { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: 'Перенести', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Напомнить', exact: true })).toHaveCount(0);
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
    await dialog.getByRole('button', { name: 'Детейлинг', exact: true }).click();
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

  test('активные записи отделены от архива, кнопки действия — только в активных', async ({
    page,
  }) => {
    await mockBookingFunnelApi(page, { history: true });

    await page.goto(`/s/graphite/booking#t=${BOOKING_TOKEN}`);
    await expect(page.getByRole('heading', { name: 'Моя запись' }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('Тестовая услуга').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Напомнить', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Перенести', exact: true })).toBeVisible();
    await expect(page.getByText('Прошлая услуга')).toHaveCount(0);
    await expect(page.getByText('Отменённая услуга')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Архив' }).click();
    await expect(page.getByText('Прошлая услуга')).toBeVisible();
    await expect(page.getByText('Отменённая услуга')).toBeVisible();
    await expect(page.getByText('Работа выполнена', { exact: true })).toBeVisible();
    await expect(page.getByText('Отменена', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Напомнить', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Перенести', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Отменить запись', exact: true })).toHaveCount(0);
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

  for (const width of [390, 360, 320]) {
    test(`календарь даты на ${width}px не выходит за экран`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await mockBookingFunnelApi(page);

      await page.goto('/s/graphite');
      await expect(page.getByText('KostAutoHub', { exact: false }).first()).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole('button', { name: 'Записаться' }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: /Тестовая услуга/ }).click();
      await dialog.getByRole('button', { name: 'Продолжить' }).click();
      await expect(dialog.locator('.days')).toBeVisible();

      const trigger = dialog.locator('#other-date');
      await expect(trigger).toBeVisible();
      expect(await dialog.locator('input[type="date"]').count()).toBe(0);
      await trigger.click();
      const pop = dialog.locator('.date-field__pop');
      await expect(pop).toBeVisible();
      const before = await trigger.textContent();

      const metrics = await page.evaluate(() => {
        const days = document.querySelector('.days') as HTMLElement;
        const otherDate = document.querySelector('#other-date') as HTMLElement;
        const calendar = document.querySelector('.date-field__pop') as HTMLElement;
        const sheet = document.querySelector('.sheet') as HTMLElement;
        const box = (el: HTMLElement) => el.getBoundingClientRect();
        const cells = Array.from(document.querySelectorAll('.date-field__day'));
        return {
          viewport: window.innerWidth,
          doc: document.documentElement.scrollWidth,
          daysScroll: days.scrollWidth,
          daysClient: days.clientWidth,
          dateLeft: box(otherDate).left,
          dateRight: box(otherDate).right,
          dateScroll: otherDate.scrollWidth,
          dateClient: otherDate.clientWidth,
          popLeft: box(calendar).left,
          popRight: box(calendar).right,
          popScroll: calendar.scrollWidth,
          popClient: calendar.clientWidth,
          sheetScroll: sheet.scrollWidth,
          sheetClient: sheet.clientWidth,
          sheetOverflowX: getComputedStyle(sheet).overflowX,
          bodyOverflow: document.body.style.overflow,
          cellsOutside: cells.filter((el) => {
            const r = el.getBoundingClientRect();
            return r.left < 0 || r.right > window.innerWidth + 1;
          }).length,
        };
      });
      expect(metrics.doc).toBeLessThanOrEqual(metrics.viewport);
      expect(metrics.daysScroll).toBeLessThanOrEqual(metrics.daysClient);
      expect(metrics.dateLeft).toBeGreaterThanOrEqual(0);
      expect(metrics.dateRight).toBeLessThanOrEqual(metrics.viewport);
      expect(metrics.dateScroll).toBeLessThanOrEqual(metrics.dateClient);
      expect(metrics.popLeft).toBeGreaterThanOrEqual(0);
      expect(metrics.popRight).toBeLessThanOrEqual(metrics.viewport);
      expect(metrics.popScroll).toBeLessThanOrEqual(metrics.popClient);
      expect(metrics.sheetScroll).toBeLessThanOrEqual(metrics.sheetClient);
      expect(metrics.sheetOverflowX).toBe('hidden');
      expect(metrics.bodyOverflow).toBe('hidden');
      expect(metrics.cellsOutside).toBe(0);

      const scrollBefore = await page.evaluate(() => window.scrollY);
      await pop.hover();
      await page.mouse.wheel(0, 200);
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

      await pop.locator('.date-field__day:not([disabled]):not(.sel)').first().click();
      await expect(pop).toHaveCount(0);
      expect(await trigger.textContent()).not.toBe(before);
    });
  }
});

test('service worker отдаётся как JavaScript и содержит ожидаемую версию кэша', async ({
  request,
}) => {
  const response = await request.get('/sw.js');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type'] ?? '').toMatch(/javascript/);

  const body = await response.text();
  expect(body).toContain('renvio-v2');
  expect(body).toMatch(/addEventListener\(\s*['"]push['"]/);
  expect(body).toMatch(/addEventListener\(\s*['"]notificationclick['"]/);
});

import { expect, test, type Page } from '@playwright/test';

const composer = (page: Page) => page.getByRole('textbox', { name: /сообщение для модели/i });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await page.reload();
});

test('весь сценарий проходится с клавиатуры, без мыши', async ({ page }) => {
  // Табом доходим до поля ввода — оно должно быть достижимо, а не
  // спрятано за декоративными элементами.
  await page.keyboard.press('Tab');
  for (let i = 0; i < 8; i++) {
    if (await composer(page).evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(composer(page)).toBeFocused();

  // Enter отправляет.
  await page.keyboard.type('#long вопрос с клавиатуры');
  await page.keyboard.press('Enter');
  await expect(page.locator('.message--user')).toHaveCount(1);

  // Esc останавливает — из поля ввода, не наводя мышь на кнопку.
  await expect(page.locator('.message--assistant .message__body')).not.toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(page.getByText(/остановлено вами/i)).toBeVisible();
});

test('Shift+Enter переносит строку, а не отправляет', async ({ page }) => {
  await composer(page).click();
  await page.keyboard.type('первая строка');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('вторая строка');

  await expect(page.locator('.message--user')).toHaveCount(0);
  await expect(composer(page)).toHaveValue('первая строка\nвторая строка');
});

test('фокус виден при навигации с клавиатуры и не виден при клике мышью', async ({ page }) => {
  // Это и есть пушбек к требованию ТЗ убрать outline: дефолтной
  // обводки нет, но своё кольцо на :focus-visible обязано быть.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');

  const focused = page.locator(':focus-visible');
  await expect(focused).toHaveCount(1);
  const ring = await focused.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(ring).not.toBe('none');

  // Клик мышью кольцо не рисует — иначе интерфейс пестрел бы
  // обводками при обычной работе.
  //
  // Проверяем на кнопке, а не на поле ввода: текстовые поля по
  // спецификации матчат :focus-visible всегда, потому что принимают
  // ввод с клавиатуры. Разница между мышью и Tab видна именно на
  // кнопках — там она и важна.
  await page.getByRole('button', { name: /тёмная тема/i }).click();
  await expect(page.locator('.theme__option:focus-visible')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /тёмная тема/i })).toBeFocused();
});

test('разметка семантичная, а не div-каша', async ({ page }) => {
  await composer(page).fill('привет');
  await composer(page).press('Enter');
  await expect(page.getByRole('button', { name: /^перегенерировать$/i })).toBeVisible({
    timeout: 30_000,
  });

  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('header')).toHaveCount(1);
  await expect(page.locator('footer')).toHaveCount(1);
  await expect(page.locator('form')).toHaveCount(1);
  // Лента — список, а не набор блоков.
  await expect(page.locator('ol.messages > li.message')).toHaveCount(2);
  // Поле ввода подписано, хоть подпись и не видна.
  await expect(composer(page)).toHaveAttribute('id', 'composer-input');
});

test('живой регион висит только на том ответе, который сейчас пишется', async ({ page }) => {
  await composer(page).fill('#long длинный ответ');
  await composer(page).press('Enter');

  await expect(page.locator('.message__body[aria-live="polite"]')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // Генерация кончилась — регион снят, иначе скринридер после
  // перезагрузки получил бы пачку живых регионов разом.
  await expect(page.locator('.message__body[aria-live="polite"]')).toHaveCount(0);
});

test('ошибка объявляется сразу, а не ждёт, пока до неё дойдут табом', async ({ page }) => {
  await composer(page).fill('#429');
  await composer(page).press('Enter');

  await expect(page.getByRole('alert')).toBeVisible();
});

test('на узком экране ничего не уезжает по горизонтали', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 720 });
  await composer(page).fill('#long проверка ширины');
  await composer(page).press('Enter');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);

  // Тач-таргеты не меньше 44px — иначе пальцем не попасть.
  const send = page.getByRole('button', { name: /^отправить$/i });
  const box = await send.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

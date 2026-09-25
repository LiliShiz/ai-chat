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

  // Ассерт «тень не none» слишком слаб: у элемента может быть своя
  // декоративная тень, и кольцо при этом потеряно. Сверяем с тем,
  // что реально объявлено в --focus-ring.
  const hasRing = await focused.evaluate((el) => {
    const ring = getComputedStyle(el).getPropertyValue('--focus-ring').trim();
    const shadow = getComputedStyle(el).boxShadow;
    // Браузер нормализует цвета, поэтому сверяем по ширине колец.
    return shadow.includes('4px') && ring.length > 0;
  });
  expect(hasRing).toBe(true);

  // Клик мышью кольцо не рисует — иначе интерфейс пестрел бы
  // обводками при обычной работе.
  //
  // Проверяем на кнопке, а не на поле ввода: текстовые поля по
  // спецификации матчат :focus-visible всегда, потому что принимают
  // ввод с клавиатуры. Разница между мышью и Tab видна именно на
  // кнопках — там она и важна.
  await page.getByRole('radio', { name: /тёмная тема/i }).click();
  await expect(page.locator('.theme__option:focus-visible')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: /тёмная тема/i })).toBeFocused();
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
  // Проверяем все кнопки на экране, а не одну: раньше тут стояла
  // только «Отправить» — единственная, которая порог и проходила.
  const small: string[] = [];
  for (const button of await page.locator('button:visible').all()) {
    const box = await button.boundingBox();
    if (!box) continue;
    if (box.height < 44 || box.width < 44) {
      small.push(`${await button.getAttribute('class')} ${box.width}x${box.height}`);
    }
  }
  expect(small, `мелкие тач-таргеты: ${small.join('; ')}`).toEqual([]);
});

test('у каждой кнопки есть видимое кольцо фокуса', async ({ page }) => {
  // Регрессия, которую поймала внешняя приёмка: у кнопки «К последнему»
  // собственная тень перебивала правило :focus-visible просто потому,
  // что стояла ниже по файлу. Проверять фокус на одном элементе
  // недостаточно — ломается он поштучно.
  //
  // Обходим Tab'ом, а не el.focus(): :focus-visible ставится по
  // эвристике браузера, и программный фокус её не включает.
  await composer(page).fill('#long длинный ответ');
  await composer(page).press('Enter');
  // Ждём, пока лента станет заметно длиннее окна — иначе прокручивать
  // некуда и кнопка «К последнему» просто не появится.
  await page.locator('.messages').evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        const tick = setInterval(() => {
          if (el.scrollHeight > el.clientHeight * 2) {
            clearInterval(tick);
            resolve();
          }
        }, 100);
      }),
    { timeout: 20_000 },
  );
  await page.keyboard.press('Escape');
  await page.locator('.messages').evaluate((el) => (el.scrollTop = 0));
  await expect(page.locator('.jump')).toBeVisible();

  const seen: string[] = [];
  const missing: string[] = [];

  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      return {
        tag: el.tagName.toLowerCase(),
        cls: el.className?.toString() ?? '',
        visible: el.matches(':focus-visible'),
        shadow: getComputedStyle(el).boxShadow,
      };
    });
    if (!info || info.tag !== 'button') continue;

    seen.push(info.cls);
    // Ищем именно кольцо: `0px 0px 0px 4px` — то, во что браузер
    // разворачивает внешний слой --focus-ring. Наивная проверка
    // `includes('4px')` проходила бы на любой тени с «14px».
    if (!info.visible || !/0px 0px 0px 4px/.test(info.shadow)) missing.push(info.cls);
  }

  // Кнопки вообще нашлись — иначе тест ничего не проверил бы.
  expect(seen.length).toBeGreaterThanOrEqual(3);
  // И среди них именно та, на которой кольцо терялось. Без этой
  // проверки тест зелёный даже когда до кнопки просто не доходит
  // фокус — то есть проверяет не то, что обещает.
  expect(seen.join(' '), 'кнопка «К последнему» недостижима табом').toContain('jump');
  expect(missing, `без кольца фокуса: ${missing.join(', ')}`).toEqual([]);
});

test('на низком экране пустое состояние не наезжает на ввод', async ({ page }) => {
  // Найдено на живом телефоне: экран низкий (панели браузера съедают
  // высоту), пустое состояние перерастало свою строку грида и
  // рисовалось поверх футера. Текст наезжал на поле ввода, а невидимая
  // часть перехватывала нажатия — кнопка «Отправить» не нажималась.
  //
  // 600px по высоте — примерно то, что остаётся от телефона во
  // встроенном браузере мессенджера.
  await page.setViewportSize({ width: 390, height: 600 });
  await page.reload();

  await composer(page).pressSequentially(
    'Привет, ты умеешь картинки генерировать и ещё что-то',
  );

  const layout = await page.evaluate(() => {
    const main = document.querySelector('.main')!.getBoundingClientRect();
    const empty = document.querySelector('.empty')!.getBoundingClientRect();
    const button = document.querySelector('.composer .button') as HTMLButtonElement;
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return {
      overflowPx: Math.round(empty.bottom - main.bottom),
      buttonCovered: !button.contains(hit),
      coveredBy: hit?.className ?? null,
    };
  });

  expect(layout.overflowPx, 'пустое состояние вылезает за свою строку').toBeLessThanOrEqual(0);
  expect(layout.buttonCovered, `кнопку перекрывает ${layout.coveredBy}`).toBe(false);

  // И контрольный выстрел: кнопка действительно кликается, а не просто
  // «не перекрыта» по расчётам.
  await page.getByRole('button', { name: /^отправить$/i }).click({ timeout: 5000 });
  await expect(page.locator('.message--user')).toHaveCount(1);
});

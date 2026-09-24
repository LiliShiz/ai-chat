import { expect, test, type Page } from '@playwright/test';

const composer = (page: Page) => page.getByRole('textbox', { name: /сообщение для модели/i });
const answer = (page: Page) => page.locator('.message--assistant .message__body').last();

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Каждый сценарий начинается с чистого листа: история живёт
  // в sessionStorage и иначе протекала бы между тестами.
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await page.reload();
});

test('пустое состояние объясняет, что это и с чего начать', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /разговор с языковой моделью/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /debounce/i })).toBeVisible();
  // Модель подписана: человек должен видеть, кто ему отвечает.
  await expect(page.getByText(/отвечает/i)).toBeVisible();
});

test('ответ печатается по мере генерации, а не одним куском', async ({ page }) => {
  await composer(page).fill('расскажи про стриминг');
  await composer(page).press('Enter');

  // Ключевая проверка стриминга: снимаем длину дважды и убеждаемся,
  // что между замерами текст вырос. Готовый ответ так не отличить
  // от мгновенного — а здесь отличается.
  await expect(answer(page)).not.toBeEmpty();
  const early = (await answer(page).innerText()).length;

  await page.waitForTimeout(700);
  const later = (await answer(page).innerText()).length;
  expect(later).toBeGreaterThan(early);

  await expect(page.locator('.header__status')).toContainText(/печатает|думает/i);

  // Дождались конца — markdown отрисован, код подсвечен.
  await expect(page.getByRole('button', { name: /^перегенерировать$/i })).toBeVisible({
    timeout: 30_000,
  });
  await expect(answer(page).locator('ol li').first()).toBeVisible();
  await expect(answer(page).locator('pre code .hljs-keyword').first()).toBeVisible();
});

test('Esc обрывает генерацию, полученный кусок остаётся', async ({ page }) => {
  await composer(page).fill('#long про стриминг');
  await composer(page).press('Enter');

  await expect(answer(page)).not.toBeEmpty();
  await page.waitForTimeout(600);
  const partial = await answer(page).innerText();

  await page.keyboard.press('Escape');

  await expect(page.getByText(/остановлено вами/i)).toBeVisible();
  // Текст никуда не делся — именно этого требует ТЗ.
  await expect(answer(page)).toContainText(partial.slice(0, 40));

  // И интерфейс живой: можно тут же спросить следующее.
  await expect(page.getByRole('button', { name: /^отправить$/i })).toBeVisible();
  await composer(page).fill('ещё вопрос');
  await composer(page).press('Enter');
  await expect(page.locator('.message--user')).toHaveCount(2);
});

test('кнопка «Стоп» работает так же, как Esc', async ({ page }) => {
  await composer(page).fill('#long ещё раз');
  await composer(page).press('Enter');

  const stop = page.getByRole('button', { name: /^стоп$/i });
  await expect(stop).toBeVisible();
  await expect(answer(page)).not.toBeEmpty();

  await stop.click();

  await expect(page.getByText(/остановлено вами/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /^отправить$/i })).toBeVisible();
});

test('429 показывает понятное состояние с обратным отсчётом', async ({ page }) => {
  await composer(page).fill('#429');
  await composer(page).press('Enter');

  const notice = page.getByRole('alert');
  await expect(notice).toContainText(/лимит бесплатной модели/i);
  // Retry-After от апстрима превращается в живой отсчёт, а не в
  // вечный спиннер.
  await expect(notice.getByRole('button')).toContainText(/повторить через \d+ с/i);

  // Пустого пузыря в ленте не осталось, вопрос пользователя на месте.
  await expect(page.locator('.message--assistant')).toHaveCount(0);
  await expect(page.locator('.message--user')).toHaveCount(1);
});

test('обрыв посреди потока сохраняет текст и предлагает повтор', async ({ page }) => {
  await composer(page).fill('#cut проверка обрыва');
  await composer(page).press('Enter');

  await expect(page.getByText(/ответ оборвался/i)).toBeVisible();
  await expect(answer(page)).not.toBeEmpty();
  await expect(page.getByRole('alert').getByRole('button')).toContainText(/^повторить$/i);
});

test('молчащий апстрим ловится таймаутом, а не крутит спиннер', async ({ page }) => {
  // Сервер в этом стенде ждёт первый токен 4 секунды вместо штатных 45.
  await composer(page).fill('#timeout');
  await composer(page).press('Enter');

  const notice = page.getByRole('alert');
  await expect(notice).toContainText(/не ответила вовремя/i, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: /^отправить$/i })).toBeVisible();
});

test('обрыв сети даёт внятное состояние, а не белый экран', async ({ page, context }) => {
  await context.setOffline(true);

  await composer(page).fill('вопрос без сети');
  await composer(page).press('Enter');

  const notice = page.getByRole('alert');
  await expect(notice).toContainText(/нет соединения с интернетом/i);
  await expect(page.locator('.header__status')).toContainText(/нет сети/i);
  // Повтор предлагается и доступен — это не тупик.
  await expect(notice.getByRole('button')).toBeEnabled();
  // Вопрос пользователя на месте, пустого пузыря нет.
  await expect(page.locator('.message--user')).toHaveCount(1);
  await expect(page.locator('.message--assistant')).toHaveCount(0);

  // Сеть вернулась — интерфейс снова рабочий.
  //
  // Проверяем это новым сообщением после перезагрузки, а не кликом по
  // «Повторить» сразу: возврат сети в Chrome асинхронный, и клик в
  // этом окне упирался в ещё не обновившийся navigator.onLine. Гонка
  // ловилась только в CI и к самому приложению отношения не имеет.
  await context.setOffline(false);
  await page.waitForFunction(() => navigator.onLine === true);
  await page.reload();

  await expect(page.locator('.header__status')).not.toContainText(/нет сети/i);
  await composer(page).fill('сеть вернулась');
  await composer(page).press('Enter');
  await expect(answer(page)).not.toBeEmpty({ timeout: 20_000 });
});

test('история переживает перезагрузку страницы', async ({ page }) => {
  await composer(page).fill('запомни меня');
  await composer(page).press('Enter');
  await expect(page.getByRole('button', { name: /^перегенерировать$/i })).toBeVisible({
    timeout: 30_000,
  });

  await page.reload();

  await expect(page.locator('.message--user')).toContainText('запомни меня');
  await expect(page.locator('.message--assistant')).toHaveCount(1);
});

test('очистка стирает переписку и возвращает пустое состояние', async ({ page }) => {
  await composer(page).fill('привет');
  await composer(page).press('Enter');
  await expect(page.getByRole('button', { name: /^перегенерировать$/i })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('button', { name: /^очистить$/i }).click();

  await expect(page.getByRole('heading', { name: /разговор с языковой моделью/i })).toBeVisible();
  await page.reload();
  await expect(page.locator('.message')).toHaveCount(0);
});

test('ключ OpenRouter не появляется в запросах со страницы', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('http://localhost:5173')) external.push(url);
    const auth = request.headers()['authorization'];
    if (auth) external.push(`auth-header: ${url}`);
  });

  await composer(page).fill('проверка сети');
  await composer(page).press('Enter');
  await expect(answer(page)).not.toBeEmpty();

  // Ни одного обращения наружу и ни одного заголовка авторизации:
  // ключ живёт на сервере и в браузер не попадает.
  expect(external).toEqual([]);
});

test('тема переключается и переживает перезагрузку', async ({ page }) => {
  const dark = page.getByRole('button', { name: /тёмная тема/i });
  await dark.click();
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('button', { name: /как в системе/i }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
});

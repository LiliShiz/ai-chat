/**
 * Гейт на бэкенд перед прогоном.
 *
 * `webServer` в конфиге умеет ждать один адрес, и это Vite. Но стенд
 * поднимает три процесса, и если не встал прокси, падение выглядит
 * как полтора десятка «элемент не найден» — по такому отчёту ищешь
 * причину полчаса. Поэтому ждём здесь и, если не дождались, говорим
 * прямым текстом, что именно мертво.
 */
const HEALTH = 'http://localhost:8787/api/health';
const VITE = 'http://localhost:5173/';
const TIMEOUT_MS = 90_000;

export default async function globalSetup(): Promise<void> {
  await waitFor(HEALTH, 'прокси (8787)');
  await waitFor(VITE, 'Vite (5173)');
  await assertMockUpstream();
}

/**
 * Проверяем, что прокси смотрит на поддельный апстрим, а не на живой
 * OpenRouter.
 *
 * Иначе бывает так: на 8787 остался сервер от другого запуска, стенд
 * не смог занять порт, а health при этом отвечает — и половина тестов
 * падает загадочными 502 от настоящей модели. Один запрос с маркером
 * #429 отличает мок от живого апстрима за полсекунды.
 */
async function assertMockUpstream(): Promise<void> {
  const response = await fetch('http://localhost:8787/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: '#429' }] }),
  });
  const body = await response.text();

  if (!body.includes('"code":"rate_limit"')) {
    throw new Error(
      'На 8787 отвечает не поддельный апстрим. ' +
        'Скорее всего порт занял сервер от другого запуска, и стенд не смог подняться. ' +
        `Ответ на маркер #429: ${body.slice(0, 200)}`,
    );
  }
}

async function waitFor(url: string, what: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastError = 'нет ответа';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `Стенд не поднялся: ${what} не отвечает на ${url} за ${TIMEOUT_MS / 1000} с ` +
      `(последняя ошибка: ${lastError}).\n` +
      `Тесты не запускались — падать на ассертах в такой ситуации бессмысленно.`,
  );
}

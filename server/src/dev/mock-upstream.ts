/**
 * Поддельный OpenRouter для разработки и демонстрации.
 *
 * Зачем он есть. Аварии из ТЗ — 429, таймаут, обрыв сети — на живом апстриме
 * воспроизводятся случайно: 429 надо выловить, таймаут подождать, обрыв
 * устроить руками. Проверять обработку ошибок «когда повезёт» — не проверять
 * вовсе. Мок делает каждую аварию воспроизводимой одной строкой в чате.
 *
 * Запуск:  npm run dev:mock -w server
 * Затем:   OPENROUTER_BASE_URL=http://localhost:8788 npm run dev -w server
 * Или одной командой:  npm run dev:mock  (из корня)
 *
 * Сценарий выбирается маркером в тексте сообщения:
 *   #429      — апстрим отвечает 429 с Retry-After
 *   #timeout  — соединение открыто, но молчит (ловится сторожевым таймером)
 *   #cut      — несколько токенов и жёсткий обрыв посреди стрима
 *   #stall    — стрим начинается и замирает (проверка idle-таймера)
 *   #error    — ошибка приходит событием внутри уже открытого стрима
 *   #long     — очень длинный ответ, удобно жать «Стоп»
 *   (без маркера) — обычный ответ в несколько абзацев
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const app = new Hono();

const LOREM =
  'Хороший вопрос. Если коротко: **стриминг** нужен, чтобы человек видел ' +
  'первые слова через полсекунды, а не ждал абзац целиком.\n\n' +
  'Разберём по шагам:\n\n' +
  '1. Сервер держит ключ у себя и проксирует запрос.\n' +
  '2. Ответ приходит потоком SSE и ретранслируется как есть.\n' +
  '3. Клиент дорисовывает текст по мере поступления.\n\n' +
  '```ts\nfor await (const chunk of stream) {\n  render(chunk);\n}\n```\n\n' +
  'Отмена при этом должна доходить до самого апстрима — иначе модель ' +
  'продолжит генерировать в пустоту и сожжёт квоту.';

app.post('/chat/completions', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const messages: { role: string; content: string }[] = body.messages ?? [];
  const last = messages.at(-1)?.content ?? '';

  if (last.includes('#429')) {
    return c.json(
      { error: { code: 429, message: 'Rate limit exceeded: free-models-per-day' } },
      429,
      { 'Retry-After': '17' },
    );
  }

  if (last.includes('#timeout')) {
    // Держим соединение открытым и не отвечаем — ровно то, что делает
    // перегруженная бесплатная модель. Сработает FIRST_TOKEN_TIMEOUT_MS.
    return new Response(new ReadableStream({ start() {} }), {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const text = last.includes('#long') ? LOREM.repeat(6) : LOREM;
  const mode = last.includes('#cut')
    ? 'cut'
    : last.includes('#stall')
      ? 'stall'
      : last.includes('#error')
        ? 'error'
        : 'ok';

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (payload: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      // Бьём на «токены» примерно как настоящая модель — по слову.
      const tokens = text.match(/\S+\s*/g) ?? [];

      for (const [index, token] of tokens.entries()) {
        if (mode === 'cut' && index === 12) {
          // Жёсткий обрыв: клиент получает ошибку чтения, а не корректный конец.
          controller.error(new Error('mock: connection reset'));
          return;
        }
        if (mode === 'error' && index === 12) {
          send({ error: { code: 429, message: 'mock: limit hit mid-stream' } });
          controller.close();
          return;
        }
        if (mode === 'stall' && index === 12) {
          return; // Замолчали навсегда — сработает IDLE_TIMEOUT_MS.
        }

        send({ choices: [{ delta: { content: token } }] });
        await sleep(mode === 'ok' ? 28 : 45);
      }

      send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const port = Number(process.env.MOCK_PORT ?? 8788);
serve({ fetch: app.fetch, port }, () => {
  console.log(`[mock] поддельный OpenRouter: http://localhost:${port}`);
  console.log('[mock] маркеры: #429 #timeout #cut #stall #error #long');
});

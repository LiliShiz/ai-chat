import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { config } from './config.js';
import { streamCompletion } from './openrouter.js';
import { encodeEvent, type ChatMessage } from './protocol.js';

export const app = new Hono();

// В dev фронт живёт на Vite (5173), сервер — на 8787. В проде отдаём собранный
// фронт с того же origin, и CORS не нужен вовсе.
if (!config.isProduction) {
  app.use('/api/*', cors({ origin: config.devOrigin }));
}

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    model: config.model,
    // Сам ключ, разумеется, не отдаём — только факт его наличия,
    // чтобы фронт мог показать внятное «сервер не настроен».
    configured: config.hasApiKey(),
  }),
);

app.post('/api/chat', async (c) => {
  if (!config.hasApiKey()) {
    return c.json(
      {
        code: 'config',
        message: 'На сервере не задан OPENROUTER_API_KEY. См. README.',
        retryable: false,
      },
      503,
    );
  }

  const messages = parseMessages(await c.req.json().catch(() => null));
  if ('error' in messages) {
    return c.json({ code: 'bad_request', message: messages.error, retryable: false }, 400);
  }

  const events = streamCompletion(messages.value, c.req.raw.signal);

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const encoder = new TextEncoder();
      try {
        const { value, done } = await events.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(encodeEvent(value)));
      } catch {
        controller.close();
      }
    },
    cancel() {
      // Клиент ушёл (нажал «Стоп» или закрыл вкладку) — сворачиваем генератор,
      // его finally оборвёт запрос к OpenRouter.
      void events.return(undefined as never);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Отключает буферизацию в nginx — иначе «стриминг» склеится в один кусок.
      'X-Accel-Buffering': 'no',
    },
  });
});

// Прод: собранный фронт с того же origin.
if (config.isProduction) {
  app.use('/*', serveStatic({ root: '../web/dist' }));
  app.get('/*', serveStatic({ path: '../web/dist/index.html' }));
}

function parseMessages(body: unknown): { value: ChatMessage[] } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Ожидается JSON-объект.' };

  const raw = (body as { messages?: unknown }).messages;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'Поле messages должно быть непустым массивом.' };
  }
  if (raw.length > config.maxMessages) {
    return { error: `Слишком длинная история: максимум ${config.maxMessages} сообщений.` };
  }

  const value: ChatMessage[] = [];
  for (const item of raw) {
    const role = (item as ChatMessage)?.role;
    const content = (item as ChatMessage)?.content;
    if (role !== 'user' && role !== 'assistant') {
      return { error: 'Допустимые роли: user, assistant.' };
    }
    if (typeof content !== 'string' || content.trim() === '') {
      return { error: 'Сообщение не может быть пустым.' };
    }
    if (content.length > config.maxMessageChars) {
      return { error: `Сообщение длиннее ${config.maxMessageChars} символов.` };
    }
    value.push({ role, content });
  }

  return { value };
}

import { afterEach, describe, expect, it, vi } from 'vitest';

import { streamChat } from './streamChat';
import type { Message } from '../types';

const ASK: Pick<Message, 'role' | 'content'>[] = [{ role: 'user', content: 'привет' }];

afterEach(() => {
  vi.restoreAllMocks();
  setOnline(true);
});

describe('чтение потока на клиенте', () => {
  it('собирает текст из кадров по мере поступления', async () => {
    // Куски намеренно не совпадают с границами кадров: сеть режет
    // поток где угодно.
    const whole =
      sse({ type: 'delta', text: 'Привет' }) +
      sse({ type: 'delta', text: ', мир' }) +
      sse({ type: 'done', reason: 'stop' });
    stubFetch([whole.slice(0, 20), whole.slice(20, 55), whole.slice(55)]);

    const chunks: string[] = [];
    const outcome = await streamChat(ASK, signal(), (t) => chunks.push(t));

    expect(chunks.join('')).toBe('Привет, мир');
    expect(outcome).toEqual({ status: 'done' });
  });

  it('отдаёт уже полученный текст, даже если поток кончился ошибкой', async () => {
    stubFetch([
      sse({ type: 'delta', text: 'начал' }),
      sse({
        type: 'error',
        error: { code: 'rate_limit', message: 'лимит', retryable: true, retryAfterSec: 12 },
      }),
    ]);

    const chunks: string[] = [];
    const outcome = await streamChat(ASK, signal(), (t) => chunks.push(t));

    expect(chunks.join('')).toBe('начал');
    expect(outcome).toMatchObject({
      status: 'error',
      error: { code: 'rate_limit', retryAfterSec: 12 },
    });
  });

  it('отмену не считает ошибкой', async () => {
    // Пользователь сам нажал «Стоп» — красная плашка была бы враньём.
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        controller.abort();
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      }),
    );

    const outcome = await streamChat(ASK, controller.signal, () => {});

    expect(outcome).toEqual({ status: 'aborted' });
  });

  it('разбирает ошибку, пришедшую HTTP-статусом', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ code: 'config', message: 'Нет ключа', retryable: false }), {
          status: 503,
        }),
      ),
    );

    const outcome = await streamChat(ASK, signal(), () => {});

    expect(outcome).toMatchObject({
      status: 'error',
      error: { code: 'config', message: 'Нет ключа', retryable: false },
    });
  });

  it('переживает статус без внятного тела', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502</html>', { status: 502 })));

    const outcome = await streamChat(ASK, signal(), () => {});

    expect(outcome).toMatchObject({ status: 'error', error: { code: 'upstream', retryable: true } });
  });

  it('при выключенной сети не ходит в сеть вовсе', async () => {
    setOnline(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await streamChat(ASK, signal(), () => {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'error', error: { code: 'offline' } });
  });

  it('пропускает битый кадр, не роняя весь ответ', async () => {
    stubFetch([
      'data: {сломано}\n\n',
      sse({ type: 'delta', text: 'дальше' }),
      sse({ type: 'done', reason: 'stop' }),
    ]);

    const chunks: string[] = [];
    await streamChat(ASK, signal(), (t) => chunks.push(t));

    expect(chunks.join('')).toBe('дальше');
  });
});

// ─────────────────────────── помощники ───────────────────────────

function sse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

function stubFetch(chunks: string[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    }),
  );
}

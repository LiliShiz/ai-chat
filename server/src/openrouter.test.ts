import { afterEach, describe, expect, it, vi } from 'vitest';

import { streamCompletion } from './openrouter.js';
import type { ChatMessage, ServerEvent } from './protocol.js';

const ASK: ChatMessage[] = [{ role: 'user', content: 'привет' }];

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('разбор потока', () => {
  it('склеивает кадры и отдаёт текст по кускам', async () => {
    mockUpstream([
      frame({ choices: [{ delta: { content: 'Привет' } }] }),
      frame({ choices: [{ delta: { content: ', мир' } }] }),
      frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n',
    ]);

    const events = await collect();

    expect(text(events)).toBe('Привет, мир');
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'stop' });
  });

  it('переживает кадр, разорванный между сетевыми чанками', async () => {
    // Апстрим не обязан присылать кадр целиком: TCP режет поток где
    // придётся. Если разбор этого не учитывает, текст теряется молча.
    const whole = frame({ choices: [{ delta: { content: 'целый' } }] });
    mockUpstream([whole.slice(0, 11), whole.slice(11), 'data: [DONE]\n\n']);

    expect(text(await collect())).toBe('целый');
  });

  it('игнорирует keep-alive комментарии апстрима', async () => {
    // OpenRouter шлёт ': OPENROUTER PROCESSING', пока модель в очереди.
    mockUpstream([
      ': OPENROUTER PROCESSING\n\n',
      frame({ choices: [{ delta: { content: 'ок' } }] }),
      'data: [DONE]\n\n',
    ]);

    const events = await collect();
    expect(text(events)).toBe('ок');
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0);
  });

  it('не падает на битом JSON, а пропускает кадр', async () => {
    mockUpstream([
      'data: {не json}\n\n',
      frame({ choices: [{ delta: { content: 'дальше' } }] }),
      'data: [DONE]\n\n',
    ]);

    expect(text(await collect())).toBe('дальше');
  });
});

describe('ошибки апстрима', () => {
  it('429 до начала генерации превращается в rate_limit с отсчётом', async () => {
    mockUpstream(null, {
      status: 429,
      headers: { 'Retry-After': '17' },
      body: JSON.stringify({ error: { message: 'Rate limit exceeded' } }),
    });

    const [event] = await collect();

    expect(event).toMatchObject({
      type: 'error',
      error: { code: 'rate_limit', retryAfterSec: 17, retryable: true },
    });
  });

  it('не выдаёт наружу, что проблема в ключе', async () => {
    mockUpstream(null, { status: 401, body: '{"error":{"message":"No auth credentials found"}}' });

    const [event] = await collect();

    expect(event).toMatchObject({ type: 'error', error: { code: 'config', retryable: false } });
    // Формулировка для пользователя не должна подсказывать, что именно
    // не так с серверными секретами.
    const message = (event as Extract<ServerEvent, { type: 'error' }>).error.message;
    expect(message).not.toMatch(/ключ|key|auth/i);
  });

  it('ошибка посреди потока приходит ПОСЛЕ уже отданного текста', async () => {
    // Главное свойство протокола: статус к этому моменту уже 200,
    // поэтому авария обязана приехать событием, иначе полученный
    // кусок ответа потеряется.
    mockUpstream([
      frame({ choices: [{ delta: { content: 'начал отвечать' } }] }),
      frame({ error: { code: 429, message: 'limit hit mid-stream' } }),
    ]);

    const events = await collect();

    expect(events[0]).toEqual({ type: 'delta', text: 'начал отвечать' });
    expect(events[1]).toMatchObject({ type: 'error', error: { code: 'rate_limit' } });
  });

  it('5xx отмечается как временная', async () => {
    mockUpstream(null, { status: 502, body: '' });

    const [event] = await collect();
    expect(event).toMatchObject({ type: 'error', error: { code: 'upstream', retryable: true } });
  });
});

describe('отмена и таймауты', () => {
  it('«Стоп» посреди генерации завершает поток молча, без ошибки', async () => {
    // Пользователь сам прервал генерацию — это не авария, и красная
    // плашка была бы враньём. Апстрим при отмене рвёт тело с ошибкой:
    // именно её и нужно проглотить, отличив от настоящего обрыва.
    const controller = new AbortController();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          start(streamController) {
            streamController.enqueue(
              encoder.encode(frame({ choices: [{ delta: { content: 'раз' } }] })),
            );
            // Клиент жмёт «Стоп» после первого токена.
            setTimeout(() => controller.abort(), 0);
            init?.signal?.addEventListener(
              'abort',
              () => streamController.error(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          },
        });
        return new Response(body, { status: 200 });
      }),
    );

    const events = await collect(controller.signal);

    expect(text(events)).toBe('раз');
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0);
    // И никакого 'done' тоже: ответ не закончился, его прервали.
    expect(events.filter((e) => e.type === 'done')).toHaveLength(0);
  });

  it('«Стоп» до первого байта тоже не считается аварией', async () => {
    // Здесь падает сам fetch, а не чтение тела — ветка другая.
    const controller = new AbortController();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controller.abort();
        throw new DOMException('Aborted', 'AbortError');
      }),
    );

    expect(await collect(controller.signal)).toEqual([]);
  });

  it('настоящий обрыв тела, наоборот, доезжает ошибкой', async () => {
    // Контрольный к двум предыдущим: без сигнала отмены тот же самый
    // разрыв обязан превратиться в событие ошибки, иначе клиент решит,
    // что ответ просто закончился.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const encoder = new TextEncoder();
        let served = false;
        // pull, а не start: так кадр гарантированно доезжает до
        // читателя раньше обрыва, и тест не зависит от гонки.
        const body = new ReadableStream<Uint8Array>({
          pull(streamController) {
            if (served) {
              streamController.error(new Error('connection reset'));
              return;
            }
            served = true;
            streamController.enqueue(
              encoder.encode(frame({ choices: [{ delta: { content: 'раз' } }] })),
            );
          },
        });
        return new Response(body, { status: 200 });
      }),
    );

    const events = await collect();

    expect(text(events)).toBe('раз');
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'upstream' } });
  });

  it('рвёт соединение с апстримом, когда клиент отвалился', async () => {
    // Иначе модель продолжает генерировать в пустоту и жечь квоту.
    const controller = new AbortController();
    let upstreamSignal: AbortSignal | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        upstreamSignal = init?.signal ?? undefined;
        controller.abort();
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      }),
    );

    await collect(controller.signal);

    expect(upstreamSignal?.aborted).toBe(true);
  });

  it('молчащий апстрим ловится сторожевым таймером', async () => {
    vi.useFakeTimers();

    // Соединение открыто, данных нет — ровно то, что делает
    // перегруженная бесплатная модель.
    mockUpstream([], undefined, undefined, { neverClose: true });

    const events: ServerEvent[] = [];
    const done = (async () => {
      for await (const event of streamCompletion(ASK, new AbortController().signal)) {
        events.push(event);
      }
    })();

    await vi.advanceTimersByTimeAsync(46_000);
    await done;

    expect(events).toEqual([
      { type: 'error', error: expect.objectContaining({ code: 'timeout', retryable: true }) },
    ]);
  });
});

// ─────────────────────────── помощники ───────────────────────────

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function text(events: ServerEvent[]): string {
  return events
    .filter((e): e is Extract<ServerEvent, { type: 'delta' }> => e.type === 'delta')
    .map((e) => e.text)
    .join('');
}

async function collect(signal = new AbortController().signal): Promise<ServerEvent[]> {
  const events: ServerEvent[] = [];
  for await (const event of streamCompletion(ASK, signal)) events.push(event);
  return events;
}

interface ErrorInit {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

/**
 * Подменяет апстрим. `chunks` — куски тела ровно в том виде, в каком
 * их «прислала» бы сеть: границы кусков намеренно не совпадают с
 * границами кадров.
 */
function mockUpstream(
  chunks: string[] | null,
  error?: ErrorInit,
  onFirstChunk?: () => void,
  options: { neverClose?: boolean } = {},
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (error) {
        return new Response(error.body, { status: error.status, headers: error.headers });
      }

      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks ?? []) controller.enqueue(encoder.encode(chunk));
          onFirstChunk?.();
          if (!options.neverClose) {
            controller.close();
            return;
          }

          // Настоящий fetch обрывает тело, когда сработал signal.
          // Без этого «молчащий апстрим» в тесте молчал бы вечно, и
          // сторожевой таймер нечего было бы проверять.
          init?.signal?.addEventListener(
            'abort',
            () => controller.error(init.signal?.reason ?? new Error('aborted')),
            { once: true },
          );
        },
      });

      return new Response(body, { status: 200 });
    }),
  );
}

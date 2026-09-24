import { config } from './config.js';
import type { ChatMessage, ChatErrorPayload, ServerEvent } from './protocol.js';

/**
 * Почему причина отмены — отдельный класс, а не строка в AbortSignal.reason:
 * нам надо отличить «клиент нажал Стоп» (это не ошибка, событий не шлём)
 * от «истёк таймаут» (это ошибка, её надо показать).
 */
class TimeoutAbort extends Error {
  constructor(readonly kind: 'first-token' | 'idle') {
    super(`timeout:${kind}`);
  }
}

const SYSTEM_PROMPT =
  'Ты — помощник в веб-чате. Отвечай по-русски, если пользователь пишет ' +
  'по-русски. Используй markdown для списков и кода.';

/**
 * Один запрос к OpenRouter, разобранный в наш поток событий.
 *
 * Генератор, а не колбэки: вызывающая сторона получает back-pressure бесплатно
 * и может прекратить чтение в любой момент — `finally` закроет апстрим.
 *
 * @param clientSignal сигнал отмены от HTTP-запроса браузера. Когда пользователь
 *   жмёт «Стоп», fetch на фронте прерывается → Hono абортит этот сигнал →
 *   мы рвём соединение с OpenRouter. Генерация реально прекращается, а не
 *   просто перестаёт отображаться.
 */
export async function* streamCompletion(
  messages: ChatMessage[],
  clientSignal: AbortSignal,
): AsyncGenerator<ServerEvent> {
  const upstream = new AbortController();

  // Ретрансляция отмены: клиент отвалился → рвём апстрим.
  const onClientAbort = () => upstream.abort(clientSignal.reason);
  if (clientSignal.aborted) onClientAbort();
  clientSignal.addEventListener('abort', onClientAbort, { once: true });

  // Сторожевой таймер. Перезаводится на каждом чанке: пока модель печатает —
  // соединение живое, даже если ответ длинный.
  let timer: NodeJS.Timeout | undefined;
  let timedOut: TimeoutAbort | undefined;
  const arm = (kind: 'first-token' | 'idle', ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = new TimeoutAbort(kind);
      upstream.abort(timedOut);
    }, ms);
  };

  try {
    arm('first-token', config.firstTokenTimeoutMs);

    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: upstream.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          // OpenRouter просит эти заголовки для атрибуции трафика.
          'HTTP-Referer': 'http://localhost:5173',
          'X-Title': 'AI Chat (test assignment)',
        },
        body: JSON.stringify({
          model: config.model,
          stream: true,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        }),
      });
    } catch (cause) {
      if (clientSignal.aborted) return; // «Стоп» — молча выходим.
      yield { type: 'error', error: describeFailure(cause, timedOut) };
      return;
    }

    if (!response.ok || !response.body) {
      yield { type: 'error', error: await describeHttpError(response) };
      return;
    }

    let finishReason: 'stop' | 'length' | 'unknown' = 'unknown';
    let sawFirstToken = false;

    try {
      for await (const frame of readSseFrames(response.body)) {
        if (frame === '[DONE]') break;

        const parsed = parseFrame(frame);
        if (!parsed) continue;

        if (parsed.kind === 'error') {
          yield { type: 'error', error: parsed.error };
          return;
        }

        if (parsed.finishReason) finishReason = parsed.finishReason;

        if (parsed.text) {
          if (!sawFirstToken) sawFirstToken = true;
          yield { type: 'delta', text: parsed.text };
        }

        // Модель жива — сдвигаем дедлайн.
        arm('idle', sawFirstToken ? config.idleTimeoutMs : config.firstTokenTimeoutMs);
      }
    } catch (cause) {
      if (clientSignal.aborted) return;
      // Обрыв посреди стрима. Уже отданные delta фронт сохранит —
      // потому ошибка и приходит отдельным событием, а не HTTP-статусом.
      yield { type: 'error', error: describeFailure(cause, timedOut) };
      return;
    }

    yield { type: 'done', reason: finishReason };
  } finally {
    clearTimeout(timer);
    clientSignal.removeEventListener('abort', onClientAbort);
    upstream.abort();
  }
}

/** Разбор потока байтов в кадры SSE (содержимое строк `data:`). */
async function* readSseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });

    // Кадры разделены пустой строкой. \r\n — на случай прокси, нормализующих переводы строк.
    let boundary: number;
    while ((boundary = findBoundary(buffer)) !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary).replace(/^(\r?\n){2}/, '');

      const data = raw
        .split(/\r?\n/)
        // `: OPENROUTER PROCESSING` — keep-alive комментарии, их надо выкинуть.
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');

      if (data) yield data;
    }
  }
}

function findBoundary(buffer: string): number {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

type ParsedFrame =
  | { kind: 'delta'; text: string; finishReason?: 'stop' | 'length' | 'unknown' }
  | { kind: 'error'; error: ChatErrorPayload };

/** Форма кадра апстрима — ровно то, что мы из него читаем. */
interface UpstreamFrame {
  error?: { code?: number | string; message?: string };
  choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
}

function parseFrame(data: string): ParsedFrame | null {
  let json: UpstreamFrame;
  try {
    json = JSON.parse(data) as UpstreamFrame;
  } catch {
    return null; // Битый кадр — пропускаем, ломать стрим из-за него незачем.
  }

  // OpenRouter умеет присылать ошибку внутри уже открытого стрима.
  if (json.error) {
    const status = Number(json.error.code) || 0;
    return {
      kind: 'error',
      error: {
        code: status === 429 ? 'rate_limit' : 'upstream',
        message:
          status === 429
            ? 'Бесплатная модель упёрлась в лимит запросов. Попробуйте через минуту.'
            : `Модель вернула ошибку: ${json.error.message ?? 'без объяснений'}`,
        retryable: true,
      },
    };
  }

  const choice = json.choices?.[0];
  if (!choice) return null;

  const reason = choice.finish_reason;
  return {
    kind: 'delta',
    text: choice.delta?.content ?? '',
    finishReason:
      reason === 'stop' || reason === 'length' ? reason : reason ? 'unknown' : undefined,
  };
}

async function describeHttpError(response: Response): Promise<ChatErrorPayload> {
  const body = await response.text().catch(() => '');
  const detail = extractMessage(body);

  if (response.status === 429) {
    return {
      code: 'rate_limit',
      message: 'Бесплатная модель упёрлась в лимит запросов. Попробуйте чуть позже.',
      retryAfterSec: retryAfterSeconds(response.headers),
      retryable: true,
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      code: 'config',
      // Про ключ говорим обтекаемо: детали конфигурации сервера — не дело браузера.
      message: 'Сервер не может обратиться к модели. Проверьте настройки на стороне сервера.',
      retryable: false,
    };
  }

  if (response.status === 400 || response.status === 404) {
    return {
      code: 'bad_request',
      message: `Модель отклонила запрос${detail ? `: ${detail}` : ''}.`,
      retryable: false,
    };
  }

  return {
    code: 'upstream',
    message: `Модель временно недоступна (${response.status}).`,
    retryable: true,
  };
}

function describeFailure(cause: unknown, timedOut?: TimeoutAbort): ChatErrorPayload {
  if (timedOut) {
    return {
      code: 'timeout',
      message:
        timedOut.kind === 'first-token'
          ? 'Модель не ответила вовремя — бесплатные модели бывают перегружены.'
          : 'Ответ оборвался: модель замолчала посреди генерации.',
      retryable: true,
    };
  }

  return {
    code: 'upstream',
    message: 'Соединение с моделью прервалось.',
    retryable: true,
  };
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (raw) {
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber)) return Math.max(1, Math.ceil(asNumber));
  }

  // OpenRouter отдаёт момент сброса квоты в миллисекундах epoch.
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) {
    const seconds = Math.ceil((reset - Date.now()) / 1000);
    if (seconds > 0 && seconds < 3600) return seconds;
  }

  return undefined;
}

function extractMessage(body: string): string {
  try {
    const json = JSON.parse(body);
    return String(json?.error?.message ?? '').slice(0, 200);
  } catch {
    return '';
  }
}

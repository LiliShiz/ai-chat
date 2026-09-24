import type { ChatError, Message, ServerEvent } from '../types';

export type StreamOutcome =
  | { status: 'done' }
  /** Пользователь нажал «Стоп» — это не ошибка. */
  | { status: 'aborted' }
  | { status: 'error'; error: ChatError };

/**
 * Один поток ответа. Осознанно НЕ используется `EventSource`:
 * он умеет только GET и не даёт послать историю диалога телом запроса.
 * Поэтому fetch + ручной разбор SSE — заодно получаем `AbortSignal`,
 * без которого не сделать кнопку «Стоп».
 */
export async function streamChat(
  messages: Pick<Message, 'role' | 'content'>[],
  signal: AbortSignal,
  onDelta: (text: string) => void,
): Promise<StreamOutcome> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { status: 'error', error: OFFLINE };
  }

  let response: Response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
  } catch (cause) {
    if (signal.aborted) return { status: 'aborted' };
    return { status: 'error', error: networkError(cause) };
  }

  if (!response.ok || !response.body) {
    return { status: 'error', error: await readErrorBody(response) };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let outcome: StreamOutcome = { status: 'done' };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let split: number;
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);

        const event = parseEvent(frame);
        if (!event) continue;

        if (event.type === 'delta') onDelta(event.text);
        if (event.type === 'error') return { status: 'error', error: event.error };
        if (event.type === 'done') outcome = { status: 'done' };
      }
    }
  } catch (cause) {
    if (signal.aborted) return { status: 'aborted' };
    // Обрыв посреди чтения: уже отрисованный текст остаётся на экране,
    // потому что onDelta вызывался по ходу, а не в конце.
    return { status: 'error', error: networkError(cause) };
  } finally {
    // Отпускаем соединение: без этого «Стоп» закрыл бы вкладку-стрим не сразу.
    reader.cancel().catch(() => {});
  }

  return outcome;
}

function parseEvent(frame: string): ServerEvent | null {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');

  if (!data) return null;
  try {
    return JSON.parse(data) as ServerEvent;
  } catch {
    return null;
  }
}

async function readErrorBody(response: Response): Promise<ChatError> {
  try {
    const json = (await response.json()) as Partial<ChatError>;
    if (json?.message) {
      return {
        code: json.code ?? 'unknown',
        message: json.message,
        retryAfterSec: json.retryAfterSec,
        retryable: json.retryable ?? true,
      };
    }
  } catch {
    // Тело не JSON — упадём в общий случай ниже.
  }

  return {
    code: response.status === 429 ? 'rate_limit' : 'upstream',
    message: `Сервер ответил ошибкой ${response.status}.`,
    retryable: response.status >= 500 || response.status === 429,
  };
}

const OFFLINE: ChatError = {
  code: 'offline',
  message: 'Нет соединения с интернетом. Ответ придёт, как только сеть вернётся.',
  retryable: true,
};

function networkError(_cause: unknown): ChatError {
  // navigator.onLine врёт в одну сторону: false — точно нет сети,
  // true — ничего не гарантирует. Поэтому это подсказка, а не диагноз.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return OFFLINE;
  return {
    code: 'upstream',
    message: 'Связь с сервером прервалась. Проверьте, запущен ли сервер, и попробуйте снова.',
    retryable: true,
  };
}

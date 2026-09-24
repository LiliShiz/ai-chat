/**
 * Контракт между прокси и браузером.
 *
 * Сознательно НЕ повторяет формат OpenAI/OpenRouter: фронт не должен знать,
 * какой провайдер стоит за прокси. Сервер разбирает апстрим-SSE и отдаёт свой,
 * узкий и стабильный — три типа событий, ничего лишнего.
 */

/** Код ошибки. Фронт по нему выбирает текст и наличие кнопки «Повторить». */
export type ErrorCode =
  /** 429 от бесплатной модели: кончилась квота или превышен RPM. */
  | 'rate_limit'
  /** Модель не ответила вовремя (не начала или замолчала посреди стрима). */
  | 'timeout'
  /** Апстрим вернул 5xx или оборвал соединение. */
  | 'upstream'
  /** Кривой запрос от клиента. */
  | 'bad_request'
  /** Сервер не сконфигурирован (нет ключа). */
  | 'config'
  /** Всё остальное. */
  | 'unknown';

export interface ChatErrorPayload {
  code: ErrorCode;
  /** Человекочитаемый текст на русском — фронт показывает его как есть. */
  message: string;
  /** Для rate_limit: через сколько секунд имеет смысл повторить. */
  retryAfterSec?: number;
  /** Можно ли осмысленно нажать «Повторить». */
  retryable: boolean;
}

export type ServerEvent =
  /** Очередной кусочек текста ответа. */
  | { type: 'delta'; text: string }
  /** Генерация завершилась штатно. */
  | { type: 'done'; reason: 'stop' | 'length' | 'unknown' }
  /** Генерация оборвалась ошибкой. Может прийти ПОСЛЕ нескольких delta. */
  | { type: 'error'; error: ChatErrorPayload };

export type Role = 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
}

/** Сериализация одного события в кадр SSE. */
export function encodeEvent(event: ServerEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

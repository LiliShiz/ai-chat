/**
 * Зеркало `server/src/protocol.ts`.
 *
 * Дублирование осознанное: ради одного интерфейса поднимать общий пакет
 * в workspace — оверинжиниринг для проекта такого размера. Файлы маленькие
 * и лежат рядом; если контракт начнёт расти, его стоит вынести в `shared/`.
 */

export type ErrorCode =
  'rate_limit' | 'timeout' | 'upstream' | 'bad_request' | 'config' | 'offline' | 'unknown';

export interface ChatError {
  code: ErrorCode;
  message: string;
  retryAfterSec?: number;
  /**
   * Момент, когда повтор снова имеет смысл (epoch, мс).
   * Проставляется при получении ошибки: абсолютное время не врёт,
   * если вкладку свернули и таймеры притормозили, а заодно избавляет
   * интерфейс от вычисления «сейчас» во время рендера.
   */
  retryAt?: number;
  retryable: boolean;
}

export type ServerEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; reason: 'stop' | 'length' | 'unknown' }
  | { type: 'error'; error: ChatError };

export type Role = 'user' | 'assistant';

export interface Message {
  id: string;
  role: Role;
  content: string;
  /** Какая модель это написала — видно на каждом ответе, а не только в шапке. */
  model?: string;
  /** Ответ оборван пользователем — показываем пометку, текст сохраняем. */
  stopped?: boolean;
  /** Ответ оборван ошибкой — текст тоже сохраняем. */
  failed?: boolean;
}

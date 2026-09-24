import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Вся конфигурация сервера — в одном месте, читается из окружения.
 * Ключ OpenRouter существует только здесь и никогда не покидает процесс.
 */

/**
 * `.env` грузим кодом, а не флагом `--env-file-if-exists`.
 *
 * Флаг выглядит безопасным, но `node --watch` ставит наблюдение на
 * каждый переданный env-файл — и падает с ENOENT, если файла нет.
 * В CI его нет никогда, и сервер там не поднимался вовсе. Здесь же
 * отсутствие файла — просто отсутствие файла.
 */
const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Не задана переменная окружения ${name}. ` +
        `Скопируйте .env.example в .env и впишите ключ OpenRouter.`,
    );
  }
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: num('PORT', 8787),

  /** Ключ читается лениво, чтобы `/api/health` отвечал даже без него. */
  get apiKey(): string {
    return required('OPENROUTER_API_KEY');
  },

  hasApiKey: () => Boolean(process.env.OPENROUTER_API_KEY),

  /**
   * Бесплатная модель OpenRouter (суффикс `:free`).
   *
   * Каталог бесплатных моделей меняется: `deepseek-chat-v3-0324:free`,
   * стоявшая здесь раньше, уехала в платные прямо по ходу работы.
   * Поэтому значение вынесено в env — заменить можно без правки кода,
   * а актуальный список берётся из GET /api/v1/models с фильтром
   * по суффиксу `:free`.
   */
  model: process.env.OPENROUTER_MODEL ?? 'google/gemma-4-31b-it:free',

  baseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',

  /** Сколько ждём первый байт ответа модели. Бесплатные модели бывают в очереди. */
  firstTokenTimeoutMs: num('FIRST_TOKEN_TIMEOUT_MS', 45_000),

  /** Сколько ждём следующий чанк, если стрим уже начался и вдруг замолчал. */
  idleTimeoutMs: num('IDLE_TIMEOUT_MS', 30_000),

  /** Потолок на длину истории, уходящей в модель, — защита от разрастания запроса. */
  maxMessages: num('MAX_MESSAGES', 40),
  maxMessageChars: num('MAX_MESSAGE_CHARS', 8_000),

  /**
   * Потолок на тело запроса. Проверяется до разбора JSON: прокси стоит
   * без авторизации, и буферизовать что угодно из внешней сети нельзя.
   * С запасом над maxMessages × maxMessageChars.
   */
  maxBodyBytes: num('MAX_BODY_BYTES', 1_000_000),

  /** Origin фронта в dev-режиме: Vite поднимается отдельно от сервера. */
  devOrigin: process.env.DEV_ORIGIN ?? 'http://localhost:5173',

  isProduction: process.env.NODE_ENV === 'production',
} as const;

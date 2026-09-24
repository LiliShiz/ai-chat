import { serve } from '@hono/node-server';

import { app } from './app.js';
import { config } from './config.js';

/**
 * Точка входа. Приложение живёт в app.ts отдельно от запуска, чтобы
 * тесты могли дёргать маршруты через `app.fetch` без поднятия порта.
 */
serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`[server] http://localhost:${port}  модель: ${config.model}`);
  if (!config.hasApiKey()) {
    console.warn('[server] OPENROUTER_API_KEY не задан — /api/chat вернёт 503.');
  }
});

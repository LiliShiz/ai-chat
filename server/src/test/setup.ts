/**
 * Ключ нужен просто чтобы конфиг не бросил исключение: настоящих
 * запросов в тестах нет, fetch подменяется целиком.
 */
process.env.OPENROUTER_API_KEY = 'test-key-not-real';
process.env.OPENROUTER_MODEL = 'test/model:free';
process.env.OPENROUTER_BASE_URL = 'https://upstream.test/v1';

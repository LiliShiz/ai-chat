import { defineConfig, devices } from '@playwright/test';

/**
 * E2E гоняются против поддельного апстрима, а не живой модели.
 *
 * Причина та же, по которой мок вообще появился: на бесплатной модели
 * 429, таймаут и обрыв случаются когда повезёт, а тест должен падать
 * по делу, а не по настроению чужого сервиса. Маркеры в тексте
 * сообщения (#429, #timeout, #long) делают каждую аварию
 * воспроизводимой.
 *
 * Таймауты сервера в этом стенде занижены до 4 секунд — иначе тест на
 * молчащий апстрим ждал бы штатные 45.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Локально берём установленный Chrome: загрузка сборок
        // Playwright с их CDN доступна не отовсюду. В CI переменная
        // не задана, и используется штатный chromium.
        ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
      },
    },
  ],
  webServer: {
    command: 'npm run e2e:stack',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
  },
});

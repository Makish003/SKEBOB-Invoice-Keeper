import { defineConfig, devices } from '@playwright/test'

/**
 * E2E против изолированного стенда (compose.e2e.yml, http://localhost:8081): тестовые платежи не попадают
 * в рабочую/демо-базу на :8080. Поднять стенд: npm run e2e:up, удалить вместе с данными: npm run e2e:down.
 * Другой адрес (dev-сервер, staging): E2E_BASE_URL=http://127.0.0.1:5173 npm run test:e2e
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:8081'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
})

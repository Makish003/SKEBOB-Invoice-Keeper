import type { FullConfig } from '@playwright/test'

/** Падает сразу и понятно, если стенд не поднят, вместо 18 одинаковых таймаутов. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:8081'
  try {
    const response = await fetch(new URL('/api/v1/health', baseURL))
    if (response.ok) return
  } catch {
    // ниже — понятное сообщение
  }
  throw new Error(
    `E2E-стенд недоступен по ${baseURL}. Поднимите его: npm run e2e:up (или задайте E2E_BASE_URL).`,
  )
}

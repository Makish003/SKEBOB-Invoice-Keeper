import { expect, type Page, test } from '@playwright/test'
import { ADMIN, signIn } from './helpers'

/** Минимальная прозрачность первой карточки за 600 мс после переключения вкладки: вход карточек виден, если < 1. */
async function switchAndSample(page: Page, tab: RegExp) {
  await page.getByRole('radio', { name: tab }).click()
  return page.evaluate(async () => {
    const samples: number[] = []
    const start = performance.now()
    while (performance.now() - start < 600) {
      await new Promise(requestAnimationFrame)
      const card = document.querySelector('[aria-label="Периоды платежей"] > li')
      if (card) samples.push(Number(getComputedStyle(card).opacity))
    }
    return Math.min(...samples)
  })
}

test('карточки появляются с анимацией при каждом переключении вкладки, а не только при первом', async ({ page }) => {
  await signIn(page, ADMIN, '/login?next=/payments')
  await expect(page.getByRole('list', { name: 'Периоды платежей' }).getByRole('listitem').first()).toBeVisible()

  const tabs = [/Оплачено/, /Все/, /К оплате/]
  // Первый круг заполняет кеш запросов; второй — то, на что жаловались: данные уже есть, анимации не было.
  for (const tab of tabs) await switchAndSample(page, tab)
  for (const tab of tabs) {
    expect(await switchAndSample(page, tab), `вкладка ${tab}`).toBeLessThan(0.9)
  }
})

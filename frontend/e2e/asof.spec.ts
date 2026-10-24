import { expect, test } from '@playwright/test'
import { ADMIN, signIn } from './helpers'

test('итоги на дату: таблица по трём валютам и смена даты', async ({ page }) => {
  await signIn(page, ADMIN, '/login')
  await page.goto('/reports')
  const table = page.getByRole('table', { name: /Итоги на/ })
  await expect(table.getByRole('row')).toHaveCount(4)
  await expect(table.getByText('RUB')).toBeVisible()
  await expect(table.getByText('USD')).toBeVisible()
  await expect(table.getByText('EUR')).toBeVisible()
  const before = await table.getAttribute('aria-label')
  await page.locator('#as-of').click()
  await page.locator('[data-day] button').first().click()
  await expect(page.getByRole('table', { name: /Итоги на/ })).not.toHaveAttribute('aria-label', before ?? '')
})

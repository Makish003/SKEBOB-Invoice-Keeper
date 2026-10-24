import { expect, test } from '@playwright/test'
import { ADMIN, signIn } from './helpers'

test('итоги на дату: три валюты и смена даты', async ({ page }) => {
  await signIn(page, ADMIN, '/login')
  await page.goto('/reports')
  const totals = page.getByRole('group', { name: /Итоги на/ })
  await expect(totals.getByRole('region')).toHaveCount(3)
  await expect(totals.getByRole('region', { name: 'Итоги RUB' })).toBeVisible()
  await expect(totals.getByRole('region', { name: 'Итоги USD' })).toBeVisible()
  await expect(totals.getByRole('region', { name: 'Итоги EUR' })).toBeVisible()
  const before = await totals.getAttribute('aria-label')
  await page.locator('#as-of').click()
  await page.locator('[data-day] button').first().click()
  await expect(page.getByRole('group', { name: /Итоги на/ })).not.toHaveAttribute('aria-label', before ?? '')
})

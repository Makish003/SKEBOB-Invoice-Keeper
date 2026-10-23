import { expect, test } from '@playwright/test'
import { apiLogin, createPayment, isoFromToday } from './api'
import { ADMIN, signIn } from './helpers'

test('календарь: день с платежом, детали и отметка оплаты @mobile', async ({ page, request }) => {
  const token = await apiLogin(request, ADMIN)
  const name = `Календарь ${Date.now()}`
  await createPayment(request, token, { name, amount: '700.00', currency: 'RUB', daysFromToday: 0 })
  await signIn(page, ADMIN)
  await page.goto('/calendar')
  await expect(page.getByRole('heading', { name: 'Календарь оплат' })).toBeVisible()
  const today = isoFromToday(0)
  const day = Number(today.slice(8))
  await page.getByRole('gridcell', { name: new RegExp(`^${day} `) }).first().click()
  const item = page.locator('li').filter({ hasText: name })
  await expect(item.getByText('Срок сегодня')).toBeVisible()
  await item.getByRole('button', { name: 'Отметить оплату' }).click()
  await page.getByRole('dialog', { name: 'Отметить оплату' }).getByRole('button', { name: 'Отметить оплату' }).click()
  await expect(item.getByText('Оплачен', { exact: true })).toBeVisible()
  const before = await page.getByRole('grid').getAttribute('aria-label')
  await page.getByRole('button', { name: 'Следующий месяц' }).click()
  await expect(page.getByRole('grid')).toHaveCount(1)
  await expect(page.getByRole('grid')).not.toHaveAttribute('aria-label', before ?? '')
})

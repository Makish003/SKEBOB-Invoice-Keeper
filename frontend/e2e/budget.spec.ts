import { expect, test } from '@playwright/test'
import { ADMIN, signIn } from './helpers'

test('бюджет: админ задаёт месячный бюджет RUB, на сводке план против бюджета', async ({ page }) => {
  await signIn(page, ADMIN)
  const card = page.getByRole('region', { name: 'Бюджет RUB' })
  await page.getByRole('button', { name: 'Изменить' }).click()
  const dialog = page.getByRole('dialog', { name: 'Бюджет' })
  await dialog.getByLabel('На месяц').first().fill('5000000')
  await dialog.getByRole('button', { name: 'Сохранить бюджет' }).click()
  await expect(page.getByText('Бюджет сохранён')).toBeVisible()
  await expect(card.getByText(/из 5\s000\s000,00/)).toBeVisible()
  await expect(card.getByText(/Остаток/).first()).toBeVisible()
})

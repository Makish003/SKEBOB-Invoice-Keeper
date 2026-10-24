import { expect, test } from '@playwright/test'
import { ADMIN, signIn } from './helpers'

test('бюджет: админ задаёт месячный бюджет RUB в отчётах, на сводке виден остаток', async ({ page }) => {
  await signIn(page, ADMIN)
  await page.getByRole('link', { name: 'Отчёты' }).first().click()
  await expect(page).toHaveURL(/\/reports/)
  const card = page.getByRole('region', { name: 'Бюджет RUB' })
  await page.getByRole('button', { name: 'Изменить' }).click()
  const dialog = page.getByRole('dialog', { name: 'Бюджет' })
  await dialog.getByLabel('На месяц').first().fill('5000000')
  await dialog.getByRole('button', { name: 'Сохранить бюджет' }).click()
  await expect(page.getByText('Бюджет сохранён')).toBeVisible()
  await expect(card.getByText(/из 5\s000\s000,00/)).toBeVisible()
  await expect(card.getByText(/Остаток/).first()).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('region', { name: 'RUB' }).getByText(/бюджета 5\s000\s000,00/)).toBeVisible()
})

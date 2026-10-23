import { expect, test } from '@playwright/test'
import { ADMIN, signIn } from './helpers'

test('журнал: админ видит входы и действия, фильтр по категории', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Логин').fill('admin')
  await page.getByLabel('Пароль').fill('wrong-for-audit')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('alert')).toBeVisible()

  await signIn(page, ADMIN)
  await page.goto('/audit')
  await expect(page.getByRole('heading', { name: 'Журнал', level: 1 })).toBeVisible()
  await page.getByRole('radio', { name: 'Входы' }).click()
  const table = page.getByRole('table', { name: 'Журнал действий' })
  await expect(table.getByText('Вход в систему').first()).toBeVisible()
  await expect(table.getByText('Ошибка входа').first()).toBeVisible()
  await expect(table.getByText('Отмечена оплата')).toHaveCount(0)
})

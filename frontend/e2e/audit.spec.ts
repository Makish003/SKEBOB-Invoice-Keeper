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
  const log = page.getByRole('list', { name: 'Журнал действий' })
  await expect(log.getByText('Вход в систему').first()).toBeVisible()
  await expect(log.getByText('Ошибка входа').first()).toBeVisible()
  await expect(log.getByText('Отмечена оплата')).toHaveCount(0)
})

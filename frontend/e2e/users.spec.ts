import { expect, test } from '@playwright/test'
import { ADMIN, signIn, signOut } from './helpers'

test('админ создаёт пользователя; пользователь видит только свои разделы; после удаления вход закрыт', async ({ page }) => {
  const login = `e2e_${Date.now()}`
  const password = 'e2e-password-1'

  await signIn(page, ADMIN)
  await page.goto('/users')
  await expect(page.locator('tr').filter({ hasText: 'admin' }).getByText('Из .env')).toBeVisible()

  await page.getByRole('button', { name: 'Добавить пользователя' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Новый пользователь' })
  await dialog.getByLabel('Имя').fill('Тестовый Сотрудник')
  await dialog.getByLabel('Логин').fill('admin')
  await dialog.getByLabel('Пароль').fill(password)
  await dialog.getByRole('button', { name: 'Создать пользователя' }).click()
  await expect(dialog.getByText('Логин уже занят')).toBeVisible()
  await dialog.getByLabel('Логин').fill(login)
  await dialog.getByRole('button', { name: 'Создать пользователя' }).click()
  await expect(page.getByText('Пользователь создан')).toBeVisible()
  await signOut(page)

  await signIn(page, { login, password })
  await expect(page).toHaveURL(/\/payments$/)
  await expect(page.getByRole('link', { name: 'Пользователи' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Регулярные' })).toHaveCount(0)
  await page.goto('/users')
  await expect(page.getByText('Раздел доступен только администратору')).toBeVisible()
  await signOut(page)

  await signIn(page, ADMIN)
  await page.goto('/users')
  await page.locator('tr').filter({ hasText: login }).getByRole('button', { name: /Удалить/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить пользователя' }).click()
  await expect(page.getByText('Пользователь удалён')).toBeVisible()
  await signOut(page)

  await page.goto('/login')
  await page.getByLabel('Логин').fill(login)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('alert')).toContainText('Неверный логин или пароль')
})

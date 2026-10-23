import { expect, test } from '@playwright/test'
import { ADMIN, signIn, signOut } from './helpers'

test('без сессии панель недоступна: редирект на вход с возвратом @mobile', async ({ page }) => {
  await page.goto('/payments')
  await expect(page).toHaveURL(/\/login\?next=%2Fpayments/)
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
})

test('неверный пароль: понятная ошибка, без входа', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Логин').fill(ADMIN.login)
  await page.getByLabel('Пароль').fill('definitely-wrong')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('alert')).toContainText('Неверный логин или пароль')
  await expect(page).toHaveURL(/\/login/)
})

test('пустая форма: ошибки у полей', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByText('Введите логин')).toBeVisible()
  await expect(page.getByText('Введите пароль')).toBeVisible()
})

test('администратор входит, видит админ-разделы и выходит @mobile', async ({ page }) => {
  await signIn(page, ADMIN, '/login?next=/payments')
  await expect(page).toHaveURL(/\/payments$/)
  await expect(page.getByRole('heading', { name: 'Платежи', level: 1 })).toBeVisible()
  if (await page.getByRole('button', { name: 'Открыть меню' }).isVisible()) {
    await page.getByRole('button', { name: 'Открыть меню' }).click()
  }
  await expect(page.getByRole('link', { name: 'Пользователи' })).toBeVisible()
  await page.keyboard.press('Escape')
  await signOut(page)
  await page.goto('/payments')
  await expect(page).toHaveURL(/\/login/)
})

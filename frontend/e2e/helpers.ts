import { expect, type Page } from '@playwright/test'

export const ADMIN = { login: process.env.E2E_ADMIN_LOGIN ?? 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? 'admin12345' }
export const USER = { login: process.env.E2E_USER_LOGIN ?? 'user', password: process.env.E2E_USER_PASSWORD ?? 'user12345' }

export async function signIn(page: Page, who: { login: string; password: string }, path = '/login') {
  await page.goto(path)
  await page.getByLabel('Логин').fill(who.login)
  await page.getByLabel('Пароль').fill(who.password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

export async function signOut(page: Page) {
  const trigger = page.getByRole('button', { name: /Администратор|Пользователь/ }).first()
  if (!(await trigger.isVisible())) await page.getByRole('button', { name: 'Открыть меню' }).click()
  await page.getByRole('button', { name: /Администратор|Пользователь/ }).last().click()
  await page.getByRole('menuitem', { name: 'Выйти' }).click()
  await expect(page).toHaveURL(/\/login/)
}

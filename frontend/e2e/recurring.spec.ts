import { expect, test } from '@playwright/test'
import { isoFromToday } from './api'
import { ADMIN, signIn } from './helpers'

test('администратор добавляет платёж со сроком завтра, меняет сумму и прекращает его @mobile', async ({ page }) => {
  const name = `E2E Подписка ${Date.now()}`
  await signIn(page, ADMIN)
  await page.goto('/recurring')
  await page.getByRole('button', { name: 'Добавить платёж' }).first().click()

  const dialog = page.getByRole('dialog', { name: 'Новый регулярный платёж' })
  await dialog.getByRole('button', { name: 'Добавить платёж' }).click()
  await expect(dialog.getByText('Введите название')).toBeVisible()
  await expect(dialog.getByText('Выберите дату ближайшей оплаты')).toBeVisible()

  await dialog.getByLabel('Название').fill(name)
  await dialog.getByLabel('Сумма').fill('1500,5')
  await dialog.getByLabel('Сумма').blur()
  await expect(dialog.getByLabel('Сумма')).toHaveValue(/1\s500,50/)
  await dialog.getByRole('radio', { name: 'USD' }).click()

  const tomorrow = isoFromToday(1)
  await dialog.getByLabel('Дата ближайшей оплаты').click()
  if (tomorrow.slice(0, 7) !== isoFromToday(0).slice(0, 7)) {
    await page.getByRole('button', { name: /следующ|next/i }).click()
  }
  await page.locator(`[data-day="${tomorrow}"] button`).click()
  await expect(dialog.getByText('напоминание уйдёт сразу после сохранения')).toBeVisible()

  await dialog.getByRole('button', { name: 'Добавить платёж' }).click()
  await expect(page.getByText('Платёж добавлен')).toBeVisible()
  await expect(dialog).toBeHidden()

  const row = page.locator('tr:visible, li:visible').filter({ hasText: name })
  await expect(row).toContainText('1 500,50 $')
  await expect(row.getByText('Скоро срок')).toBeVisible()

  await row.getByRole('button', { name: `Действия: ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Изменить' }).click()
  const edit = page.getByRole('dialog', { name: 'Изменить платёж' })
  await edit.getByLabel('Сумма, USD').fill('1600')
  await expect(edit.getByText('Новая сумма применится к неоплаченным периодам')).toBeVisible()
  await edit.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Платёж изменён')).toBeVisible()
  await expect(row).toContainText('1 600,00 $')

  await row.getByRole('button', { name: `Действия: ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Прекратить' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('сохранятся в истории')
  await confirm.getByRole('button', { name: 'Прекратить платёж' }).click()
  await expect(page.getByText('Платёж прекращён')).toBeVisible()
  await expect(page.locator('tr:visible, li:visible').filter({ hasText: name })).toHaveCount(0)

  await page.getByRole('radio', { name: /Прекращённые/ }).click()
  await expect(page.locator('tr:visible, li:visible').filter({ hasText: name })).toBeVisible()
})

import { expect, test } from '@playwright/test'
import { apiLogin, createPayment } from './api'
import { ADMIN, signIn } from './helpers'

test('чек к оплате: ссылка и файл PDF', async ({ page, request }) => {
  const token = await apiLogin(request, ADMIN)
  const name = `Чек ${Date.now()}`
  await createPayment(request, token, { name, amount: '990.00', currency: 'RUB', daysFromToday: 5 })
  await signIn(page, ADMIN, '/login?next=/payments')
  await page.getByRole('searchbox', { name: 'Поиск по названию' }).fill(name)
  await page.getByRole('searchbox', { name: 'Поиск по названию' }).press('Enter')
  const row = page.locator('tr:visible').filter({ hasText: name }).filter({ hasText: 'Период 1' })

  await row.getByRole('button', { name: /^Чек:/ }).click()
  const pop = page.getByRole('dialog', { name: /^Чек:/ })
  await pop.getByLabel('Ссылка').fill('не ссылка')
  await pop.getByRole('button', { name: 'Сохранить ссылку' }).click()
  await expect(pop.getByText('Нужна ссылка вида https://')).toBeVisible()
  await pop.getByLabel('Ссылка').fill('https://bank.example.com/receipt/42')
  await pop.getByRole('button', { name: 'Сохранить ссылку' }).click()
  await expect(page.getByText('Ссылка на чек сохранена')).toBeVisible()

  await pop.getByLabel('Выбрать файл чека').setInputFiles({
    name: 'платёжка.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\n% test receipt\n'),
  })
  await expect(page.getByText('Чек прикреплён')).toBeVisible()
  const fileLink = pop.getByRole('link', { name: 'платёжка.pdf' })
  await expect(fileLink).toBeVisible()
  const response = await page.request.get((await fileLink.getAttribute('href'))!)
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toBe('application/pdf')
  await expect(row.getByRole('button', { name: /\(прикреплён\)/ })).toBeVisible()
})

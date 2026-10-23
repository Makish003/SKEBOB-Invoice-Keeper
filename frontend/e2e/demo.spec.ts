import { expect, type APIRequestContext, test } from '@playwright/test'
import { apiLogin, createPayment, isoFromToday } from './api'
import { ADMIN, USER, signIn, signOut } from './helpers'

/** Сценарий защиты (с.15): от входа администратора до следующего периода. */

async function ensureUser(request: APIRequestContext, adminToken: string) {
  const response = await request.post('/api/v1/users', {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { login: USER.login, password: USER.password, display_name: 'Иван Петров' },
  })
  expect([201, 409]).toContain(response.status())
}

async function waitReminderSent(request: APIRequestContext, token: string, paymentName: string) {
  await expect
    .poll(
      async () => {
        const response = await request.get('/api/v1/payment-occurrences', {
          headers: { Authorization: `Bearer ${token}` },
          params: { q: paymentName, limit: 5 },
        })
        const items = (await response.json()).items as { reminder_sent_at: string | null }[]
        return items.some((item) => item.reminder_sent_at)
      },
      { timeout: 30_000, intervals: [1_000] },
    )
    .toBe(true)
}

test('демо: платёж → напоминание → оплата пользователем → просрочка → исправление даты → следующий период', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000)
  const adminToken = await apiLogin(request, ADMIN)
  await ensureUser(request, adminToken)
  const name = `Демо аренда ${Date.now()}`
  const overdueName = `Демо сервер ${Date.now()}`
  await createPayment(request, adminToken, { name: overdueName, amount: '49.90', currency: 'USD', daysFromToday: -4 })

  // 1–2. Администратор входит и добавляет регулярный платёж со сроком завтра.
  await signIn(page, ADMIN)
  await page.goto('/recurring')
  await page.getByRole('button', { name: 'Добавить платёж' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Новый регулярный платёж' })
  await dialog.getByLabel('Название').fill(name)
  await dialog.getByLabel('Сумма').fill('85000')
  await dialog.getByLabel('Дата ближайшей оплаты').click()
  const tomorrow = isoFromToday(1)
  if (tomorrow.slice(0, 7) !== isoFromToday(0).slice(0, 7)) await page.getByRole('button', { name: /следующ|next/i }).click()
  await page.locator(`[data-day="${tomorrow}"] button`).click()
  await expect(dialog.getByText('напоминание уйдёт сразу')).toBeVisible()
  await dialog.getByRole('button', { name: 'Добавить платёж' }).click()
  await expect(page.getByText('Платёж добавлен')).toBeVisible()

  // 3. Напоминание отправлено воркером без ожидания планового тика (Telegram или лог воркера).
  await waitReminderSent(request, adminToken, name)
  await signOut(page)

  // 4. Пользователь входит и отмечает оплату.
  await signIn(page, USER)
  await expect(page).toHaveURL(/\/payments$/)
  await page.getByRole('searchbox', { name: 'Поиск по названию' }).fill(name)
  await page.getByRole('searchbox', { name: 'Поиск по названию' }).press('Enter')
  const row = page.locator('tr:visible').filter({ hasText: name }).filter({ hasText: 'Период 1' })
  await expect(row.getByText('Скоро срок')).toBeVisible()
  await row.getByRole('button', { name: 'Отметить оплату' }).click()
  await page.getByRole('dialog', { name: 'Отметить оплату' }).getByRole('button', { name: 'Отметить оплату' }).click()
  await expect(page.getByText(/Оплата отмечена/)).toBeVisible()

  // 5. Просроченный платёж: оплачен с опозданием.
  await page.getByRole('searchbox', { name: 'Поиск по названию' }).fill(overdueName)
  await page.getByRole('searchbox', { name: 'Поиск по названию' }).press('Enter')
  await page.getByRole('radio', { name: /Просрочено/ }).click()
  const overdueRow = page.locator('tr:visible').filter({ hasText: overdueName }).first()
  await expect(overdueRow.getByText('Просрочен')).toBeVisible()
  await overdueRow.getByRole('button', { name: 'Отметить оплату' }).click()
  await page.getByRole('dialog', { name: 'Отметить оплату' }).getByRole('button', { name: 'Отметить оплату' }).click()
  await page.getByRole('radio', { name: /Все/ }).click()
  const lateRow = page.locator('tr:visible').filter({ hasText: overdueName }).filter({ hasText: 'Период 1' })
  await expect(lateRow.getByText('Оплачен с опозданием')).toBeVisible()

  // 6. Исправить фактическую дату оплаты на дату срока: просрочка исчезает.
  await lateRow.getByRole('button', { name: /Исправить дату/ }).click()
  const fix = page.getByRole('dialog', { name: 'Исправить дату оплаты' })
  const due = isoFromToday(-4)
  if (due.slice(0, 7) !== isoFromToday(0).slice(0, 7)) await fix.getByRole('button', { name: /предыдущ|previous/i }).click()
  await fix.locator(`[data-day="${due}"] button`).click()
  await fix.getByRole('button', { name: 'Сохранить дату' }).click()
  await expect(lateRow.getByText('Оплачен', { exact: true })).toBeVisible()
  await expect(lateRow.getByText('позже срока')).toHaveCount(0)

  // 7. Следующий период того же платежа — отдельная строка со своим статусом.
  await page.getByRole('searchbox', { name: 'Поиск по названию' }).fill(name)
  await page.getByRole('searchbox', { name: 'Поиск по названию' }).press('Enter')
  const first = page.locator('tr:visible').filter({ hasText: name }).filter({ hasText: 'Период 1' })
  const second = page.locator('tr:visible').filter({ hasText: name }).filter({ hasText: 'Период 2' })
  await expect(first.getByText('Оплачен', { exact: true })).toBeVisible()
  await expect(second.getByText('Ожидает')).toBeVisible()
  await expect(second.getByRole('button', { name: 'Отметить оплату' })).toBeVisible()
})

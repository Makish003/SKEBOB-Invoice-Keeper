import { expect, test } from '@playwright/test'
import { ADMIN, signIn } from './helpers'
import { apiLogin, createPayment, isoFromToday } from './api'

test.describe('Платежи: отметка, отмена, исправление даты', () => {
  test('отметить просроченный период с опозданием, исправить дату, снять отметку @mobile', async ({ page, request }) => {
    const token = await apiLogin(request, ADMIN)
    const name = `E2E Хостинг ${Date.now()}`
    await createPayment(request, token, { name, amount: '120.50', currency: 'USD', daysFromToday: -5 })
    const dueIso = isoFromToday(-5)
    const dueLabel = dueIso.split('-').reverse().join('.') // строка первого периода — по сроку

    await signIn(page, ADMIN, '/login?next=/payments')
    await page.getByRole('searchbox', { name: 'Поиск по названию' }).fill(name)
    await page.getByRole('searchbox', { name: 'Поиск по названию' }).press('Enter')

    const row = page.getByRole('list', { name: 'Периоды платежей' }).getByRole('listitem').filter({ hasText: name }).filter({ hasText: dueLabel }).first()
    await expect(row.getByText('Просрочен')).toBeVisible()
    await expect(row.getByText('5 дней назад')).toBeVisible()

    // Отметить оплату сегодняшним днём (по умолчанию) — оплачен с опозданием.
    await row.getByRole('button', { name: 'Отметить оплату' }).click()
    const popover = page.getByRole('dialog', { name: 'Отметить оплату' })
    await expect(popover.getByText('Позже срока')).toBeVisible()
    await popover.getByRole('button', { name: 'Отметить оплату' }).click()
    await expect(page.getByText(/Оплата отмечена/)).toBeVisible()

    await page.getByRole('radio', { name: /Все/ }).click()
    const paidRow = page.getByRole('list', { name: 'Периоды платежей' }).getByRole('listitem').filter({ hasText: name }).filter({ hasText: dueLabel }).first()
    await expect(paidRow.getByText('Оплачен с опозданием')).toBeVisible()

    // Исправить фактическую дату на дату срока: просрочка пропадает.
    await paidRow.getByRole('button', { name: /Исправить дату/ }).click()
    const fix = page.getByRole('dialog', { name: 'Исправить дату оплаты' })
    if (dueIso.slice(0, 7) !== isoFromToday(0).slice(0, 7)) await fix.getByRole('button', { name: /предыдущ|previous/i }).click()
    await fix.locator(`[data-day="${dueIso}"] button`).click()
    await expect(fix.getByText('В срок')).toBeVisible()
    await fix.getByRole('button', { name: 'Сохранить дату' }).click()
    await expect(paidRow.getByText('Оплачен', { exact: true })).toBeVisible()
    await expect(paidRow.getByText('позже срока')).toHaveCount(0)

    // Снять отметку: снова просрочен, дата оплаты очищена.
    await paidRow.getByRole('button', { name: /Снять/ }).click()
    await expect(page.getByText('Отметка об оплате снята')).toBeVisible()
    await expect(paidRow.getByText('Просрочен')).toBeVisible()
  })
})

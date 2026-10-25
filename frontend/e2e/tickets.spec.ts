import { expect, test } from '@playwright/test'
import { apiLogin, createPayment } from './api'
import { ADMIN, USER, signIn, signOut } from './helpers'

test('заявка администратору: пользователь пишет из карточки платежа, админ отвечает, пользователь видит ответ', async ({ page, request }) => {
  const token = await apiLogin(request, ADMIN)
  const name = `Заявка ${Date.now()}`
  await createPayment(request, token, { name, amount: '1500.00', currency: 'RUB', daysFromToday: 4 })
  const description = `Оплатил «${name}», а период всё ещё к оплате`

  await signIn(page, USER, '/login?next=/payments')
  await page.getByRole('searchbox', { name: 'Поиск по названию' }).fill(name)
  await page.getByRole('searchbox', { name: 'Поиск по названию' }).press('Enter')
  await page.getByRole('button', { name: `Сообщить о проблеме: ${name}` }).first().click()

  const form = page.getByRole('dialog', { name: 'Новая заявка' })
  // Крестик закрытия в правом верхнем углу диалога (регрессия P-31: .ik-key перебивал absolute).
  // Замер после анимации появления (масштаб): опрашиваем, пока диалог не встанет на место.
  const cornerGap = async () => {
    const box = (await form.boundingBox())!
    const close = (await form.getByRole('button', { name: 'Закрыть' }).boundingBox())!
    return Math.max(close.y - box.y, box.x + box.width - (close.x + close.width))
  }
  await expect.poll(cornerGap).toBeLessThan(24)

  await expect(form.getByRole('combobox', { name: 'Тема' })).toHaveText('Ошибка в платеже')
  await expect(form.getByRole('list', { name: 'Приложенные платежи' })).toContainText(name)
  await form.getByRole('button', { name: 'Отправить заявку' }).click()
  await expect(form.getByText('Опишите вопрос или неполадку')).toBeVisible()
  await form.getByLabel('Описание').fill(description)
  await form.getByLabel('Выбрать файлы').setInputFiles({
    name: 'скриншот.png',
    mimeType: 'image/png',
    buffer: Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32)]),
  })
  await expect(form.getByRole('list', { name: 'Прикреплённые файлы' })).toContainText('скриншот.png')
  await form.getByRole('button', { name: 'Отправить заявку' }).click()

  await expect(page).toHaveURL(/\/tickets\?ticket=\d+/)
  const ticketId = new URL(page.url()).searchParams.get('ticket')
  const view = page.getByRole('dialog', { name: `№${ticketId}. Ошибка в платеже` })
  await expect(view.getByText(description)).toBeVisible()
  await expect(view.getByText('Новая')).toBeVisible()
  await expect(view.getByRole('link', { name: /скриншот\.png/ })).toBeVisible()
  await expect(view.getByText('Пока нет ответа')).toBeVisible()
  await view.getByRole('button', { name: 'Закрыть' }).click()
  await signOut(page)

  await signIn(page, ADMIN, '/login?next=/tickets')
  await expect(page.getByRole('link', { name: /Заявки.*новых/ })).toBeVisible()
  await page.getByRole('list', { name: 'Заявки' }).getByRole('button').filter({ hasText: `№${ticketId}` }).click()
  const admin = page.getByRole('dialog', { name: `№${ticketId}. Ошибка в платеже` })
  await expect(admin.getByRole('list').filter({ hasText: name })).toBeVisible()
  await admin.getByRole('radio', { name: 'Решена' }).click()
  await admin.getByLabel('Ответ пользователю').fill('Оплату нашли и отметили')
  await admin.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText(`Заявка №${ticketId}: решена`)).toBeVisible()
  await admin.getByRole('button', { name: 'Закрыть' }).click()
  await signOut(page)

  await signIn(page, USER, `/login?next=/tickets`)
  const row = page.getByRole('list', { name: 'Заявки' }).getByRole('button').filter({ hasText: `№${ticketId}` })
  await expect(row).toContainText('Решена')
  await expect(row).toContainText('Есть ответ')
  await row.click()
  await expect(page.getByRole('dialog').getByText('Оплату нашли и отметили')).toBeVisible()
})

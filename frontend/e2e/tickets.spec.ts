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
  const chat = page.getByRole('region', { name: `Заявка №${ticketId}` })
  const thread = chat.getByRole('list', { name: 'Сообщения' })
  await expect(thread.getByText(description)).toBeVisible()
  await expect(chat.getByText('Новая')).toBeVisible()
  await expect(thread.getByRole('link', { name: /скриншот\.png/ })).toBeVisible()
  await signOut(page)

  // Администратор: непрочитанная заявка в меню, отвечает в чат, ответ берёт заявку в работу.
  await signIn(page, ADMIN, '/login?next=/tickets')
  await expect(page.getByRole('link', { name: /Заявки.*непрочитанных/ })).toBeVisible()
  await page.getByRole('list', { name: 'Заявки' }).getByRole('button').filter({ hasText: `№${ticketId}` }).click()
  await expect(thread.getByRole('list', { name: 'Платежи' })).toContainText(name)
  await chat.getByLabel('Сообщение', { exact: true }).fill('Пришлите выписку из банка')
  await chat.getByLabel('Сообщение', { exact: true }).press('Enter')
  await expect(thread.getByText('Пришлите выписку из банка')).toBeVisible()
  await expect(chat.getByRole('combobox', { name: 'Статус заявки' })).toHaveText('В работе')
  await expect(page.getByRole('link', { name: /Заявки.*непрочитанных/ })).toHaveCount(0)
  await signOut(page)

  // Пользователь видит ответ, отвечает файлом.
  await signIn(page, USER, '/login?next=/tickets')
  const row = page.getByRole('list', { name: 'Заявки' }).getByRole('button').filter({ hasText: `№${ticketId}` })
  await expect(row).toContainText('Пришлите выписку из банка')
  await expect(row).toContainText('Есть непрочитанные')
  await row.click()
  await expect(thread.getByText('Пришлите выписку из банка')).toBeVisible()
  await chat.getByLabel('Выбрать файлы для сообщения').setInputFiles({
    name: 'выписка.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\n% statement\n'),
  })
  await chat.getByRole('button', { name: 'Отправить' }).click()
  await expect(thread.getByRole('link', { name: /выписка\.pdf/ })).toBeVisible()
  await signOut(page)

  // Администратор закрывает заявку статусом.
  await signIn(page, ADMIN, `/login?next=${encodeURIComponent(`/tickets?ticket=${ticketId}`)}`)
  await expect(thread.getByRole('link', { name: /выписка\.pdf/ })).toBeVisible()
  await chat.getByRole('combobox', { name: 'Статус заявки' }).click()
  await page.getByRole('option', { name: 'Решена' }).click()
  await expect(page.getByText(`Заявка №${ticketId}: решена`)).toBeVisible()
})

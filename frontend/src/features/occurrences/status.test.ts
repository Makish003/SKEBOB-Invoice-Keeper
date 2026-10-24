import { describe, expect, it } from 'vitest'
import type { Occurrence } from './api'
import { optimistic, unpaidStatus } from './status'

const base: Occurrence = {
  id: 1,
  recurring_payment: { id: 1, name: 'Аренда офиса', period: 'monthly', is_active: true },
  seq: 0,
  due_date: '2026-10-20',
  amount: '85000.00',
  currency: 'RUB',
  status: 'unpaid',
  paid_at: null,
  paid_by_label: null,
  note: null,
  is_overdue: true,
  overdue_days: 3,
  days_until_due: -3,
  display_status: 'overdue',
  reminder_sent_at: null,
  receipt_url: null,
  receipt_file_name: null,
  updated_at: '2026-10-20T10:00:00Z',
}

describe('unpaidStatus', () => {
  it('совпадает с domain/status.py: в день срока не просрочен, порог «скоро» — из настроек', () => {
    expect(unpaidStatus(-1, 3)).toBe('overdue')
    expect(unpaidStatus(0, 3)).toBe('due_today')
    expect(unpaidStatus(3, 3)).toBe('due_soon')
    expect(unpaidStatus(4, 3)).toBe('upcoming')
    expect(unpaidStatus(5, 7)).toBe('due_soon')
  })
})

describe('optimistic', () => {
  it('оплата сегодня просроченного периода — «оплачен с опозданием» с числом дней', () => {
    const next = optimistic(base, { status: 'paid' }, '2026-10-23', 3)
    expect(next).toMatchObject({ status: 'paid', paid_at: '2026-10-23', is_overdue: true, overdue_days: 3, display_status: 'paid_late' })
  })

  it('исправление даты на срок снимает просрочку', () => {
    const paid = { ...base, status: 'paid' as const, paid_at: '2026-10-23', display_status: 'paid_late' as const }
    expect(optimistic(paid, { paid_at: '2026-10-20' }, '2026-10-23', 3)).toMatchObject({ is_overdue: false, overdue_days: 0, display_status: 'paid' })
  })

  it('отмена оплаты возвращает статус по сроку и очищает дату', () => {
    const paid = { ...base, status: 'paid' as const, paid_at: '2026-10-20', paid_by_label: 'Иван', days_until_due: 5 }
    expect(optimistic(paid, { status: 'unpaid' }, '2026-10-15', 7)).toMatchObject({
      status: 'unpaid',
      paid_at: null,
      paid_by_label: null,
      is_overdue: false,
      overdue_days: 0,
      display_status: 'due_soon',
    })
  })
})

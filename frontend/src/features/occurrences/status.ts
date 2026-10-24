/** Правила статуса периода на клиенте — зеркало backend/app/domain/status.py (FR-9). Нужны только для
 * оптимистичного обновления: после ответа сервера показывается его вычисление. Порог «скоро срок» —
 * REMINDER_DAYS_BEFORE из /app-info, а не константа. */
import { daysBetween } from '@/lib/format'
import type { Occurrence, OccurrencePatch } from './api'

export type DisplayStatus = Occurrence['display_status']

export function unpaidStatus(daysUntilDue: number, soonDays: number): DisplayStatus {
  if (daysUntilDue < 0) return 'overdue'
  if (daysUntilDue === 0) return 'due_today'
  return daysUntilDue <= soonDays ? 'due_soon' : 'upcoming'
}

/** Ожидаемое состояние сразу после отметки (до ответа сервера). */
export function optimistic(occ: Occurrence, patch: OccurrencePatch, todayIso: string, soonDays: number): Occurrence {
  const status = patch.status ?? occ.status
  if (status === 'paid') {
    const paidAt = patch.paid_at ?? occ.paid_at ?? todayIso
    const lateDays = Math.max(daysBetween(occ.due_date, paidAt), 0)
    return {
      ...occ,
      status,
      paid_at: paidAt,
      is_overdue: lateDays > 0,
      overdue_days: lateDays,
      display_status: lateDays > 0 ? 'paid_late' : 'paid',
    }
  }
  const until = occ.days_until_due
  return {
    ...occ,
    status,
    paid_at: null,
    paid_by_label: null,
    is_overdue: until < 0,
    overdue_days: Math.max(-until, 0),
    display_status: unpaidStatus(until, soonDays),
  }
}

import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ru } from 'date-fns/locale'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Page, PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { useAppInfo } from '@/features/app-info'
import { type Occurrence, useOccurrences } from '@/features/occurrences/api'
import { OccurrenceActions } from '@/features/occurrences/OccurrenceActions'
import { overdueText, StatusBadge } from '@/features/occurrences/StatusBadge'
import { cn } from '@/lib/cn'
import { type Currency, formatMoney, pluralize, toIsoDate } from '@/lib/format'
import { useReducedMotion } from '@/lib/motion'

const dotTone: Record<Occurrence['display_status'], string> = {
  paid: 'bg-success',
  paid_late: 'bg-warning',
  upcoming: 'bg-fg-tertiary',
  due_soon: 'bg-info',
  due_today: 'bg-warning',
  overdue: 'bg-danger',
}

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function dayLabel(day: Date, items: Occurrence[]): string {
  const base = format(day, 'd MMMM', { locale: ru })
  if (!items.length) return `${base}: платежей нет`
  const overdue = items.filter((i) => i.display_status === 'overdue').length
  const paid = items.filter((i) => i.status === 'paid').length
  const parts = [`${items.length} ${pluralize(items.length, { one: 'платёж', few: 'платежа', many: 'платежей' })}`]
  if (paid) parts.push(`оплачено ${paid}`)
  if (overdue) parts.push(`просрочено ${overdue}`)
  return `${base}: ${parts.join(', ')}`
}

export function CalendarPage() {
  const { today } = useAppInfo()
  const reduce = useReducedMotion()
  const [month, setMonth] = useState<Date | null>(null)
  const [direction, setDirection] = useState(0)
  const [selected, setSelected] = useState<Date | null>(null)
  const current = month ?? startOfMonth(today)
  const gridStart = startOfWeek(current, { weekStartsOn: 1 })
  const gridEnd = endOfWeek(endOfMonth(current), { weekStartsOn: 1 })
  const list = useOccurrences({ due_from: toIsoDate(gridStart), due_to: toIsoDate(gridEnd), sort: 'due_date', limit: 200 })

  const byDay = useMemo(() => {
    const map = new Map<string, Occurrence[]>()
    for (const occ of list.data?.items ?? []) map.set(occ.due_date, [...(map.get(occ.due_date) ?? []), occ])
    return map
  }, [list.data])

  const days: Date[] = []
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d)

  const go = (delta: number) => {
    setDirection(delta)
    setMonth(startOfMonth(addMonths(current, delta)))
    setSelected(null)
  }
  const activeDay = selected ?? (isSameMonth(today, current) ? today : null)
  const dayItems = activeDay ? (byDay.get(toIsoDate(activeDay)) ?? []) : []

  return (
    <Page>
      <PageHeader
        title="Календарь оплат"
        description="Сроки всех периодов по дням. Нажмите на день, чтобы увидеть платежи и отметить оплату."
        actions={
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="icon-sm" aria-label="Предыдущий месяц" onClick={() => go(-1)}>
              <ChevronLeft aria-hidden />
            </Button>
            <span className="min-w-36 text-center font-medium capitalize" aria-live="polite">
              {format(current, 'LLLL yyyy', { locale: ru })}
            </span>
            <Button variant="secondary" size="icon-sm" aria-label="Следующий месяц" onClick={() => go(1)}>
              <ChevronRight aria-hidden />
            </Button>
            {!isSameMonth(current, today) && (
              <Button variant="ghost" size="sm" onClick={() => {
                  setDirection(current > today ? -1 : 1)
                  setMonth(startOfMonth(today))
                  setSelected(null)
                }}>
                Сегодня
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <Card className="overflow-hidden p-2 sm:p-3">
          {list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : (
            <>
              <div className="grid grid-cols-7 pb-1" aria-hidden>
                {weekdays.map((w) => (
                  <span key={w} className="py-1 text-center text-xs text-fg-tertiary">
                    {w}
                  </span>
                ))}
              </div>
              <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                <motion.div
                  key={toIsoDate(current)}
                  custom={direction}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, x: direction * 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, x: direction * -24 }}
                  transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                  className="grid grid-cols-7 gap-1"
                  role="group"
                  aria-label={format(current, 'LLLL yyyy', { locale: ru })}
                >
                  {days.map((day) => {
                    const iso = toIsoDate(day)
                    const items = byDay.get(iso) ?? []
                    const inMonth = isSameMonth(day, current)
                    const isToday = isSameDay(day, today)
                    const isActive = activeDay ? isSameDay(day, activeDay) : false
                    return (
                      <button
                        key={iso}
                        type="button"
                        aria-pressed={isActive}
                        aria-label={dayLabel(day, items)}
                        onClick={() => setSelected(day)}
                        className={cn(
                          'flex min-h-14 flex-col items-stretch gap-1 rounded-lg border p-1.5 text-left transition-control outline-none sm:min-h-24',
                          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                          isActive ? 'border-primary bg-selected' : 'border-transparent hover:bg-secondary-hover',
                        )}
                      >
                        <span
                          className={cn(
                            'flex size-6 items-center justify-center rounded-full text-xs tabular',
                            isToday ? 'bg-primary font-semibold text-fg-on-action' : inMonth ? 'text-fg-secondary' : 'text-fg-tertiary',
                          )}
                        >
                          {format(day, 'd')}
                        </span>
                        {list.isPending ? (
                          inMonth && <Skeleton className="hidden h-3 sm:block" />
                        ) : (
                          <>
                            <span className="flex flex-wrap gap-1 sm:hidden" aria-hidden>
                              {items.slice(0, 4).map((i) => (
                                <span key={i.id} className={cn('size-1.5 rounded-full', dotTone[i.display_status])} />
                              ))}
                            </span>
                            <span className="hidden gap-0.5 sm:grid" aria-hidden>
                              {items.slice(0, 3).map((i) => (
                                <span key={i.id} className="flex min-w-0 items-center gap-1 text-xs">
                                  <span className={cn('size-1.5 shrink-0 rounded-full', dotTone[i.display_status])} />
                                  <span className={cn('truncate', i.status === 'paid' ? 'text-fg-tertiary line-through' : 'text-fg')}>
                                    {i.recurring_payment.name}
                                  </span>
                                </span>
                              ))}
                              {items.length > 3 && <span className="text-xs text-fg-tertiary">ещё {items.length - 3}</span>}
                            </span>
                          </>
                        )}
                      </button>
                    )
                  })}
                </motion.div>
              </AnimatePresence>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-3 text-xs text-fg-secondary" aria-label="Обозначения">
                {[
                  ['bg-success', 'оплачен'],
                  ['bg-warning', 'с опозданием или срок сегодня'],
                  ['bg-info', 'скоро срок'],
                  ['bg-danger', 'просрочен'],
                  ['bg-fg-tertiary', 'ожидает'],
                ].map(([tone, label]) => (
                  <li key={label} className="flex items-center gap-1.5">
                    <span className={cn('size-2 rounded-full', tone)} aria-hidden />
                    {label}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="first-letter:uppercase">
              {activeDay ? format(activeDay, 'EEEE, d MMMM', { locale: ru }) : 'Выберите день'}
            </CardTitle>
          </CardHeader>
          <CardBody className="pt-3">
            {!activeDay ? (
              <EmptyState icon={<CalendarDays aria-hidden />} title="День не выбран" className="py-6" />
            ) : dayItems.length === 0 ? (
              <EmptyState icon={<CalendarDays aria-hidden />} title="В этот день платежей нет" className="py-6" />
            ) : (
              <ul className="grid divide-y divide-subtle" aria-live="polite">
                {dayItems.map((occ) => (
                  <li key={occ.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium">{occ.recurring_payment.name}</span>
                      <span className="shrink-0 font-semibold tabular">{formatMoney(occ.amount, occ.currency as Currency)}</span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <StatusBadge status={occ.display_status} />
                        {overdueText(occ) && <span className="text-xs text-fg-tertiary">{overdueText(occ)}</span>}
                      </span>
                      <OccurrenceActions occ={occ} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </Page>
  )
}

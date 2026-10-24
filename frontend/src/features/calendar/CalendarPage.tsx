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
import {
  AlarmClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  Clock,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Page, PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { useAppInfo } from '@/features/app-info'
import { type Occurrence, useAllOccurrences } from '@/features/occurrences/api'
import { OccurrenceActions } from '@/features/occurrences/OccurrenceActions'
import { lateText, StatusBadge } from '@/features/occurrences/StatusBadge'
import { cn } from '@/lib/cn'
import { type Currency, formatMoney, formatMoneyCompact, pluralize, relativeDue, toIsoDate } from '@/lib/format'
import { useReducedMotion } from '@/lib/motion'

/** Статус дня в календаре: что требует действия. «Оплачен с опозданием» здесь просто «оплачен» — платить уже нечего,
 * поэтому жёлтый означает только «срок сегодня». Каждый статус — иконка и цвет, не только цвет. */
type DayStatus = 'overdue' | 'today' | 'soon' | 'upcoming' | 'paid'

const dayStatus: Record<DayStatus, { label: string; icon: LucideIcon; tone: string }> = {
  overdue: { label: 'просрочен', icon: TriangleAlert, tone: 'text-danger' },
  today: { label: 'срок сегодня', icon: AlarmClock, tone: 'text-warning' },
  soon: { label: 'скоро срок', icon: Clock, tone: 'text-info' },
  upcoming: { label: 'ожидает', icon: CircleDashed, tone: 'text-fg-tertiary' },
  paid: { label: 'всё оплачено', icon: CircleCheck, tone: 'text-success' },
}

const statusOrder: DayStatus[] = ['overdue', 'today', 'soon', 'upcoming', 'paid']

function statusOf(occ: Occurrence): DayStatus {
  switch (occ.display_status) {
    case 'overdue':
      return 'overdue'
    case 'due_today':
      return 'today'
    case 'due_soon':
      return 'soon'
    case 'upcoming':
      return 'upcoming'
    default:
      return 'paid'
  }
}

/** Самый срочный статус дня. */
function worstStatus(items: Occurrence[]): DayStatus {
  return statusOrder.find((status) => items.some((i) => statusOf(i) === status)) ?? 'paid'
}

function sumsByCurrency(items: Occurrence[]): [Currency, number][] {
  const sums = new Map<Currency, number>()
  for (const i of items) sums.set(i.currency as Currency, (sums.get(i.currency as Currency) ?? 0) + Number(i.amount))
  return [...sums.entries()]
}

function DayMarker({ items, showSums }: { items: Occurrence[]; showSums: boolean }) {
  const status = dayStatus[worstStatus(items)]
  const Icon = status.icon
  return (
    <span className="grid gap-0.5" aria-hidden>
      <span className={cn('flex items-center gap-1 text-xs font-medium tabular', status.tone)}>
        <Icon className="size-3.5 shrink-0" />
        {items.length}
        {showSums && <span className="hidden font-normal text-fg-secondary lg:inline">{pluralize(items.length, { one: 'платёж', few: 'платежа', many: 'платежей' })}</span>}
      </span>
      {showSums &&
        sumsByCurrency(items).map(([currency, sum]) => (
          <span key={currency} className="truncate text-xs text-fg-secondary tabular">
            {formatMoneyCompact(sum, currency)}
          </span>
        ))}
    </span>
  )
}

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function dayLabel(day: Date, items: Occurrence[]): string {
  const base = format(day, 'd MMMM', { locale: ru })
  if (!items.length) return `${base}: платежей нет`
  const overdue = items.filter((i) => i.display_status === 'overdue').length
  const paid = items.filter((i) => i.status === 'paid').length
  const parts = [`${items.length} ${pluralize(items.length, { one: 'платёж', few: 'платежа', many: 'платежей' })}`]
  for (const [currency, sum] of sumsByCurrency(items)) parts.push(formatMoney(sum, currency))
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
  const list = useAllOccurrences({ due_from: toIsoDate(gridStart), due_to: toIsoDate(gridEnd), sort: 'due_date' })

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
                          items.length > 0 && (
                            <>
                              <span className="sm:hidden">
                                <DayMarker items={items} showSums={false} />
                              </span>
                              <span className="hidden min-w-0 sm:block">
                                <DayMarker items={items} showSums />
                              </span>
                            </>
                          )
                        )}
                      </button>
                    )
                  })}
                </motion.div>
              </AnimatePresence>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-3 text-xs text-fg-secondary" aria-label="Обозначения">
                {statusOrder.map((key) => {
                  const { label, icon: Icon, tone } = dayStatus[key]
                  return (
                    <li key={key} className="flex items-center gap-1.5">
                      <Icon className={cn('size-3.5', tone)} aria-hidden />
                      {label}
                    </li>
                  )
                })}
                <li className="text-fg-tertiary">Число в ячейке: платежей за день, значок: самый срочный статус</li>
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
                        {occ.status === 'unpaid' && occ.is_overdue && (
                          <span className="text-xs text-fg-tertiary">{relativeDue(occ.days_until_due)}</span>
                        )}
                        {lateText(occ) && <span className="text-xs text-fg-tertiary">{lateText(occ)}</span>}
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

import { addDays, addMonths, endOfMonth, format, isSameMonth, startOfMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import { motion } from 'motion/react'
import { ArrowRight, CalendarClock, ChevronLeft, ChevronRight, CircleCheck, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { AnimatedNumber } from '@/components/AnimatedNumber'
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
import { type Currency, currencyNames, formatDate, formatMoney, pluralize, relativeDue, toIsoDate } from '@/lib/format'
import { fadeUp, reduced, stagger, useReducedMotion } from '@/lib/motion'
import { type CurrencySummary, useSummary } from './api'
import { AsOfCard } from './AsOfCard'

const payments = (n: number) => pluralize(n, { one: 'платёж', few: 'платежа', many: 'платежей' })

function MonthSwitcher({ month, onChange, today }: { month: Date; onChange: (d: Date) => void; today: Date }) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="secondary" size="icon-sm" aria-label="Предыдущий месяц" onClick={() => onChange(addMonths(month, -1))}>
        <ChevronLeft aria-hidden />
      </Button>
      <span className="min-w-36 text-center font-medium capitalize" aria-live="polite">
        {format(month, 'LLLL yyyy', { locale: ru })}
      </span>
      <Button variant="secondary" size="icon-sm" aria-label="Следующий месяц" onClick={() => onChange(addMonths(month, 1))}>
        <ChevronRight aria-hidden />
      </Button>
      {!isSameMonth(month, today) && (
        <Button variant="ghost" size="sm" onClick={() => onChange(startOfMonth(today))}>
          Текущий
        </Button>
      )}
    </div>
  )
}

/** Полоса «оплачено / к оплате / просрочено» по сумме валюты. */
function ProgressBar({ row }: { row: CurrencySummary }) {
  const total = Number(row.total)
  const paid = total ? Number(row.paid) / total : 0
  const overdue = total ? Number(row.overdue) / total : 0
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-sunken" aria-hidden>
      <div className="h-full bg-success transition-[width] duration-500" style={{ width: `${paid * 100}%` }} />
      <div className="h-full bg-danger transition-[width] duration-500" style={{ width: `${overdue * 100}%` }} />
    </div>
  )
}

function CurrencyCard({ row }: { row: CurrencySummary }) {
  const currency = row.currency as Currency
  const money = (n: number) => formatMoney(n, currency)
  const empty = row.count_total === 0
  return (
    <Card className="grid content-start gap-4 p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">{currency}</h3>
        <span className="text-xs text-fg-tertiary">{currencyNames[currency]}</span>
      </div>
      {empty ? (
        <p className="text-fg-tertiary">В этом месяце платежей в {currency} нет</p>
      ) : (
        <>
          <div className="grid gap-1">
            <span className="text-xs text-fg-tertiary">
              Всего за месяц, {row.count_total} {payments(row.count_total)}
            </span>
            <span className="text-2xl font-semibold tracking-tight">
              <AnimatedNumber value={Number(row.total)} format={money} />
            </span>
          </div>
          <ProgressBar row={row} />
          <dl className="grid gap-1.5">
            <div className="flex justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-fg-secondary">
                <span className="size-2 rounded-full bg-success" aria-hidden />
                Оплачено
              </dt>
              <dd className="font-medium">
                <AnimatedNumber value={Number(row.paid)} format={money} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-fg-secondary">
                <span className="size-2 rounded-full bg-sunken ring-1 ring-strong" aria-hidden />
                К оплате
              </dt>
              <dd className="font-medium">
                <AnimatedNumber value={Number(row.unpaid)} format={money} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-fg-secondary">
                <span className="size-2 rounded-full bg-danger" aria-hidden />
                Просрочено
              </dt>
              <dd className={cn('font-medium', Number(row.overdue) > 0 && 'text-danger')}>
                <AnimatedNumber value={Number(row.overdue)} format={money} />
              </dd>
            </div>
          </dl>
        </>
      )}
    </Card>
  )
}

function Hero({ rows, isCurrent }: { rows: CurrencySummary[]; isCurrent: boolean }) {
  const count = rows.reduce((sum, r) => sum + r.count_total - r.count_paid, 0)
  const overdue = rows.reduce((sum, r) => sum + r.count_overdue, 0)
  const total = rows.reduce((sum, r) => sum + r.count_total, 0)
  const paid = total - count
  const unpaid = rows.filter((r) => Number(r.unpaid) > 0)
  return (
    <Card className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-end">
      <div className="grid gap-2">
        <span className="text-fg-secondary">{isCurrent ? 'Осталось оплатить в этом месяце' : 'Не оплачено в этом месяце'}</span>
        <div className="flex items-baseline gap-3">
          <span className="text-5xl font-semibold tracking-tight sm:text-6xl">
            <AnimatedNumber value={count} format={(n) => String(Math.round(n))} />
          </span>
          <span className="text-lg text-fg-secondary">{payments(count)}</span>
        </div>
        {overdue > 0 ? (
          <p className="flex items-center gap-1.5 font-medium text-danger">
            <TriangleAlert className="size-4" aria-hidden />
            Из них {overdue} {pluralize(overdue, { one: 'просрочен', few: 'просрочены', many: 'просрочены' })}
          </p>
        ) : total > 0 ? (
          <p className="flex items-center gap-1.5 text-success">
            <CircleCheck className="size-4" aria-hidden />
            Просрочек нет
          </p>
        ) : null}
      </div>
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {unpaid.length === 0 ? (
            <span className="text-fg-secondary">{total > 0 ? 'Всё оплачено' : 'Платежей в этом месяце нет'}</span>
          ) : (
            unpaid.map((r) => (
              <span key={r.currency} className="grid">
                <span className="text-xs text-fg-tertiary">К оплате, {r.currency}</span>
                <span className="text-xl font-semibold">
                  <AnimatedNumber value={Number(r.unpaid)} format={(n) => formatMoney(n, r.currency as Currency)} />
                </span>
              </span>
            ))
          )}
        </div>
        {total > 0 && (
          <div className="grid gap-1.5">
            <div className="flex h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
              <div className="h-full bg-success transition-[width] duration-500" style={{ width: `${(paid / total) * 100}%` }} />
            </div>
            <span className="text-xs text-fg-tertiary">
              Оплачено {paid} из {total} {payments(total)}
            </span>
          </div>
        )}
      </div>
    </Card>
  )
}

function OccurrenceMiniList({
  title,
  icon,
  items,
  total,
  isPending,
  error,
  onRetry,
  emptyTitle,
  link,
}: {
  title: string
  icon: React.ReactNode
  items: Occurrence[]
  total: number
  isPending: boolean
  error: unknown
  onRetry: () => void
  emptyTitle: string
  link: string
}) {
  const reduce = useReducedMotion()
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-fg-tertiary">
          {icon}
          {title}
          {total > 0 && <span className="text-fg-tertiary tabular">{total}</span>}
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link to={link}>
            Все
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </CardHeader>
      <CardBody className="flex-1 pt-3">
        {isPending ? (
          <div className="grid gap-3" aria-busy="true">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={onRetry} className="py-6" />
        ) : items.length === 0 ? (
          <EmptyState title={emptyTitle} className="py-6" icon={<CircleCheck aria-hidden />} />
        ) : (
          <motion.ul initial="hidden" animate="show" variants={stagger(0.04)} className="grid divide-y divide-subtle">
            {items.map((occ) => (
              <motion.li
                key={occ.id}
                variants={reduce ? reduced : fadeUp}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="grid min-w-0">
                  <span className="truncate font-medium">{occ.recurring_payment.name}</span>
                  <span className="text-xs text-fg-tertiary">
                    {formatDate(occ.due_date)}, {occ.is_overdue ? `просрочен ${overdueText(occ)}` : relativeDue(occ.days_until_due)}
                  </span>
                </div>
                <span className="text-right font-semibold tabular">{formatMoney(occ.amount, occ.currency as Currency)}</span>
                <div className="justify-self-start">
                  <StatusBadge status={occ.display_status} />
                </div>
                <div className="justify-self-end">
                  <OccurrenceActions occ={occ} />
                </div>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </CardBody>
    </Card>
  )
}

export function DashboardPage() {
  const { today, todayIso } = useAppInfo()
  const [month, setMonth] = useState<Date | null>(null)
  const current = month ?? startOfMonth(today)
  const summary = useSummary(toIsoDate(startOfMonth(current)), toIsoDate(endOfMonth(current)))
  const upcoming = useOccurrences({
    status: 'unpaid',
    due_from: todayIso,
    due_to: toIsoDate(addDays(today, 7)),
    sort: 'due_date',
    limit: 6,
  })
  const overdue = useOccurrences({ status: 'unpaid', overdue: true, sort: 'due_date', limit: 6 })
  const reduce = useReducedMotion()

  return (
    <Page>
      <PageHeader
        title="Сводка"
        description="Что и когда оплатить, что уже оплачено и что просрочено. Суммы по каждой валюте отдельно."
        actions={<MonthSwitcher month={current} onChange={(d) => setMonth(startOfMonth(d))} today={today} />}
      />

      {summary.isPending ? (
        <div className="grid gap-4" aria-busy="true" aria-label="Загрузка сводки">
          <Skeleton className="h-40 rounded-xl" />
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-56 rounded-xl" />
            <Skeleton className="h-56 rounded-xl" />
            <Skeleton className="h-56 rounded-xl" />
          </div>
        </div>
      ) : summary.isError ? (
        <Card>
          <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
        </Card>
      ) : (
        <motion.div initial="hidden" animate="show" variants={stagger(0.06)} className="grid gap-4">
          <motion.div variants={reduce ? reduced : fadeUp}>
            <Hero rows={summary.data.currencies} isCurrent={isSameMonth(current, today)} />
          </motion.div>
          <section aria-label="Итоги по валютам" className="grid gap-4 md:grid-cols-3">
            {summary.data.currencies.map((row) => (
              <motion.div key={row.currency} variants={reduce ? reduced : fadeUp} className="grid">
                <CurrencyCard row={row} />
              </motion.div>
            ))}
          </section>
        </motion.div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <OccurrenceMiniList
          title="Просрочено"
          icon={<TriangleAlert aria-hidden />}
          items={overdue.data?.items ?? []}
          total={overdue.data?.total ?? 0}
          isPending={overdue.isPending}
          error={overdue.error}
          onRetry={() => overdue.refetch()}
          emptyTitle="Просроченных платежей нет"
          link="/payments?tab=overdue"
        />
        <OccurrenceMiniList
          title="Ближайшие 7 дней"
          icon={<CalendarClock aria-hidden />}
          items={upcoming.data?.items ?? []}
          total={upcoming.data?.total ?? 0}
          isPending={upcoming.isPending}
          error={upcoming.error}
          onRetry={() => upcoming.refetch()}
          emptyTitle="В ближайшую неделю платить нечего"
          link="/payments"
        />
      </div>

      <AsOfCard />
    </Page>
  )
}

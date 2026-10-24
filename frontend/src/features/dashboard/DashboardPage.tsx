import { addDays, endOfMonth, isSameMonth, startOfMonth } from 'date-fns'
import { motion } from 'motion/react'
import { ArrowRight, CalendarClock, CircleCheck, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { AnimatedNumber } from '@/components/AnimatedNumber'
import { BrandPattern } from '@/components/BrandPattern'
import { MonthSwitcher } from '@/components/MonthSwitcher'
import { Page, PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { useAppInfo } from '@/features/app-info'
import { type Occurrence, useOccurrences } from '@/features/occurrences/api'
import { OccurrenceActions } from '@/features/occurrences/OccurrenceActions'
import { overdueHref } from '@/features/occurrences/OverdueNav'
import { StatusBadge } from '@/features/occurrences/StatusBadge'
import { type BudgetOverview, useBudgetOverview } from '@/features/reports/api'
import { cn } from '@/lib/cn'
import { type Currency, currencyNames, formatDate, formatMoney, pluralize, relativeDue, toIsoDate } from '@/lib/format'
import { fadeUp, reduced, stagger, useReducedMotion } from '@/lib/motion'
import { type CurrencySummary, useSummary } from './api'

const payments = (n: number) => pluralize(n, { one: 'платёж', few: 'платежа', many: 'платежей' })

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

type BudgetLine = BudgetOverview['currencies'][number]['month']

/** Бюджет месяца одной строкой: подробности и правка в «Отчётах». */
function BudgetHint({ line, currency }: { line: BudgetLine; currency: Currency }) {
  if (!line.budget) return null
  const left = Number(line.budget) - Number(line.planned)
  return (
    <p className={cn('text-xs', left < 0 ? 'text-danger' : 'text-fg-tertiary')}>
      {left < 0
        ? `Сверх бюджета на ${formatMoney(-left, currency)}`
        : `Остаток бюджета ${formatMoney(line.budget, currency)}: ${formatMoney(left, currency)}`}
    </p>
  )
}

function CurrencyCard({ row, budget }: { row: CurrencySummary; budget?: BudgetLine }) {
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
            {budget && <BudgetHint line={budget} currency={currency} />}
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

function Hero({
  rows,
  isCurrent,
  overdueAllTime,
  next,
}: {
  rows: CurrencySummary[]
  isCurrent: boolean
  overdueAllTime: number
  next?: Occurrence
}) {
  const count = rows.reduce((sum, r) => sum + r.count_total - r.count_paid, 0)
  const overdue = rows.reduce((sum, r) => sum + r.count_overdue, 0)
  const total = rows.reduce((sum, r) => sum + r.count_total, 0)
  const paid = total - count
  // Просрочка в боковой панели считает все месяцы, здесь только выбранный: разницу называем явно.
  const earlier = isCurrent ? Math.max(overdueAllTime - overdue, 0) : 0
  return (
    <Card className="relative isolate grid gap-6 overflow-hidden p-5 sm:p-6 lg:grid-cols-2 lg:items-end">
      {/* На телефоне карточка в одну колонку, и линии угла легли бы на подпись: показываем с sm. */}
      <BrandPattern variant="corner" className="-z-10 hidden sm:block" />
      <div className="grid gap-2">
        <span className="text-fg-secondary">{isCurrent ? 'Осталось оплатить в этом месяце' : 'Не оплачено в этом месяце'}</span>
        <div className="flex items-baseline gap-3">
          <span className="font-display text-5xl font-extrabold sm:text-6xl">
            <AnimatedNumber value={count} format={(n) => String(Math.round(n))} />
          </span>
          <span className="text-lg text-fg-secondary">{payments(count)}</span>
        </div>
        {overdue > 0 || earlier > 0 ? (
          <Link
            to={overdueHref()}
            className="flex items-start gap-1.5 justify-self-start rounded-sm font-medium text-danger underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {overdue > 0 && `Из них ${overdue} ${pluralize(overdue, { one: 'просрочен', few: 'просрочены', many: 'просрочены' })}`}
              {overdue > 0 && earlier > 0 && ', '}
              {earlier > 0 && `${overdue > 0 ? 'ещё' : 'Ещё'} ${earlier} ${pluralize(earlier, { one: 'платёж просрочен', few: 'платежа просрочены', many: 'платежей просрочено' })} в прошлых месяцах`}
            </span>
          </Link>
        ) : total > 0 ? (
          <p className="flex items-center gap-1.5 text-success">
            <CircleCheck className="size-4" aria-hidden />
            Просрочек нет
          </p>
        ) : null}
      </div>
      <div className="grid gap-4">
        {isCurrent && next && (
          <div className="grid gap-0.5">
            <span className="text-xs text-fg-tertiary">Ближайший срок</span>
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{next.recurring_payment.name}</span>
              <span className="font-semibold tabular">{formatMoney(next.amount, next.currency as Currency)}</span>
              <span className="text-fg-secondary">{relativeDue(next.days_until_due)}</span>
            </span>
          </div>
        )}
        {total > 0 ? (
          <div className="grid gap-1.5">
            <div className="flex h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
              <div className="h-full bg-success transition-[width] duration-500" style={{ width: `${(paid / total) * 100}%` }} />
            </div>
            <span className="text-xs text-fg-tertiary">
              Оплачено {paid} из {total} {payments(total)} месяца
            </span>
          </div>
        ) : (
          <span className="text-fg-secondary">Платежей в этом месяце нет</span>
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
                className={cn(
                  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0',
                  'md:grid-cols-[minmax(0,1fr)_11rem_10rem_auto] md:gap-x-6',
                )}
              >
                <div className="grid min-w-0">
                  <span className="truncate font-medium">{occ.recurring_payment.name}</span>
                  <span className="text-xs text-fg-tertiary">
                    {formatDate(occ.due_date)}, {relativeDue(occ.days_until_due)}
                  </span>
                </div>
                {/* Телефон: имя и сумма, под ними статус и действия. Шире: всё в одну строку. */}
                <span className="text-right font-semibold tabular md:col-start-3 md:row-start-1">
                  {formatMoney(occ.amount, occ.currency as Currency)}
                </span>
                <div className="justify-self-start md:col-start-2 md:row-start-1">
                  <StatusBadge status={occ.display_status} />
                </div>
                <div className="justify-self-end md:col-start-4 md:row-start-1">
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
  // Сами просрочки показаны в боковой панели; здесь нужен только их счёт для героя.
  const overdue = useOccurrences({ status: 'unpaid', overdue: true, sort: 'due_date', limit: 1 })
  const budget = useBudgetOverview(current.getFullYear(), current.getMonth() + 1)
  const budgetFor = (currency: string) => budget.data?.currencies.find((c) => c.currency === currency)?.month
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
            <Hero
              rows={summary.data.currencies}
              isCurrent={isSameMonth(current, today)}
              overdueAllTime={overdue.data?.total ?? 0}
              next={upcoming.data?.items[0]}
            />
          </motion.div>
          <section aria-label="Итоги по валютам" className="grid gap-4 md:grid-cols-3">
            {summary.data.currencies.map((row) => (
              <motion.section key={row.currency} aria-label={row.currency} variants={reduce ? reduced : fadeUp} className="grid">
                <CurrencyCard row={row} budget={budgetFor(row.currency)} />
              </motion.section>
            ))}
          </section>
        </motion.div>
      )}

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

    </Page>
  )
}

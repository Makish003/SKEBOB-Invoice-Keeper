import { addMonths, endOfMonth, startOfMonth } from 'date-fns'
import { motion } from 'motion/react'
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Page, PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Listbox, ListboxContent, ListboxItem, ListboxTrigger, ListboxValue } from '@/components/ui/listbox'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Segmented } from '@/components/ui/tabs'
import { Table, TD, TH, THead } from '@/components/ui/table'
import { useAppInfo } from '@/features/app-info'
import { cn } from '@/lib/cn'
import { type Currency, formatDate, formatMoney, relativeDue, toIsoDate } from '@/lib/format'
import { fadeUp, reduced, stagger, useReducedMotion } from '@/lib/motion'
import { type Occurrence, type OccurrenceQuery, useOccurrences } from './api'
import { OccurrenceActions } from './OccurrenceActions'
import { lateText, StatusBadge } from './StatusBadge'

const PAGE_SIZE = 25

type Tab = 'due' | 'overdue' | 'paid' | 'all'
type PeriodFilter = 'any' | 'this' | 'next' | 'prev'

const tabQuery: Record<Tab, Partial<OccurrenceQuery>> = {
  due: { status: 'unpaid', sort: 'due_date' },
  overdue: { status: 'unpaid', overdue: true, sort: 'due_date' },
  paid: { status: 'paid', sort: '-due_date' },
  all: { sort: '-due_date' },
}

const emptyText: Record<Tab, { title: string; description: string }> = {
  due: { title: 'Платить пока нечего', description: 'Все периоды оплачены. Новые появятся автоматически по расписанию.' },
  overdue: { title: 'Просрочек нет', description: 'Все сроки соблюдены.' },
  paid: { title: 'Оплаченных периодов пока нет', description: 'Отметьте оплату на вкладке «К оплате».' },
  all: { title: 'Периодов пока нет', description: 'Они появятся, когда администратор добавит регулярный платёж.' },
}

const periodLabels: Record<PeriodFilter, string> = {
  any: 'Любой срок',
  prev: 'Прошлый месяц',
  this: 'Этот месяц',
  next: 'Следующий месяц',
}

function periodRange(period: PeriodFilter, today: Date): Pick<OccurrenceQuery, 'due_from' | 'due_to'> {
  if (period === 'any') return {}
  const base = addMonths(today, period === 'next' ? 1 : period === 'prev' ? -1 : 0)
  return { due_from: toIsoDate(startOfMonth(base)), due_to: toIsoDate(endOfMonth(base)) }
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function useFilters() {
  const [params, setParams] = useSearchParams()
  const tab = pick<Tab>(params.get('tab'), ['due', 'overdue', 'paid', 'all'], 'due')
  const currencyParam = params.get('currency')
  const currency: Currency | null = currencyParam === 'RUB' || currencyParam === 'USD' || currencyParam === 'EUR' ? currencyParam : null
  const period = pick<PeriodFilter>(params.get('period'), ['any', 'this', 'next', 'prev'], 'any')
  const q = params.get('q') ?? ''
  const page = Math.max(1, Number(params.get('page')) || 1)
  const archived = params.get('archived') === '1'

  const update = (patch: Record<string, string | null>, resetPage = true) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        Object.entries(patch).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)))
        if (resetPage) next.delete('page')
        return next
      },
      { replace: true },
    )
  return { tab, currency, period, q, page, archived, update }
}

function StatusCell({ occ }: { occ: Occurrence }) {
  const extra = lateText(occ)
  return (
    <div className="grid justify-items-start gap-1">
      <StatusBadge status={occ.display_status} />
      {extra && <span className="text-xs text-warning">{extra}</span>}
    </div>
  )
}

function NameCell({ occ }: { occ: Occurrence }) {
  return (
    <div className="grid min-w-0">
      <span className="truncate font-medium text-fg">{occ.recurring_payment.name}</span>
      <span className="text-xs text-fg-tertiary">
        Период {occ.seq + 1}
        {!occ.recurring_payment.is_active && ', платёж прекращён'}
      </span>
    </div>
  )
}

/** Карточка периода на телефоне: название и сумма, срок и статус, действия — три плотные строки. */
function MobileRow({ occ }: { occ: Occurrence }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 font-medium">
          {occ.recurring_payment.name}
          {!occ.recurring_payment.is_active && <span className="block text-xs font-normal text-fg-tertiary">Платёж прекращён</span>}
        </span>
        <span className="shrink-0 font-semibold tabular">{formatMoney(occ.amount, occ.currency)}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-sm text-fg-secondary">
          <span className="tabular text-fg">{formatDate(occ.due_date)}</span>
          {occ.status === 'unpaid' ? (
            <span className="text-fg-tertiary">, {relativeDue(occ.days_until_due)}</span>
          ) : (
            occ.paid_at && (
              <span className="text-fg-tertiary">
                , оплачен <span className="tabular">{formatDate(occ.paid_at)}</span>
              </span>
            )
          )}
        </span>
        <StatusCell occ={occ} />
      </div>
      <OccurrenceActions occ={occ} compact />
    </div>
  )
}

function LoadingRows() {
  return (
    <div className="grid gap-px" aria-busy="true" aria-label="Загрузка платежей">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="hidden h-6 w-28 rounded-full sm:block" />
        </div>
      ))}
    </div>
  )
}

export function PaymentsPage() {
  const { tab, currency, period, q, page, archived, update } = useFilters()
  const { today } = useAppInfo()
  const reduce = useReducedMotion()
  const searchRef = useRef<HTMLInputElement>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const base = useMemo<OccurrenceQuery>(
    () => ({
      ...(currency ? { currency } : {}),
      ...(q.trim() ? { q: q.trim() } : {}),
      ...(archived ? { include_deleted: true } : {}),
      ...periodRange(period, today),
    }),
    [currency, q, archived, period, today],
  )
  const list = useOccurrences({ ...base, ...tabQuery[tab], limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
  const dueCount = useOccurrences({ ...base, ...tabQuery.due, limit: 1 })
  const overdueCount = useOccurrences({ ...base, ...tabQuery.overdue, limit: 1 })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(target.tagName) && !target.isContentEditable) {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const filtered = Boolean(currency || q || archived || period !== 'any')
  const activeFilters = [currency, archived, period !== 'any'].filter(Boolean).length
  const resetFilters = () => update({ currency: null, q: null, archived: null, period: null })
  const variants = reduce ? reduced : fadeUp

  return (
    <Page>
      <PageHeader title="Платежи" description="Что и когда оплатить, что уже оплачено и что просрочено." />

      <div className="grid gap-3">
        <Segmented<Tab>
          label="Показать периоды"
          value={tab}
          onChange={(value) => update({ tab: value === 'due' ? null : value })}
          options={[
            { value: 'due', label: 'К оплате', count: dueCount.data?.total },
            { value: 'overdue', label: 'Просрочено', count: overdueCount.data?.total },
            { value: 'paid', label: 'Оплачено' },
            { value: 'all', label: 'Все' },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-tertiary" aria-hidden />
            <Input
              ref={searchRef}
              type="search"
              aria-label="Поиск по названию"
              aria-keyshortcuts="/"
              placeholder="Поиск по названию"
              className="pl-9"
              defaultValue={q}
              key={q}
              onKeyDown={(event) => {
                if (event.key === 'Enter') update({ q: event.currentTarget.value.trim() || null })
                if (event.key === 'Escape') update({ q: null })
              }}
              onBlur={(event) => {
                const value = event.currentTarget.value.trim()
                if (value !== q) update({ q: value || null })
              }}
            />
          </div>
          <Button
            variant={activeFilters ? 'secondary' : 'ghost'}
            size="icon"
            className="relative sm:hidden"
            aria-label={activeFilters ? `Фильтры, выбрано: ${activeFilters}` : 'Фильтры'}
            aria-expanded={filtersOpen}
            aria-controls="payment-filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal aria-hidden />
            {activeFilters > 0 && (
              <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[0.625rem] font-semibold text-fg-on-action tabular">
                {activeFilters}
              </span>
            )}
          </Button>
          <div id="payment-filters" className={cn('w-full flex-wrap items-center gap-2 sm:flex sm:w-auto', filtersOpen ? 'flex' : 'hidden')}>
            <Listbox value={currency ?? 'all'} onValueChange={(value) => update({ currency: value === 'all' ? null : value })}>
              <ListboxTrigger className="w-[calc(50%-0.25rem)] sm:w-40" aria-label="Валюта">
                <ListboxValue />
              </ListboxTrigger>
              <ListboxContent>
                <ListboxItem value="all">Все валюты</ListboxItem>
                <ListboxItem value="RUB">RUB</ListboxItem>
                <ListboxItem value="USD">USD</ListboxItem>
                <ListboxItem value="EUR">EUR</ListboxItem>
              </ListboxContent>
            </Listbox>
            <Listbox value={period} onValueChange={(value) => update({ period: value === 'any' ? null : value })}>
              <ListboxTrigger className="w-[calc(50%-0.25rem)] sm:w-44" aria-label="Срок оплаты">
                <ListboxValue />
              </ListboxTrigger>
              <ListboxContent>
                {(Object.keys(periodLabels) as PeriodFilter[]).map((key) => (
                  <ListboxItem key={key} value={key}>
                    {periodLabels[key]}
                  </ListboxItem>
                ))}
              </ListboxContent>
            </Listbox>
            <Button
              variant={archived ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={archived}
              onClick={() => update({ archived: archived ? null : '1' })}
            >
              {archived ? 'С прекращёнными' : 'Показать прекращённые'}
            </Button>
          </div>
          {filtered && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <X aria-hidden />
              Сбросить
            </Button>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        {list.isPending ? (
          <LoadingRows />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<Search aria-hidden />}
              title="Ничего не найдено"
              description="Измените фильтры или сбросьте поиск."
              action={
                <Button variant="secondary" size="sm" onClick={resetFilters}>
                  Сбросить фильтры
                </Button>
              }
            />
          ) : (
            <EmptyState title={emptyText[tab].title} description={emptyText[tab].description} />
          )
        ) : (
          <>
            <div className="hidden md:block">
              <Table aria-label="Периоды платежей">
                <THead>
                  <tr>
                    <TH className="pl-4">Платёж</TH>
                    <TH>Срок</TH>
                    <TH className="text-right">Сумма</TH>
                    <TH>Статус</TH>
                    <TH>Оплачен</TH>
                    <TH className="pr-4 text-right">
                      <span className="sr-only">Действия</span>
                    </TH>
                  </tr>
                </THead>
                <motion.tbody
                  key={`${tab}-${page}`}
                  initial="hidden"
                  animate="show"
                  variants={stagger(0.025)}
                  className="[&>tr:last-child]:border-0"
                >
                  {items.map((occ) => (
                    <motion.tr
                      key={occ.id}
                      variants={variants}
                      className="border-b border-subtle transition-control hover:bg-page"
                    >
                      <TD className="max-w-64 pl-4">
                        <NameCell occ={occ} />
                      </TD>
                      <TD>
                        <div className="grid">
                          <span className="tabular">{formatDate(occ.due_date)}</span>
                          {occ.status === 'unpaid' && (
                            <span className="text-xs text-fg-tertiary">{relativeDue(occ.days_until_due)}</span>
                          )}
                        </div>
                      </TD>
                      <TD className="text-right font-medium whitespace-nowrap tabular">
                        {formatMoney(occ.amount, occ.currency)}
                      </TD>
                      <TD>
                        <StatusCell occ={occ} />
                      </TD>
                      <TD className="max-w-40">
                        {occ.paid_at ? (
                          <div className="grid">
                            <span className="tabular">{formatDate(occ.paid_at)}</span>
                            {occ.paid_by_label && (
                              <span className="truncate text-xs text-fg-tertiary">{occ.paid_by_label}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-fg-tertiary">Нет</span>
                        )}
                      </TD>
                      <TD className="pr-4 text-right">
                        <OccurrenceActions occ={occ} />
                      </TD>
                    </motion.tr>
                  ))}
                </motion.tbody>
              </Table>
            </div>

            <motion.ul
              key={`m-${tab}-${page}`}
              initial="hidden"
              animate="show"
              variants={stagger(0.03)}
              className="divide-y divide-subtle md:hidden"
              aria-label="Периоды платежей"
            >
              {items.map((occ) => (
                <motion.li key={occ.id} variants={variants} className="px-4 py-3">
                  <MobileRow occ={occ} />
                </motion.li>
              ))}
            </motion.ul>

            {total > PAGE_SIZE && (
              <nav aria-label="Страницы" className="flex items-center justify-between gap-3 border-t border-subtle px-4 py-3">
                <p className="text-fg-tertiary tabular">
                  {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} из {total}
                </p>
                <div className="flex gap-1">
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    aria-label="Предыдущая страница"
                    disabled={page <= 1}
                    onClick={() => update({ page: String(page - 1) }, false)}
                  >
                    <ChevronLeft aria-hidden />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    aria-label="Следующая страница"
                    disabled={page >= pages}
                    onClick={() => update({ page: String(page + 1) }, false)}
                  >
                    <ChevronRight aria-hidden />
                  </Button>
                </div>
              </nav>
            )}
          </>
        )}
      </Card>
    </Page>
  )
}

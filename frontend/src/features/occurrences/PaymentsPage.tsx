import { addMonths, endOfMonth, startOfMonth } from 'date-fns'
import { AnimatePresence, motion } from 'motion/react'
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
import { useAppInfo } from '@/features/app-info'
import { cn } from '@/lib/cn'
import { type Currency, toIsoDate } from '@/lib/format'
import { fadeUp, reduced, stagger, useReducedMotion } from '@/lib/motion'
import { type OccurrenceQuery, useOccurrences } from './api'
import { PaymentCard } from './PaymentCard'

const PAGE_SIZE = 24

const cardGrid = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'

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
  // Платёж, по которому пришли из просрочки в боковой панели: показываем первым и подсвечиваем.
  const focus = tab === 'overdue' ? Number(params.get('focus')) || null : null

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
  return { tab, currency, period, q, page, archived, focus, update }
}

function LoadingCards() {
  return (
    <div className={cardGrid} aria-busy="true" aria-label="Загрузка платежей">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-56 rounded-xl" />
      ))}
    </div>
  )
}

export function PaymentsPage() {
  const { tab, currency, period, q, page, archived, focus, update } = useFilters()
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

  const listed = list.data?.items ?? []
  const items = focus ? [...listed].sort((a, b) => Number(b.id === focus) - Number(a.id === focus)) : listed
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
          onChange={(value) => update({ tab: value === 'due' ? null : value, focus: null })}
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

      {list.isPending ? (
        <LoadingCards />
      ) : list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          {filtered ? (
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
          )}
        </Card>
      ) : (
        <>
          <motion.ul
            key={`${tab}-${page}-${focus}`}
            initial="hidden"
            animate="show"
            variants={stagger(0.03)}
            className={cardGrid}
            aria-label="Периоды платежей"
          >
            {/* Оплаченный период уходит с вкладки «К оплате»: карточка гаснет, соседние сдвигаются на её место.
                Без initial={false}: список пересоздаётся ключом при смене вкладки, и вход карточек должен играть каждый раз. */}
            <AnimatePresence mode="popLayout">
              {items.map((occ) => (
                <motion.li
                  key={occ.id}
                  layout={!reduce}
                  variants={variants}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
                  aria-current={occ.id === focus ? 'true' : undefined}
                  className="rounded-xl aria-[current=true]:ring-2 aria-[current=true]:ring-danger/50"
                >
                  <PaymentCard occ={occ} />
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>

          {total > PAGE_SIZE && (
            <nav aria-label="Страницы" className="flex items-center justify-between gap-3">
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
    </Page>
  )
}

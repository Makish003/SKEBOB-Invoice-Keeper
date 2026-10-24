import { endOfMonth, format, startOfMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Link } from 'react-router'
import { BrandPattern, cardText, patternMetrics } from '@/components/BrandPattern'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppInfo } from '@/features/app-info'
import { cn } from '@/lib/cn'
import { toIsoDate } from '@/lib/format'
import { useSummary } from './api'

/**
 * Плитка текущего месяца в боковой панели (ADR-028): миниатюра паттерна стр. 22 и счёт периодов месяца.
 * Только количества: суммы в разных валютах не складываются. Ведёт на «Сводку»; кеш общий с ней.
 */
export function MonthPlate({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const { today } = useAppInfo()
  const summary = useSummary(toIsoDate(startOfMonth(today)), toIsoDate(endOfMonth(today)))
  const rows = summary.data?.currencies ?? []
  const total = rows.reduce((sum, r) => sum + r.count_total, 0)
  const paid = rows.reduce((sum, r) => sum + r.count_paid, 0)
  const overdue = rows.reduce((sum, r) => sum + r.count_overdue, 0)

  return (
    <Link
      to="/"
      onClick={onNavigate}
      className={cn(
        'relative block h-44 shrink-0 overflow-hidden rounded-xl bg-brand-plate-sidebar text-fg ring-1 ring-subtle outline-none',
        'transition-control hover:-translate-y-px active:translate-y-px motion-reduce:transform-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        patternMetrics.card,
        className,
      )}
    >
      <BrandPattern variant="card" tone="plate" />
      <span className={cn('absolute grid gap-1', cardText)}>
        <span className="font-display text-[0.6875rem] leading-none font-bold tracking-[0.08em] text-link uppercase">
          {format(today, 'LLLL', { locale: ru })}
        </span>
        {summary.isPending ? (
          <span className="grid gap-1.5 pt-1" aria-label="Загрузка">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-28" />
          </span>
        ) : summary.isError ? (
          <span className="text-xs text-fg-secondary">Сводка не загрузилась</span>
        ) : total === 0 ? (
          <span className="font-display text-base font-bold">Платежей нет</span>
        ) : (
          <>
            <span className="flex items-baseline gap-1.5 pt-1">
              <span className="font-display text-3xl leading-none font-extrabold tabular">{paid}</span>
              <span className="font-display text-sm font-semibold text-fg-secondary">из {total} оплачено</span>
            </span>
            {overdue > 0 ? (
              <span className="text-xs font-medium text-danger">Просрочено: {overdue}</span>
            ) : paid < total ? (
              <span className="text-xs text-fg-secondary">Осталось оплатить: {total - paid}</span>
            ) : (
              <span className="text-xs font-medium text-success">Всё оплачено</span>
            )}
          </>
        )}
      </span>
    </Link>
  )
}

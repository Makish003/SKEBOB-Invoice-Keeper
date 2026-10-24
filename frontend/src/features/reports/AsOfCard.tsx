import { useState } from 'react'
import { AnimatedNumber } from '@/components/AnimatedNumber'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { DateField } from '@/components/ui/date-field'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import { useAppInfo } from '@/features/app-info'
import { type CurrencySummary, useSummary } from '@/features/dashboard/api'
import { cn } from '@/lib/cn'
import { type Currency, formatDate, formatDateLong, formatMoney, pluralize } from '@/lib/format'
import { CurrencyColumn, CurrencyColumns, StatRow } from './CurrencyColumns'

const payments = (n: number) => pluralize(n, { one: 'платёж', few: 'платежа', many: 'платежей' })

function CurrencyAsOf({ row }: { row: CurrencySummary }) {
  const currency = row.currency as Currency
  const money = (n: number) => formatMoney(n, currency)
  const due = Number(row.due)
  const overdue = Number(row.overdue)
  return (
    <CurrencyColumn currency={currency} label={`Итоги ${currency}`}>
      {row.count_due === 0 ? (
        <p className="text-fg-tertiary">Сроков в {currency} к этой дате не было</p>
      ) : (
        <>
          <div className="grid gap-1">
            <span className="text-xs text-fg-tertiary">
              Должно быть оплачено, {row.count_due} {payments(row.count_due)}
            </span>
            <span className="text-2xl font-semibold tracking-tight">
              <AnimatedNumber value={due} format={money} />
            </span>
          </div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-sunken" aria-hidden>
            <div className="h-full bg-success transition-[width] duration-500" style={{ width: `${Math.min(Number(row.paid) / due, 1) * 100}%` }} />
            <div className="h-full bg-danger transition-[width] duration-500" style={{ width: `${Math.min(overdue / due, 1) * 100}%` }} />
          </div>
          <dl className="grid gap-1.5">
            <StatRow dot="bg-success" label="Оплачено">
              <AnimatedNumber value={Number(row.paid)} format={money} />
            </StatRow>
            <StatRow
              dot="bg-danger"
              label={row.count_overdue > 0 ? `Просрочено, ${row.count_overdue} ${payments(row.count_overdue)}` : 'Просрочено'}
              className={cn(overdue > 0 && 'text-danger')}
            >
              <AnimatedNumber value={overdue} format={money} />
            </StatRow>
          </dl>
        </>
      )}
    </CurrencyColumn>
  )
}

/** Итоги на дату (FR-B4): с 1 января до выбранной даты: сколько должно быть оплачено, оплачено и просрочено. */
export function AsOfCard() {
  const { todayIso, today } = useAppInfo()
  const [asOf, setAsOf] = useState<string | null>(null)
  const date = asOf ?? todayIso
  const yearStart = `${date.slice(0, 4)}-01-01`
  const summary = useSummary(yearStart, date, date)

  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div className="grid gap-0.5">
          <CardTitle>Итоги на дату</CardTitle>
          <p className="text-xs text-fg-tertiary">
            Сроки с {formatDateLong(yearStart, today)} по {formatDateLong(date, today)}, по каждой валюте отдельно
          </p>
        </div>
        <div className="w-44">
          <DateField id="as-of" value={date} onChange={setAsOf} />
        </div>
      </CardHeader>
      <div className="mt-4">
        {summary.isPending ? (
          <div className="grid gap-4 border-t border-subtle p-4 sm:p-5 md:grid-cols-3" aria-busy="true">
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
        ) : summary.isError ? (
          <ErrorState error={summary.error} onRetry={() => summary.refetch()} className="border-t border-subtle py-6" />
        ) : (
          <CurrencyColumns label={`Итоги на ${formatDate(date)}`}>
            {summary.data.currencies.map((row) => (
              <CurrencyAsOf key={row.currency} row={row} />
            ))}
          </CurrencyColumns>
        )}
      </div>
    </Card>
  )
}

import { useState } from 'react'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { DateField } from '@/components/ui/date-field'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { useAppInfo } from '@/features/app-info'
import { type Currency, formatDate, formatMoney } from '@/lib/format'
import { useSummary } from '@/features/dashboard/api'

/** Итоги на дату (FR-B4): с 1 января до выбранной даты: сколько должно быть оплачено, оплачено и просрочено. */
export function AsOfCard() {
  const { todayIso } = useAppInfo()
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
            Сроки с {formatDate(yearStart)} по {formatDate(date)}, отдельно по каждой валюте
          </p>
        </div>
        <div className="w-44">
          <DateField id="as-of" value={date} onChange={setAsOf} />
        </div>
      </CardHeader>
      <CardBody className="px-0 pb-2 sm:px-0">
        {summary.isPending ? (
          <div className="grid gap-2 px-4" aria-busy="true">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : summary.isError ? (
          <ErrorState error={summary.error} onRetry={() => summary.refetch()} className="py-6" />
        ) : (
          <Table aria-label={`Итоги на ${formatDate(date)}`}>
            <THead>
              <tr>
                <TH className="pl-4 sm:pl-5">Валюта</TH>
                <TH className="text-right">Должно быть оплачено</TH>
                <TH className="text-right">Оплачено</TH>
                <TH className="pr-4 text-right sm:pr-5">Просрочено</TH>
              </tr>
            </THead>
            <TBody>
              {summary.data.currencies.map((row) => {
                const currency = row.currency as Currency
                return (
                  <TR key={currency}>
                    <TD className="pl-4 font-medium sm:pl-5">{currency}</TD>
                    <TD className="text-right whitespace-nowrap tabular">
                      {formatMoney(row.due, currency)}
                      <span className="block text-xs text-fg-tertiary">{row.count_due} шт.</span>
                    </TD>
                    <TD className="text-right whitespace-nowrap text-success tabular">{formatMoney(row.paid, currency)}</TD>
                    <TD className={`pr-4 text-right whitespace-nowrap tabular sm:pr-5 ${Number(row.overdue) > 0 ? 'font-medium text-danger' : ''}`}>
                      {formatMoney(row.overdue, currency)}
                      <span className="block text-xs text-fg-tertiary">{row.count_overdue} шт.</span>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </CardBody>
    </Card>
  )
}

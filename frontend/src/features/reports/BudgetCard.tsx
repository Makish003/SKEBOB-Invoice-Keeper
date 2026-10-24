import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, ApiError, type Schemas, unwrap } from '@/api/client'
import { AnimatedNumber } from '@/components/AnimatedNumber'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, fieldAria } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import { useCurrentUser } from '@/features/auth/guards'
import { cn } from '@/lib/cn'
import { type Currency, formatMoney } from '@/lib/format'
import { formatAmountInput, parseAmount, sanitizeAmountInput } from '@/lib/money-input'
import { useBudgetOverview } from './api'
import { CurrencyColumn, CurrencyColumns, StatRow } from './CurrencyColumns'

type Overview = Schemas['BudgetOverview']
type Line = Schemas['BudgetLine']
const currencies: Currency[] = ['RUB', 'USD', 'EUR']
const monthNames = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']

/** Полоса бюджета: запланировано (голубым, сверх бюджета красным) и поверх неё оплачено (зелёным). */
function BudgetBar({ line, className }: { line: Line; className?: string }) {
  const budget = Number(line.budget)
  const planned = Number(line.planned)
  return (
    <div className={cn('relative overflow-hidden rounded-full bg-sunken', className)} aria-hidden>
      <div
        className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-500', planned > budget ? 'bg-danger' : 'bg-info')}
        style={{ width: `${Math.min(planned / budget, 1) * 100}%` }}
      />
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-success transition-[width] duration-500"
        style={{ width: `${Math.min(Number(line.paid) / budget, 1) * 100}%` }}
      />
    </div>
  )
}

function CurrencyBudget({ row, month, year }: { row: Overview['currencies'][number]; month: number; year: number }) {
  const currency = row.currency as Currency
  const money = (n: number | string) => formatMoney(n, currency)
  const { month: m, year: y } = row
  const left = m.budget ? Number(m.budget) - Number(m.planned) : null
  return (
    <CurrencyColumn currency={currency} label={`Бюджет ${currency}`}>
      <div className="grid gap-1">
        <span className="text-xs text-fg-tertiary">Запланировано на {monthNames[month - 1]}</span>
        <span className={cn('text-2xl font-semibold tracking-tight', left !== null && left < 0 && 'text-danger')}>
          <AnimatedNumber value={Number(m.planned)} format={money} />
        </span>
        <span className="text-xs text-fg-tertiary">{m.budget ? `из ${money(m.budget)} бюджета` : 'Бюджет на месяц не задан'}</span>
      </div>
      {m.budget && <BudgetBar line={m} className="h-2" />}
      <dl className="grid gap-1.5">
        <StatRow dot="bg-success" label="Оплачено">
          {money(m.paid)}
        </StatRow>
        {left !== null && (
          <StatRow dot={left < 0 ? 'bg-danger' : 'bg-info'} label={left < 0 ? 'Сверх бюджета' : 'Остаток'} className={cn(left < 0 && 'text-danger')}>
            {money(Math.abs(left))}
          </StatRow>
        )}
      </dl>
      <div className="grid gap-1.5 border-t border-subtle pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-xs text-fg-tertiary">За {year} год</span>
          <span className="text-sm tabular">
            <span className={cn('font-medium', y.budget && Number(y.planned) > Number(y.budget) && 'text-danger')}>{money(y.planned)}</span>
            <span className="text-fg-tertiary">{y.budget ? ` из ${money(y.budget)}` : ', бюджет не задан'}</span>
          </span>
        </div>
        {y.budget && <BudgetBar line={y} className="h-1.5" />}
      </div>
    </CurrencyColumn>
  )
}

function BudgetDialog({ overview, open, onOpenChange }: { overview: Overview; open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient()
  const initial = () =>
    Object.fromEntries(
      overview.currencies.flatMap((c) => [
        [`${c.currency}-month`, c.month.budget ? formatAmountInput(c.month.budget) : ''],
        [`${c.currency}-year`, c.year.budget ? formatAmountInput(c.year.budget) : ''],
      ]),
    ) as Record<string, string>
  const [values, setValues] = useState<Record<string, string>>(initial)
  const [error, setError] = useState<string>()
  const save = useMutation({
    mutationFn: async () => {
      for (const currency of currencies) {
        for (const scope of ['month', 'year'] as const) {
          const raw = values[`${currency}-${scope}`]?.trim() ?? ''
          const amount = raw ? parseAmount(raw) : null
          if (raw && (amount === null || Number(amount) <= 0)) throw new Error(`Проверьте сумму ${currency}`)
          await unwrap(
            api.PUT('/api/v1/budgets', {
              body: { year: overview.year, month: scope === 'month' ? overview.month : null, currency, amount },
            }),
          )
        }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['budget'] })
      toast.success('Бюджет сохранён')
      onOpenChange(false)
    },
    onError: (e) => setError(e instanceof ApiError || e instanceof Error ? e.message : 'Не удалось сохранить'),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setValues(initial())
          setError(undefined)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent title="Бюджет" description={`Плановые расходы на ${monthNames[overview.month - 1]} и ${overview.year} год. Пустое поле: бюджет не задан.`}>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setError(undefined)
            save.mutate()
          }}
        >
          {error && (
            <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {currencies.map((currency) => (
            <fieldset key={currency} className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-semibold">{currency}</legend>
              {(['month', 'year'] as const).map((scope) => {
                const id = `budget-${currency}-${scope}`
                return (
                  <Field key={scope} id={id} label={scope === 'month' ? 'На месяц' : 'На год'}>
                    <Input
                      {...fieldAria(id)}
                      inputMode="decimal"
                      className="tabular"
                      placeholder="Не задан"
                      value={values[`${currency}-${scope}`] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [`${currency}-${scope}`]: sanitizeAmountInput(e.target.value) }))}
                      onBlur={(e) => setValues((v) => ({ ...v, [`${currency}-${scope}`]: formatAmountInput(e.target.value) }))}
                    />
                  </Field>
                )
              })}
            </fieldset>
          ))}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending}>
              Сохранить бюджет
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Бюджет на месяц и год (FR-B9): плановые расходы против суммы периодов по каждой валюте. */
export function BudgetCard({ year, month }: { year: number; month: number }) {
  const user = useCurrentUser()
  const [open, setOpen] = useState(false)
  const overview = useBudgetOverview(year, month)

  return (
    <Card>
      <CardHeader>
        <div className="grid gap-0.5">
          <CardTitle>Бюджет</CardTitle>
          <p className="text-xs text-fg-tertiary">Запланированные платежи против бюджета по каждой валюте</p>
        </div>
        {user.role === 'admin' && overview.data && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <Pencil aria-hidden />
            Изменить
          </Button>
        )}
      </CardHeader>
      <div className="mt-4">
        {overview.isPending ? (
          <div className="grid gap-4 border-t border-subtle p-4 sm:p-5 md:grid-cols-3" aria-busy="true">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        ) : overview.isError ? (
          <ErrorState error={overview.error} onRetry={() => overview.refetch()} className="border-t border-subtle py-6" />
        ) : (
          <CurrencyColumns>
            {overview.data.currencies.map((row) => (
              <CurrencyBudget key={row.currency} row={row} month={month} year={year} />
            ))}
          </CurrencyColumns>
        )}
      </div>
      {overview.data && <BudgetDialog overview={overview.data} open={open} onOpenChange={setOpen} />}
    </Card>
  )
}

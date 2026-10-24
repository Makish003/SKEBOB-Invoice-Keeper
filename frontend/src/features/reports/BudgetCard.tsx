import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, ApiError, type Schemas, unwrap } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
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

type Overview = Schemas['BudgetOverview']
type Line = Schemas['BudgetLine']
const currencies: Currency[] = ['RUB', 'USD', 'EUR']
const monthNames = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']

function BudgetBar({ line, currency, title }: { line: Line; currency: Currency; title: string }) {
  const budget = line.budget ? Number(line.budget) : null
  const planned = Number(line.planned)
  const over = budget !== null && planned > budget
  const ratio = budget ? Math.min(planned / budget, 1) : 0
  const paidRatio = budget ? Math.min(Number(line.paid) / budget, 1) : 0
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-xs text-fg-tertiary">{title}</span>
        <span className="text-sm tabular">
          <span className={cn('font-medium', over && 'text-danger')}>{formatMoney(line.planned, currency)}</span>
          <span className="text-fg-tertiary">{budget !== null ? ` из ${formatMoney(budget, currency)}` : ', бюджет не задан'}</span>
        </span>
      </div>
      {budget !== null && (
        <>
          <div className="relative h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
            <div className={cn('absolute inset-y-0 left-0 rounded-full', over ? 'bg-danger' : 'bg-info')} style={{ width: `${ratio * 100}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-full bg-success" style={{ width: `${paidRatio * 100}%` }} />
          </div>
          <span className={cn('text-xs', over ? 'text-danger' : 'text-fg-tertiary')}>
            {over
              ? `Превышение на ${formatMoney(planned - budget, currency)}`
              : `Остаток ${formatMoney(budget - planned, currency)}, оплачено ${formatMoney(line.paid, currency)}`}
          </span>
        </>
      )}
    </div>
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
          <p className="text-xs text-fg-tertiary">
            Запланированные платежи против бюджета: {monthNames[month - 1]} и {year} год
          </p>
        </div>
        {user.role === 'admin' && overview.data && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <Pencil aria-hidden />
            Изменить
          </Button>
        )}
      </CardHeader>
      <CardBody>
        {overview.isPending ? (
          <div className="grid gap-3 sm:grid-cols-3" aria-busy="true">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : overview.isError ? (
          <ErrorState error={overview.error} onRetry={() => overview.refetch()} className="py-6" />
        ) : (
          <div className="grid gap-6 sm:grid-cols-3">
            {overview.data.currencies.map((row) => (
              <section key={row.currency} aria-label={`Бюджет ${row.currency}`} className="grid content-start gap-3">
                <h3 className="font-semibold">{row.currency}</h3>
                <BudgetBar line={row.month} currency={row.currency as Currency} title="Месяц" />
                <BudgetBar line={row.year} currency={row.currency as Currency} title="Год" />
              </section>
            ))}
          </div>
        )}
      </CardBody>
      {overview.data && <BudgetDialog overview={overview.data} open={open} onOpenChange={setOpen} />}
    </Card>
  )
}

import { zodResolver } from '@hookform/resolvers/zod'
import { addDays } from 'date-fns'
import { BellRing, Plus } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { DateField } from '@/components/ui/date-field'
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog'
import { Field, fieldAria } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Listbox, ListboxContent, ListboxItem, ListboxTrigger, ListboxValue } from '@/components/ui/listbox'
import { Segmented } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useAppInfo } from '@/features/app-info'
import { type Currency, days, daysBetween, formatDate, fromIsoDate, toIsoDate } from '@/lib/format'
import { formatAmountInput, parseAmount, sanitizeAmountInput } from '@/lib/money-input'
import { type Period, periodLabels, useCreateRecurring } from './api'

const schema = z.object({
  name: z.string().trim().min(1, 'Введите название, например «Аренда офиса»').max(200, 'Не длиннее 200 символов'),
  amount: z
    .string()
    .refine((value) => parseAmount(value) !== null, 'Введите сумму цифрами, не больше двух знаков после запятой')
    .refine((value) => Number(parseAmount(value)) > 0, 'Сумма должна быть больше нуля'),
  currency: z.enum(['RUB', 'USD', 'EUR']),
  first_due_date: z.string({ error: 'Выберите дату ближайшей оплаты' }).min(1, 'Выберите дату ближайшей оплаты'),
  period: z.enum(['monthly', 'weekly', 'quarterly', 'yearly']),
  description: z.string().max(1000, 'Не длиннее 1000 символов'),
})
type FormValues = z.infer<typeof schema>

function reminderHint(dueIso: string | undefined, todayIso: string, reminderDays: number): string {
  if (!dueIso) return `Напоминание придёт в Telegram за ${days(reminderDays)} до срока.`
  const until = daysBetween(todayIso, dueIso)
  if (until < 0) return 'Срок уже прошёл: периоды с этой даты появятся как просроченные, напоминание о них не придёт.'
  if (until <= reminderDays) return `Срок ближе, чем через ${days(reminderDays)}: напоминание уйдёт сразу после сохранения.`
  return `Напоминание придёт ${formatDate(toIsoDate(addDays(fromIsoDate(dueIso), -reminderDays)))}, за ${days(reminderDays)} до срока.`
}

export function CreateRecurringDialog() {
  const [open, setOpen] = useState(false)
  const { todayIso, reminderDays } = useAppInfo()
  const create = useCreateRecurring()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', amount: '', currency: 'RUB', first_due_date: '', period: 'monthly', description: '' },
  })
  const { register, control, handleSubmit, formState, reset, setError } = form
  const dueValue = useWatch({ control, name: 'first_due_date' })
  const errors = formState.errors

  const onSubmit = handleSubmit((values) =>
    create.mutate(
      {
        name: values.name.trim(),
        amount: parseAmount(values.amount)!,
        currency: values.currency,
        first_due_date: values.first_due_date,
        period: values.period,
        description: values.description.trim() || null,
      },
      {
        onSuccess: (payment) => {
          toast.success('Платёж добавлен', {
            description: payment.next_occurrence
              ? `Ближайший срок ${formatDate(payment.next_occurrence.due_date)}`
              : 'Периоды созданы',
          })
          reset()
          setOpen(false)
        },
        onError: (error) => {
          const message = error instanceof ApiError ? error.message : 'Не удалось сохранить. Попробуйте ещё раз'
          if (error instanceof ApiError && error.status === 422) setError('root', { message })
          else toast.error('Платёж не добавлен', { description: message })
        },
      },
    ),
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus aria-hidden />
          Добавить платёж
        </Button>
      </DialogTrigger>
      <DialogContent title="Новый регулярный платёж" description="Периоды и напоминания создадутся автоматически.">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {errors.root && (
            <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
              {errors.root.message}
            </p>
          )}
          <Field id="rp-name" label="Название" error={errors.name?.message}>
            <Input {...fieldAria('rp-name', errors.name?.message)} {...register('name')} placeholder="Аренда офиса" autoFocus />
          </Field>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field id="rp-amount" label="Сумма" error={errors.amount?.message}>
              <Controller
                control={control}
                name="amount"
                render={({ field }) => (
                  <Input
                    {...fieldAria('rp-amount', errors.amount?.message)}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="85 000,00"
                    className="tabular"
                    value={field.value}
                    onChange={(event) => field.onChange(sanitizeAmountInput(event.target.value))}
                    onBlur={() => {
                      field.onChange(formatAmountInput(field.value))
                      field.onBlur()
                    }}
                    ref={field.ref}
                  />
                )}
              />
            </Field>
            <div className="grid gap-1.5">
              <span className="text-[0.8125rem] font-medium" id="rp-currency-label">
                Валюта
              </span>
              <Controller
                control={control}
                name="currency"
                render={({ field }) => (
                  <Segmented<Currency>
                    label="Валюта"
                    value={field.value}
                    onChange={field.onChange}
                    className="h-10 items-center"
                    options={[
                      { value: 'RUB', label: 'RUB' },
                      { value: 'USD', label: 'USD' },
                      { value: 'EUR', label: 'EUR' },
                    ]}
                  />
                )}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="rp-date" label="Дата ближайшей оплаты" error={errors.first_due_date?.message}>
              <Controller
                control={control}
                name="first_due_date"
                render={({ field }) => (
                  <DateField
                    id="rp-date"
                    value={field.value || null}
                    onChange={field.onChange}
                    invalid={Boolean(errors.first_due_date)}
                    describedBy={errors.first_due_date ? 'rp-date-error' : undefined}
                  />
                )}
              />
            </Field>
            <Field id="rp-period" label="Периодичность">
              <Controller
                control={control}
                name="period"
                render={({ field }) => (
                  <Listbox value={field.value} onValueChange={(value) => field.onChange(value as Period)}>
                    <ListboxTrigger id="rp-period">
                      <ListboxValue />
                    </ListboxTrigger>
                    <ListboxContent>
                      {(Object.keys(periodLabels) as Period[]).map((key) => (
                        <ListboxItem key={key} value={key}>
                          {periodLabels[key]}
                        </ListboxItem>
                      ))}
                    </ListboxContent>
                  </Listbox>
                )}
              />
            </Field>
          </div>

          <p className="flex items-start gap-2 rounded-lg bg-info-bg px-3 py-2.5 text-sm text-info" aria-live="polite">
            <BellRing className="mt-0.5 size-4 shrink-0" aria-hidden />
            {reminderHint(dueValue || undefined, todayIso, reminderDays)}
          </p>

          <Field id="rp-description" label="Комментарий (необязательно)" error={errors.description?.message}>
            <Textarea
              {...fieldAria('rp-description', errors.description?.message)}
              {...register('description')}
              rows={2}
              placeholder="Договор № 12, оплата по счёту"
            />
          </Field>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              Добавить платёж
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

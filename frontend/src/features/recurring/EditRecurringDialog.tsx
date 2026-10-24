import { zodResolver } from '@hookform/resolvers/zod'
import { Info } from 'lucide-react'
import { useEffect } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, fieldAria } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { formatMoney } from '@/lib/format'
import { formatAmountInput, parseAmount, sanitizeAmountInput } from '@/lib/money-input'
import { periodLabels, type RecurringPayment, type RecurringPaymentPatch, useUpdateRecurring } from './api'

const schema = z.object({
  name: z.string().trim().min(1, 'Введите название').max(200, 'Не длиннее 200 символов'),
  amount: z
    .string()
    .refine((value) => parseAmount(value) !== null, 'Введите сумму цифрами, не больше двух знаков после запятой')
    .refine((value) => Number(parseAmount(value)) > 0, 'Сумма должна быть больше нуля'),
  description: z.string().max(1000, 'Не длиннее 1000 символов'),
})
type FormValues = z.infer<typeof schema>

const toForm = (p: RecurringPayment): FormValues => ({
  name: p.name,
  amount: formatAmountInput(p.amount),
  description: p.description ?? '',
})

/** Только изменённые поля: сервер пишет в журнал «было/стало» и не трогает остальное. */
function diff(payment: RecurringPayment, values: FormValues): RecurringPaymentPatch {
  const patch: RecurringPaymentPatch = {}
  const name = values.name.trim()
  const amount = parseAmount(values.amount)!
  const description = values.description.trim() || null
  if (name !== payment.name) patch.name = name
  if (amount !== payment.amount) patch.amount = amount
  if (description !== (payment.description ?? null)) patch.description = description
  return patch
}

export function EditRecurringDialog({ payment, onClose }: { payment: RecurringPayment | null; onClose: () => void }) {
  const update = useUpdateRecurring()
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: '', amount: '', description: '' } })
  const { register, control, handleSubmit, formState, reset, setError } = form
  const errors = formState.errors
  const amountValue = useWatch({ control, name: 'amount' })

  useEffect(() => {
    if (payment) reset(toForm(payment))
  }, [payment, reset])

  if (!payment) return null
  const amountChanged = parseAmount(amountValue ?? '') !== null && parseAmount(amountValue)! !== payment.amount

  const onSubmit = handleSubmit((values) => {
    const patch = diff(payment, values)
    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }
    update.mutate(
      { id: payment.id, patch },
      {
        onSuccess: (saved) => {
          toast.success('Платёж изменён', {
            description: patch.amount ? `Новая сумма ${formatMoney(saved.amount, saved.currency)} действует с текущего периода` : saved.name,
          })
          onClose()
        },
        onError: (error) => {
          const message = error instanceof ApiError ? error.message : 'Не удалось сохранить. Попробуйте ещё раз'
          if (error instanceof ApiError && error.status === 422) setError('root', { message })
          else toast.error('Изменения не сохранены', { description: message })
        },
      },
    )
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Изменить платёж"
        description={`${periodLabels[payment.period]}, ${payment.currency}. Валюту и график изменить нельзя: для этого прекратите платёж и создайте новый.`}
      >
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {errors.root && (
            <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
              {errors.root.message}
            </p>
          )}
          <Field id="rpe-name" label="Название" error={errors.name?.message}>
            <Input {...fieldAria('rpe-name', errors.name?.message)} {...register('name')} autoFocus />
          </Field>
          <Field id="rpe-amount" label={`Сумма, ${payment.currency}`} error={errors.amount?.message}>
            <Controller
              control={control}
              name="amount"
              render={({ field }) => (
                <Input
                  {...fieldAria('rpe-amount', errors.amount?.message)}
                  inputMode="decimal"
                  autoComplete="off"
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
          {amountChanged && (
            <p className="flex items-start gap-2 rounded-lg bg-info-bg px-3 py-2.5 text-sm text-info" aria-live="polite">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              Новая сумма применится к неоплаченным периодам со сроком сегодня и позже. Оплаченные и уже просроченные периоды
              сохранят прежнюю сумму.
            </p>
          )}
          <Field id="rpe-description" label="Комментарий (необязательно)" error={errors.description?.message}>
            <Textarea {...fieldAria('rpe-description', errors.description?.message)} {...register('description')} rows={2} />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" variant="primary" loading={update.isPending}>
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

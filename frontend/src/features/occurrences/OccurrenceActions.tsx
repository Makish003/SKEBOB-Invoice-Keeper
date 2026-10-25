import { Check, Pencil, Undo2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip } from '@/components/ui/tooltip'
import { useAppInfo } from '@/features/app-info'
import { formatDate, fromIsoDate, toIsoDate } from '@/lib/format'
import { type Occurrence, type OccurrencePatch, usePatchOccurrence } from './api'
import { ReceiptPopover } from './ReceiptPopover'

interface DatePopoverProps {
  occ: Occurrence
  title: string
  confirmLabel: string
  initial: string
  onConfirm: (iso: string) => void
  children: ReactNode
}

/** Выбор фактической даты оплаты: по умолчанию сегодня, будущие даты недоступны. */
function PaymentDatePopover({ occ, title, confirmLabel, initial, onConfirm, children }: DatePopoverProps) {
  const { today } = useAppInfo()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Date | undefined>(fromIsoDate(initial))
  const late = selected ? toIsoDate(selected) > occ.due_date : false

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setSelected(fromIsoDate(initial))
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-auto" aria-label={title}>
        <div className="grid gap-3">
          <div className="grid gap-0.5">
            <p className="font-medium">{title}</p>
            <p className="text-xs text-fg-tertiary">
              {occ.recurring_payment.name}, срок {formatDate(occ.due_date)}
            </p>
          </div>
          <Calendar
            mode="single"
            selected={selected}
            onSelect={setSelected}
            defaultMonth={selected}
            disabled={{ after: today }}
          />
          <p className={late ? 'text-xs text-warning' : 'text-xs text-fg-tertiary'} aria-live="polite">
            {selected
              ? late
                ? `Позже срока: период будет отмечен как оплаченный с опозданием`
                : 'В срок: просрочки не будет'
              : 'Выберите дату оплаты'}
          </p>
          <Button
            variant="primary"
            disabled={!selected}
            onClick={() => {
              if (!selected) return
              onConfirm(toIsoDate(selected))
              setOpen(false)
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Не удалось сохранить. Проверьте подключение и попробуйте ещё раз'
}

export function useOccurrenceMutations() {
  const { todayIso } = useAppInfo()
  const patch = usePatchOccurrence()

  const run = (occ: Occurrence, body: OccurrencePatch, success: string, undo?: OccurrencePatch) =>
    patch.mutate(
      { id: occ.id, patch: body },
      {
        onSuccess: () =>
          toast.success(success, {
            description: `${occ.recurring_payment.name}, срок ${formatDate(occ.due_date)}`,
            action: undo
              ? { label: 'Отменить', onClick: () => patch.mutate({ id: occ.id, patch: undo }) }
              : undefined,
          }),
        onError: (error) => toast.error('Изменение не сохранено', { description: errorText(error) }),
      },
    )

  return {
    todayIso,
    pending: patch.isPending,
    markPaid: (occ: Occurrence, paidAt: string) =>
      run(occ, { status: 'paid', paid_at: paidAt }, `Оплата отмечена ${formatDate(paidAt)}`, { status: 'unpaid' }),
    fixDate: (occ: Occurrence, paidAt: string) =>
      run(occ, { paid_at: paidAt }, `Дата оплаты исправлена на ${formatDate(paidAt)}`, occ.paid_at ? { paid_at: occ.paid_at } : undefined),
    markUnpaid: (occ: Occurrence) =>
      run(occ, { status: 'unpaid' }, 'Отметка об оплате снята', occ.paid_at ? { status: 'paid', paid_at: occ.paid_at } : undefined),
  }
}

/** `fill`: кнопка «Отметить оплату» занимает всю ширину (низ карточки платежа). */
export function OccurrenceActions({ occ, fill = false }: { occ: Occurrence; fill?: boolean }) {
  const actions = useOccurrenceMutations()

  if (occ.status === 'unpaid') {
    return (
      <div className={fill ? 'flex w-full items-center gap-1' : 'flex items-center justify-end gap-1'}>
        <PaymentDatePopover
          occ={occ}
          title="Отметить оплату"
          confirmLabel="Отметить оплату"
          initial={actions.todayIso}
          onConfirm={(iso) => actions.markPaid(occ, iso)}
        >
          <Button variant="secondary" size="sm" className={fill ? 'flex-1' : undefined}>
            <Check aria-hidden />
            Отметить оплату
          </Button>
        </PaymentDatePopover>
        <ReceiptPopover occ={occ} />
      </div>
    )
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <ReceiptPopover occ={occ} />
      <PaymentDatePopover
        occ={occ}
        title="Исправить дату оплаты"
        confirmLabel="Сохранить дату"
        initial={occ.paid_at ?? actions.todayIso}
        onConfirm={(iso) => actions.fixDate(occ, iso)}
      >
        <Button variant="ghost" size="icon-sm" aria-label={`Исправить дату оплаты: ${occ.recurring_payment.name}`}>
          <Pencil aria-hidden />
        </Button>
      </PaymentDatePopover>
      <Tooltip content="Снять отметку об оплате">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Снять отметку об оплате: ${occ.recurring_payment.name}`}
          onClick={() => actions.markUnpaid(occ)}
        >
          <Undo2 aria-hidden />
        </Button>
      </Tooltip>
    </div>
  )
}

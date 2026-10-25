import { zodResolver } from '@hookform/resolvers/zod'
import { Paperclip, Plus, ReceiptText, Search, X } from 'lucide-react'
import { useDeferredValue, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, fieldAria } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Listbox, ListboxContent, ListboxItem, ListboxTrigger, ListboxValue } from '@/components/ui/listbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { type Occurrence, useOccurrences } from '@/features/occurrences/api'
import { formatDate, formatMoney } from '@/lib/format'
import {
  ACCEPT,
  MAX_FILE_MB,
  MAX_FILES,
  MAX_PAYMENTS,
  type Ticket,
  type TicketTopic,
  topicLabels,
  useCreateTicket,
} from './api'
import { FileRow, type PaymentSummary, PaymentRow } from './TicketParts'

const schema = z.object({
  topic: z.enum(['question', 'bug', 'payment', 'access', 'other'], { error: 'Выберите тему' }),
  description: z.string().trim().min(1, 'Опишите вопрос или неполадку').max(4000, 'Не длиннее 4000 символов'),
})
type FormValues = z.infer<typeof schema>

const toSummary = (occ: Occurrence): PaymentSummary => ({
  id: occ.id,
  name: occ.recurring_payment.name,
  due_date: occ.due_date,
  amount: occ.amount,
  currency: occ.currency,
  paid: occ.status === 'paid',
})

/** Поиск периода по названию платежа; содержимое смонтировано, только пока поповер открыт. */
function PaymentSearch({ selected, onPick }: { selected: number[]; onPick: (occ: Occurrence) => void }) {
  const [q, setQ] = useState('')
  const query = useDeferredValue(q.trim())
  const results = useOccurrences({ q: query || undefined, sort: '-due_date', limit: 8 })
  const items = (results.data?.items ?? []).filter((occ) => !selected.includes(occ.id))

  return (
    <div className="grid gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-tertiary" aria-hidden />
        <Input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Название платежа"
          aria-label="Найти платёж"
          className="pl-9"
          autoFocus
        />
      </div>
      {results.isPending ? (
        <div className="grid gap-1.5" aria-busy="true" aria-label="Загрузка платежей">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div>
      ) : items.length === 0 ? (
        <p className="px-1 py-2 text-sm text-fg-tertiary">{query ? 'Ничего не нашлось' : 'Все платежи уже приложены'}</p>
      ) : (
        <ul className="grid gap-0.5" aria-label="Найденные платежи">
          {items.map((occ) => (
            <li key={occ.id}>
              <button
                type="button"
                onClick={() => onPick(occ)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left outline-none hover:bg-secondary-hover focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">{occ.recurring_payment.name}</span>
                  <span className="text-xs text-fg-tertiary tabular">Срок {formatDate(occ.due_date)}</span>
                </span>
                <span className="shrink-0 text-sm tabular">{formatMoney(occ.amount, occ.currency)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Период, из карточки которого открыли форму: уже приложен, тема «Ошибка в платеже». */
  occurrence?: Occurrence
  onCreated?: (ticket: Ticket) => void
}

export function CreateTicketDialog({ open, onOpenChange, occurrence, onCreated }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Новая заявка"
        description="Администратор увидит заявку в своей очереди и ответит здесь же."
        className="max-w-xl"
      >
        {/* Содержимое диалога монтируется при каждом открытии: форма всегда начинается с чистого листа. */}
        <TicketForm occurrence={occurrence} onClose={() => onOpenChange(false)} onCreated={onCreated} />
      </DialogContent>
    </Dialog>
  )
}

function TicketForm({ occurrence, onClose, onCreated }: Pick<Props, 'occurrence' | 'onCreated'> & { onClose: () => void }) {
  const create = useCreateTicket()
  const fileInput = useRef<HTMLInputElement>(null)
  const [payments, setPayments] = useState<PaymentSummary[]>(() => (occurrence ? [toSummary(occurrence)] : []))
  const [files, setFiles] = useState<File[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { topic: occurrence ? 'payment' : undefined, description: '' },
  })
  const { register, control, handleSubmit, setError, formState } = form
  const errors = formState.errors

  const addFiles = (picked: File[]) => {
    const tooBig = picked.filter((file) => file.size > MAX_FILE_MB * 1024 * 1024)
    if (tooBig.length) toast.error(`Файл больше ${MAX_FILE_MB} МБ`, { description: tooBig.map((f) => f.name).join(', ') })
    const fitting = picked.filter((file) => !tooBig.includes(file))
    const room = MAX_FILES - files.length
    if (fitting.length > room) toast.error(`Не больше ${MAX_FILES} файлов в заявке`)
    setFiles([...files, ...fitting.slice(0, Math.max(0, room))])
  }

  const onSubmit = handleSubmit((values) =>
    create.mutate(
      { topic: values.topic, description: values.description.trim(), occurrenceIds: payments.map((p) => p.id), files },
      {
        onSuccess: (ticket) => {
          toast.success(`Заявка №${ticket.id} отправлена`, { description: 'Администратор ответит в разделе «Заявки»' })
          onClose()
          onCreated?.(ticket)
        },
        onError: (error) => {
          const message = error instanceof ApiError ? error.message : 'Не удалось отправить. Попробуйте ещё раз'
          if (error instanceof ApiError && (error.status === 422 || error.status === 413)) setError('root', { message })
          else toast.error('Заявка не отправлена', { description: message })
        },
      },
    ),
  )

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {errors.root && (
        <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
          {errors.root.message}
        </p>
      )}

      <Field id="t-topic" label="Тема" error={errors.topic?.message}>
        <Controller
          control={control}
          name="topic"
          render={({ field }) => (
            <Listbox value={field.value ?? ''} onValueChange={(value) => field.onChange(value as TicketTopic)}>
              <ListboxTrigger id="t-topic" aria-invalid={errors.topic ? true : undefined} ref={field.ref}>
                <ListboxValue placeholder="Выберите тему" />
              </ListboxTrigger>
              <ListboxContent>
                {(Object.keys(topicLabels) as TicketTopic[]).map((key) => (
                  <ListboxItem key={key} value={key}>
                    {topicLabels[key]}
                  </ListboxItem>
                ))}
              </ListboxContent>
            </Listbox>
          )}
        />
      </Field>

      <Field
        id="t-description"
        label="Описание"
        hint="Что вы делали, что ожидали увидеть и что произошло на самом деле"
        error={errors.description?.message}
      >
        <Textarea
          {...fieldAria('t-description', errors.description?.message, true)}
          {...register('description')}
          rows={5}
          placeholder="Например: отметил оплату аренды, но период остался в «К оплате»"
        />
      </Field>

      <section className="grid gap-2" aria-labelledby="t-payments-label">
        <div className="flex items-center justify-between gap-3">
          <h3 id="t-payments-label" className="text-[0.8125rem] font-medium text-fg">
            Платежи
          </h3>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" disabled={payments.length >= MAX_PAYMENTS}>
                <Plus aria-hidden />
                Приложить платёж
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" aria-label="Выбор платежа">
              <PaymentSearch
                selected={payments.map((p) => p.id)}
                onPick={(occ) => {
                  setPayments([...payments, toSummary(occ)])
                  setPickerOpen(false)
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
        {payments.length > 0 ? (
          <ul className="grid gap-1.5" aria-label="Приложенные платежи">
            {payments.map((payment) => (
              <PaymentRow
                key={payment.id}
                payment={payment}
                action={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Убрать платёж ${payment.name}`}
                    onClick={() => setPayments(payments.filter((p) => p.id !== payment.id))}
                  >
                    <X aria-hidden />
                  </Button>
                }
              />
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-[0.8125rem] text-fg-tertiary">
            <ReceiptText className="size-4 shrink-0" aria-hidden />
            Если вопрос о конкретном платеже, приложите его: администратор сразу увидит сумму и срок
          </p>
        )}
      </section>

      <section className="grid gap-2" aria-labelledby="t-files-label">
        <div className="flex items-center justify-between gap-3">
          <h3 id="t-files-label" className="text-[0.8125rem] font-medium text-fg">
            Файлы
          </h3>
          <Button variant="ghost" size="sm" disabled={files.length >= MAX_FILES} onClick={() => fileInput.current?.click()}>
            <Paperclip aria-hidden />
            Прикрепить файлы
          </Button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Выбрать файлы"
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
        {files.length > 0 ? (
          <ul className="grid gap-1.5" aria-label="Прикреплённые файлы">
            {files.map((file, index) => (
              <FileRow
                key={`${file.name}-${index}`}
                name={file.name}
                size={file.size}
                contentType={file.type}
                onRemove={() => setFiles(files.filter((_, i) => i !== index))}
              />
            ))}
          </ul>
        ) : (
          <p className="text-[0.8125rem] text-fg-tertiary">
            Скриншот ошибки или документ: PDF, PNG или JPG до {MAX_FILE_MB} МБ, не больше {MAX_FILES} файлов
          </p>
        )}
      </section>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Отмена
        </Button>
        <Button type="submit" variant="primary" loading={create.isPending}>
          Отправить заявку
        </Button>
      </DialogFooter>
    </form>
  )
}

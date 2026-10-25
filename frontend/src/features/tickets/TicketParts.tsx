import { FileImage, FileText, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { type Currency, formatDate, formatMoney } from '@/lib/format'
import { statusMeta, type TicketStatus } from './api'

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const { label, tone, icon: Icon } = statusMeta[status]
  return (
    <Badge tone={tone}>
      <Icon aria-hidden />
      {label}
    </Badge>
  )
}

export function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`
}

export interface PaymentSummary {
  id: number
  name: string
  due_date: string
  amount: string
  currency: Currency
  paid: boolean
}

/** Платёж, приложенный к заявке: название и сумма, под ними срок; в узкой колонке сумма уходит под название. */
export function PaymentRow({ payment, action }: { payment: PaymentSummary; action?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-subtle bg-raised py-2 pr-1.5 pl-3">
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="max-w-full min-w-0 truncate text-sm font-medium">{payment.name}</span>
          <span className="font-display text-sm font-bold whitespace-nowrap tabular">{formatMoney(payment.amount, payment.currency)}</span>
        </span>
        <span className="text-xs text-fg-tertiary">
          Срок <span className="tabular">{formatDate(payment.due_date)}</span>
          {payment.paid ? ', оплачен' : ', не оплачен'}
        </span>
      </div>
      {action}
    </li>
  )
}

/** Файл заявки: иконка по типу, имя и размер; ссылка на просмотр или кнопка «убрать» в форме. */
export function FileRow({
  name,
  size,
  contentType,
  href,
  onRemove,
}: {
  name: string
  size: number
  contentType: string
  href?: string
  onRemove?: () => void
}) {
  const Icon = contentType.startsWith('image/') ? FileImage : FileText
  const label = (
    <>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-sunken text-fg-secondary">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 truncate">{name}</span>
      <span className="ml-auto shrink-0 text-xs text-fg-tertiary tabular">{formatSize(size)}</span>
    </>
  )
  return (
    <li className="flex items-center gap-2 rounded-lg border border-subtle bg-raised py-1.5 pr-1.5 pl-1.5 text-sm">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md pr-1.5 text-link outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {label}
        </a>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2.5 pr-1.5">{label}</span>
      )}
      {onRemove && (
        <Button variant="ghost" size="icon-sm" aria-label={`Убрать файл ${name}`} onClick={onRemove}>
          <X aria-hidden />
        </Button>
      )}
    </li>
  )
}

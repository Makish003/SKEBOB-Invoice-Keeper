import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { cn } from '@/lib/cn'
import { formatDate, formatMoney, relativeDue } from '@/lib/format'
import type { Occurrence } from './api'
import { OccurrenceActions } from './OccurrenceActions'
import { lateText, StatusBadge } from './StatusBadge'

type Display = Occurrence['display_status']

/** Плитка срока окрашена по срочности; у оплаченных срок уже не важен, плитка нейтральная. */
const tileTone: Record<Display, string> = {
  overdue: 'bg-danger-bg text-danger',
  due_today: 'bg-warning-bg text-warning',
  due_soon: 'bg-info-bg text-info',
  upcoming: 'bg-sunken text-fg',
  paid: 'bg-sunken text-fg-tertiary',
  paid_late: 'bg-sunken text-fg-tertiary',
}

/** Срок на сплошной скруглённой плитке (стр. 21 гайдбука): число и месяц. Полная дата есть текстом, плитка скрыта от чтеца. */
function DueTile({ occ }: { occ: Occurrence }) {
  const date = parseISO(occ.due_date)
  return (
    <div
      aria-hidden
      className={cn('grid size-14 shrink-0 content-center justify-items-center rounded-lg', tileTone[occ.display_status])}
    >
      <span className="font-display text-xl leading-none font-bold tabular">{format(date, 'd')}</span>
      <span className="text-[0.6875rem] leading-4 font-medium">{format(date, 'LLL', { locale: ru }).replace('.', '')}</span>
    </div>
  )
}

/** Период платежа карточкой: срок и название, сумма со статусом, внизу оплата и действия. */
export function PaymentCard({ occ }: { occ: Occurrence }) {
  const extra = lateText(occ)
  const unpaid = occ.status === 'unpaid'
  return (
    <article
      aria-label={`${occ.recurring_payment.name}, период ${occ.seq + 1}`}
      className={cn(
        'flex h-full flex-col gap-4 rounded-xl border border-subtle bg-raised p-4 shadow-raised',
        occ.display_status === 'overdue' && 'border-danger/30',
      )}
    >
      <header className="flex items-start gap-3">
        <DueTile occ={occ} />
        <div className="grid min-w-0 gap-0.5 pt-1">
          <h3 className="font-display leading-snug font-bold break-words text-fg">{occ.recurring_payment.name}</h3>
          <span className="text-xs text-fg-tertiary">
            Период {occ.seq + 1}
            {!occ.recurring_payment.is_active && ', платёж прекращён'}
          </span>
        </div>
      </header>

      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <span className="font-display text-2xl font-bold tracking-tight tabular">{formatMoney(occ.amount, occ.currency)}</span>
          <StatusBadge status={occ.display_status} />
        </div>
        <p className="text-sm text-fg-secondary">
          Срок <span className="text-fg tabular">{formatDate(occ.due_date)}</span>
          {unpaid && <span className="text-fg-tertiary">, {relativeDue(occ.days_until_due)}</span>}
        </p>
      </div>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-subtle pt-3">
        {!unpaid && (
          <div className="grid min-w-0 text-sm">
            <span className="text-fg-secondary">
              Оплачено <span className="text-fg tabular">{occ.paid_at && formatDate(occ.paid_at)}</span>
            </span>
            {extra && <span className="text-xs text-warning">{extra}</span>}
            {occ.paid_by_label && <span className="truncate text-xs text-fg-tertiary">{occ.paid_by_label}</span>}
          </div>
        )}
        <OccurrenceActions occ={occ} fill={unpaid} />
      </footer>
    </article>
  )
}

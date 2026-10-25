import { Archive, Ellipsis, Pencil, Repeat, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { CardGrid, cardGridClass, ItemCard, Tile } from '@/components/CardGrid'
import { Page, PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Segmented } from '@/components/ui/tabs'
import { DueTile } from '@/features/occurrences/PaymentCard'
import { StatusBadge } from '@/features/occurrences/StatusBadge'
import { formatDate, formatDateTime, formatMoney, relativeDue } from '@/lib/format'
import { periodLabels, type RecurringPayment, useDeleteRecurring, useRecurringPayments } from './api'
import { CreateRecurringDialog } from './CreateRecurringDialog'
import { EditRecurringDialog } from './EditRecurringDialog'

type View = 'active' | 'archived'

/** Действия над платежом в меню: опасное «Прекратить» не стоит открыто на каждой карточке. */
function PaymentMenu({ payment, onEdit, onDelete }: { payment: RecurringPayment; onEdit: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Действия: ${payment.name}`}>
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      {/* Фокус не возвращается на кнопку меню: иначе открытый из меню диалог сразу закрылся бы (фокус «снаружи»). */}
      <DropdownMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil aria-hidden />
          Изменить
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={onDelete}>
          <Trash2 aria-hidden />
          Прекратить
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Низ карточки: ближайший срок со статусом; у прекращённого платежа дата прекращения. */
function NextDue({ payment }: { payment: RecurringPayment }) {
  if (!payment.is_active) {
    return (
      <span className="text-sm text-fg-tertiary">
        Прекращён <span className="tabular">{payment.deleted_at ? formatDateTime(payment.deleted_at) : ''}</span>
      </span>
    )
  }
  const next = payment.next_occurrence
  if (!next) return <span className="text-sm text-fg-tertiary">Ближайшего срока нет</span>
  return (
    <>
      <span className="text-sm text-fg-secondary">
        Ближайший срок <span className="text-fg tabular">{formatDate(next.due_date)}</span>
        <span className="text-fg-tertiary">, {relativeDue(next.days_until_due)}</span>
      </span>
      <StatusBadge status={next.display_status} />
    </>
  )
}

interface RecurringCardProps {
  payment: RecurringPayment
  onEdit: () => void
  onDelete: () => void
}

/** Регулярный платёж карточкой: плитка ближайшего срока, название ведёт к его периодам, сумма и периодичность. */
function RecurringCard({ payment, onEdit, onDelete }: RecurringCardProps) {
  const next = payment.is_active ? payment.next_occurrence : null
  return (
    <ItemCard aria-label={payment.name}>
      <header className="flex items-start gap-3">
        {next ? (
          <DueTile due={next.due_date} status={next.display_status} />
        ) : (
          <Tile className="bg-sunken text-fg-tertiary">{payment.is_active ? <Repeat /> : <Archive />}</Tile>
        )}
        <div className="grid min-w-0 flex-1 gap-0.5 pt-1">
          <h3 className="font-display leading-snug font-bold break-words">
            <Link
              to={`/payments?tab=all&q=${encodeURIComponent(payment.name)}${payment.is_active ? '' : '&archived=1'}`}
              className="rounded-sm text-fg underline-offset-2 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {payment.name}
            </Link>
          </h3>
          {payment.description && <span className="text-xs break-words text-fg-tertiary">{payment.description}</span>}
        </div>
        {payment.is_active && <PaymentMenu payment={payment} onEdit={onEdit} onDelete={onDelete} />}
      </header>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className="font-display text-2xl font-bold tracking-tight tabular">{formatMoney(payment.amount, payment.currency)}</span>
        <Badge tone="outline">{periodLabels[payment.period]}</Badge>
      </div>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-subtle pt-3">
        <NextDue payment={payment} />
      </footer>
    </ItemCard>
  )
}

export function RecurringPage() {
  const [view, setView] = useState<View>('active')
  const [toDelete, setToDelete] = useState<RecurringPayment | null>(null)
  const [toEdit, setToEdit] = useState<RecurringPayment | null>(null)
  const list = useRecurringPayments()
  const remove = useDeleteRecurring()

  const all = list.data?.items ?? []
  const active = all.filter((p) => p.is_active)
  const archived = all.filter((p) => !p.is_active)
  const items = view === 'active' ? active : archived

  const confirmDelete = () => {
    if (!toDelete) return
    remove.mutate(toDelete.id, {
      onSuccess: () => {
        toast.success('Платёж прекращён', { description: `${toDelete.name}: история оплат сохранена` })
        setToDelete(null)
      },
      onError: (error) => {
        toast.error('Не удалось прекратить платёж', {
          description: error instanceof ApiError ? error.message : 'Попробуйте ещё раз',
        })
      },
    })
  }

  return (
    <Page>
      <PageHeader
        title="Регулярные платежи"
        description="Шаблоны повторяющихся расходов. Периоды и напоминания создаются по ним автоматически."
        actions={<CreateRecurringDialog />}
      />

      <Segmented<View>
        label="Показать платежи"
        value={view}
        onChange={setView}
        options={[
          { value: 'active', label: 'Активные', count: list.data ? active.length : undefined },
          { value: 'archived', label: 'Прекращённые', count: list.data ? archived.length : undefined },
        ]}
      />

      {list.isPending ? (
        <div className={cardGridClass} aria-busy="true" aria-label="Загрузка">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          {view === 'active' ? (
            <EmptyState
              icon={<Repeat aria-hidden />}
              title="Регулярных платежей пока нет"
              description="Добавьте аренду, подписку или оплату сервера: система сама создаст периоды и напомнит о сроке."
              action={<CreateRecurringDialog />}
            />
          ) : (
            <EmptyState
              icon={<Archive aria-hidden />}
              title="Прекращённых платежей нет"
              description="Здесь появятся платежи, которые больше не повторяются. Их история оплат сохраняется."
            />
          )}
        </Card>
      ) : (
        <CardGrid items={items} label={view === 'active' ? 'Активные платежи' : 'Прекращённые платежи'} listKey={view}>
          {(payment) => <RecurringCard payment={payment} onEdit={() => setToEdit(payment)} onDelete={() => setToDelete(payment)} />}
        </CardGrid>
      )}

      <EditRecurringDialog payment={toEdit} onClose={() => setToEdit(null)} />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={`Прекратить платёж «${toDelete?.name ?? ''}»?`}
        description="Новые периоды и напоминания больше не появятся, неоплаченные будущие периоды удалятся. Прошлые периоды и отметки об оплате сохранятся в истории."
        confirmLabel="Прекратить платёж"
        destructive
        loading={remove.isPending}
        onConfirm={confirmDelete}
      />
    </Page>
  )
}

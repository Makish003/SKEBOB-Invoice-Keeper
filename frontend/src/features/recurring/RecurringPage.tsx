import { motion } from 'motion/react'
import { Archive, Repeat, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { Page, PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Segmented } from '@/components/ui/tabs'
import { Table, TD, TH, THead } from '@/components/ui/table'
import { StatusBadge } from '@/features/occurrences/StatusBadge'
import { formatDate, formatDateTime, formatMoney, relativeDue } from '@/lib/format'
import { fadeUp, reduced, stagger, useReducedMotion } from '@/lib/motion'
import { periodLabels, type RecurringPayment, useDeleteRecurring, useRecurringPayments } from './api'
import { CreateRecurringDialog } from './CreateRecurringDialog'

type View = 'active' | 'archived'

function NextDue({ payment }: { payment: RecurringPayment }) {
  if (!payment.is_active) {
    return <span className="text-fg-tertiary">Прекращён {payment.deleted_at ? formatDateTime(payment.deleted_at) : ''}</span>
  }
  const next = payment.next_occurrence
  if (!next) return <span className="text-fg-tertiary">Нет</span>
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="grid">
        <span className="tabular">{formatDate(next.due_date)}</span>
        <span className="text-xs text-fg-tertiary">{relativeDue(next.days_until_due)}</span>
      </span>
      <StatusBadge status={next.display_status} />
    </div>
  )
}

export function RecurringPage() {
  const [view, setView] = useState<View>('active')
  const [toDelete, setToDelete] = useState<RecurringPayment | null>(null)
  const list = useRecurringPayments()
  const remove = useDeleteRecurring()
  const reduce = useReducedMotion()
  const variants = reduce ? reduced : fadeUp

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

      <Card className="overflow-hidden">
        {list.isPending ? (
          <div className="grid gap-3 p-4" aria-busy="true" aria-label="Загрузка">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : items.length === 0 ? (
          view === 'active' ? (
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
          )
        ) : (
          <>
            <div className="hidden md:block">
              <Table aria-label={view === 'active' ? 'Активные платежи' : 'Прекращённые платежи'}>
                <THead>
                  <tr>
                    <TH className="pl-4">Название</TH>
                    <TH className="text-right">Сумма</TH>
                    <TH>Периодичность</TH>
                    <TH>{view === 'active' ? 'Ближайший срок' : 'Статус'}</TH>
                    <TH className="pr-4 text-right">
                      <span className="sr-only">Действия</span>
                    </TH>
                  </tr>
                </THead>
                <motion.tbody key={view} initial="hidden" animate="show" variants={stagger(0.03)} className="[&>tr:last-child]:border-0">
                  {items.map((payment) => (
                    <motion.tr key={payment.id} variants={variants} className="border-b border-subtle transition-control hover:bg-page">
                      <TD className="max-w-72 pl-4">
                        <div className="grid min-w-0">
                          <Link
                            to={`/payments?tab=all&q=${encodeURIComponent(payment.name)}${payment.is_active ? '' : '&archived=1'}`}
                            className="truncate font-medium text-fg underline-offset-2 hover:underline"
                          >
                            {payment.name}
                          </Link>
                          {payment.description && <span className="truncate text-xs text-fg-tertiary">{payment.description}</span>}
                        </div>
                      </TD>
                      <TD className="text-right font-medium whitespace-nowrap tabular">
                        {formatMoney(payment.amount, payment.currency)}
                      </TD>
                      <TD>
                        <Badge tone="outline">{periodLabels[payment.period]}</Badge>
                      </TD>
                      <TD>
                        <NextDue payment={payment} />
                      </TD>
                      <TD className="pr-4 text-right">
                        {payment.is_active && (
                          <Button variant="destructive-ghost" size="sm" onClick={() => setToDelete(payment)}>
                            <Trash2 aria-hidden />
                            Прекратить
                          </Button>
                        )}
                      </TD>
                    </motion.tr>
                  ))}
                </motion.tbody>
              </Table>
            </div>
            <motion.ul key={`m-${view}`} initial="hidden" animate="show" variants={stagger(0.03)} className="divide-y divide-subtle md:hidden">
              {items.map((payment) => (
                <motion.li key={payment.id} variants={variants} className="grid gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid min-w-0">
                      <span className="truncate font-medium">{payment.name}</span>
                      <span className="text-xs text-fg-tertiary">{periodLabels[payment.period]}</span>
                    </div>
                    <span className="shrink-0 font-semibold tabular">{formatMoney(payment.amount, payment.currency)}</span>
                  </div>
                  <NextDue payment={payment} />
                  {payment.is_active && (
                    <Button variant="destructive-ghost" size="sm" className="justify-self-start" onClick={() => setToDelete(payment)}>
                      <Trash2 aria-hidden />
                      Прекратить
                    </Button>
                  )}
                </motion.li>
              ))}
            </motion.ul>
          </>
        )}
      </Card>

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

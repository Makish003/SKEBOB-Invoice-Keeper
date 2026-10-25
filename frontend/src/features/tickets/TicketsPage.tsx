import { ChevronLeft, ChevronRight, LifeBuoy, MessageSquareReply, Paperclip, Plus, ReceiptText } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Page, PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Segmented } from '@/components/ui/tabs'
import { useCurrentUser } from '@/features/auth/guards'
import { formatDateTime } from '@/lib/format'
import { fadeUp, reduced, stagger, useReducedMotion } from '@/lib/motion'
import { type Ticket, type TicketStatus, topicLabels, useTicketCount, useTickets } from './api'
import { CreateTicketDialog } from './CreateTicketDialog'
import { TicketDialog } from './TicketDialog'
import { TicketStatusBadge } from './TicketParts'

const PAGE_SIZE = 20

type Filter = 'all' | TicketStatus
const filters: Filter[] = ['all', 'open', 'in_progress', 'resolved']
const filterLabels: Record<Filter, string> = { all: 'Все', open: 'Новые', in_progress: 'В работе', resolved: 'Решённые' }

/** Строка очереди: тема и номер ведут, под ними начало описания; справа статус, внизу автор, дата и вложения. */
function TicketRow({ ticket, isAdmin, onOpen }: { ticket: Ticket; isAdmin: boolean; onOpen: () => void }) {
  const answered = !isAdmin && ticket.admin_reply
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full gap-1.5 px-4 py-3.5 text-left outline-none hover:bg-secondary-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-5"
    >
      <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="text-sm text-fg-tertiary tabular">№{ticket.id}</span>
          <span className="truncate font-display font-bold">{topicLabels[ticket.topic]}</span>
        </span>
        <TicketStatusBadge status={ticket.status} />
      </span>
      <span className="line-clamp-2 text-sm text-fg-secondary break-words">{ticket.description}</span>
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-tertiary">
        {isAdmin && <span className="text-fg-secondary">{ticket.author.display_name}</span>}
        <time dateTime={ticket.created_at} className="tabular">
          {formatDateTime(ticket.created_at)}
        </time>
        {ticket.payments.length > 0 && (
          <span className="flex items-center gap-1">
            <ReceiptText className="size-3.5" aria-hidden />
            Платежей: {ticket.payments.length}
          </span>
        )}
        {ticket.attachments.length > 0 && (
          <span className="flex items-center gap-1">
            <Paperclip className="size-3.5" aria-hidden />
            Файлов: {ticket.attachments.length}
          </span>
        )}
        {answered && (
          <span className="flex items-center gap-1 text-link">
            <MessageSquareReply className="size-3.5" aria-hidden />
            Есть ответ
          </span>
        )}
      </span>
    </button>
  )
}

export function TicketsPage() {
  const user = useCurrentUser()
  const isAdmin = user.role === 'admin'
  const reduce = useReducedMotion()
  const [params, setParams] = useSearchParams()
  const [createOpen, setCreateOpen] = useState(false)

  const filterParam = params.get('status') as Filter | null
  const filter: Filter = filterParam && filters.includes(filterParam) ? filterParam : 'all'
  const page = Math.max(1, Number(params.get('page')) || 1)
  const openId = Number(params.get('ticket')) || null
  const update = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        Object.entries(patch).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)))
        return next
      },
      { replace: true },
    )

  const tickets = useTickets(filter === 'all' ? null : filter, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
  const openCount = useTicketCount('open')
  const progressCount = useTicketCount('in_progress')
  const items = tickets.data?.items ?? []
  const total = tickets.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const variants = reduce ? reduced : fadeUp

  const newButton = (
    <Button variant="primary" onClick={() => setCreateOpen(true)}>
      <Plus aria-hidden />
      Новая заявка
    </Button>
  )

  return (
    <Page>
      <PageHeader
        title="Заявки"
        description={
          isAdmin
            ? 'Вопросы и неполадки от пользователей. Возьмите заявку в работу и ответьте: пользователь увидит ответ у себя.'
            : 'Вопрос по работе сервиса или что-то сломалось? Напишите администратору, приложите платежи и скриншоты.'
        }
        actions={isAdmin ? undefined : newButton}
        stats={[
          { label: 'Новые', value: openCount.data ?? '0' },
          { label: 'В работе', value: progressCount.data ?? '0' },
        ]}
      />

      <Segmented<Filter>
        label="Статус заявок"
        value={filter}
        onChange={(value) => update({ status: value === 'all' ? null : value, page: null })}
        options={filters.map((value) => ({
          value,
          label: filterLabels[value],
          count: value === 'open' ? openCount.data : value === 'in_progress' ? progressCount.data : undefined,
        }))}
        className="justify-self-start"
      />

      <Card className="overflow-hidden">
        {tickets.isPending ? (
          <div className="grid gap-3 p-4" aria-busy="true" aria-label="Загрузка заявок">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : tickets.isError ? (
          <ErrorState error={tickets.error} onRetry={() => tickets.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<LifeBuoy aria-hidden />}
            title={filter === 'all' ? (isAdmin ? 'Заявок пока нет' : 'Вы ещё не писали администратору') : `Нет заявок «${filterLabels[filter]}»`}
            description={
              filter !== 'all'
                ? 'Выберите другой статус.'
                : isAdmin
                  ? 'Когда пользователь сообщит о вопросе или неполадке, заявка появится здесь.'
                  : 'Если что-то непонятно или работает не так, создайте заявку.'
            }
            action={!isAdmin && filter === 'all' ? newButton : undefined}
          />
        ) : (
          <>
            <motion.ul
              key={`${filter}-${page}`}
              initial="hidden"
              animate="show"
              variants={stagger(0.03)}
              aria-label="Заявки"
              className="divide-y divide-subtle"
            >
              {items.map((ticket) => (
                <motion.li key={ticket.id} variants={variants}>
                  <TicketRow ticket={ticket} isAdmin={isAdmin} onOpen={() => update({ ticket: String(ticket.id) })} />
                </motion.li>
              ))}
            </motion.ul>
            {total > PAGE_SIZE && (
              <nav aria-label="Страницы" className="flex items-center justify-between gap-3 border-t border-subtle px-4 py-3 sm:px-5">
                <p className="text-fg-tertiary tabular">
                  {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} из {total}
                </p>
                <div className="flex gap-1">
                  <Button variant="secondary" size="icon-sm" aria-label="Предыдущая страница" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
                    <ChevronLeft aria-hidden />
                  </Button>
                  <Button variant="secondary" size="icon-sm" aria-label="Следующая страница" disabled={page >= pages} onClick={() => update({ page: String(page + 1) })}>
                    <ChevronRight aria-hidden />
                  </Button>
                </div>
              </nav>
            )}
          </>
        )}
      </Card>

      <CreateTicketDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(ticket) => update({ ticket: String(ticket.id), status: null, page: null })}
      />
      <TicketDialog id={openId} onClose={() => update({ ticket: null })} />
    </Page>
  )
}

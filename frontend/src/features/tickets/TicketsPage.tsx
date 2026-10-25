import { isSameDay } from 'date-fns'
import { ChevronLeft, ChevronRight, LifeBuoy, Plus } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Page, PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Segmented } from '@/components/ui/tabs'
import { useAppInfo } from '@/features/app-info'
import { useCurrentUser } from '@/features/auth/guards'
import { cn } from '@/lib/cn'
import { formatDate } from '@/lib/format'
import { type Ticket, type TicketStatus, topicLabels, useTicketCount, useTickets } from './api'
import { CreateTicketDialog } from './CreateTicketDialog'
import { TicketChat } from './TicketChat'
import { TicketStatusBadge } from './TicketParts'

const PAGE_SIZE = 30

type Filter = 'all' | TicketStatus
const filters: Filter[] = ['all', 'open', 'in_progress', 'resolved']
const filterLabels: Record<Filter, string> = { all: 'Все', open: 'Новые', in_progress: 'В работе', resolved: 'Решённые' }

const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

/** Последнее сообщение заявки для превью в списке: «Вы: …» для своих, файл, если текста нет. */
function preview(ticket: Ticket, userId: number): string {
  const last = ticket.messages.at(-1)
  const author = last?.author ?? ticket.author
  const text = last ? last.body || `Файл: ${last.attachments[0]?.file_name ?? ''}` : ticket.description
  return author.id === userId ? `Вы: ${text}` : text
}

/** Строка списка чатов: тема и время последнего сообщения, превью, статус; непрочитанное выделено жирным и точкой. */
function ChatRow({ ticket, active, onOpen }: { ticket: Ticket; active: boolean; onOpen: () => void }) {
  const user = useCurrentUser()
  const { today } = useAppInfo()
  const at = new Date(ticket.last_message_at)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'grid w-full gap-1 px-4 py-3 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        active ? 'bg-sunken' : 'hover:bg-secondary-hover',
      )}
    >
      <span className="flex items-baseline gap-2">
        <span className={cn('min-w-0 flex-1 truncate font-display', ticket.unread ? 'font-extrabold' : 'font-bold')}>
          {topicLabels[ticket.topic]}
        </span>
        <time dateTime={ticket.last_message_at} className="shrink-0 text-xs text-fg-tertiary tabular">
          {isSameDay(at, today) ? timeFormat.format(at) : formatDate(ticket.last_message_at.slice(0, 10))}
        </time>
      </span>
      <span className="flex items-center gap-2">
        <span className={cn('min-w-0 flex-1 truncate text-sm', ticket.unread ? 'text-fg' : 'text-fg-secondary')}>
          {preview(ticket, user.id)}
        </span>
        {ticket.unread && (
          <span className="size-2.5 shrink-0 rounded-full bg-primary">
            <span className="sr-only">Есть непрочитанные</span>
          </span>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-tertiary">
        <span className="tabular">№{ticket.id}</span>
        {user.role === 'admin' && <span className="truncate text-fg-secondary">{ticket.author.display_name}</span>}
        <TicketStatusBadge status={ticket.status} />
      </span>
    </button>
  )
}

export function TicketsPage() {
  const user = useCurrentUser()
  const isAdmin = user.role === 'admin'
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
  const unreadCount = useTicketCount({ unread: true })
  const openCount = useTicketCount({ status: 'open' })
  const progressCount = useTicketCount({ status: 'in_progress' })
  const items = tickets.data?.items ?? []
  const total = tickets.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

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
            ? 'Вопросы и неполадки от пользователей. У каждой заявки своя переписка: ответьте в чате и смените статус.'
            : 'Вопрос по работе сервиса или что-то сломалось? Создайте заявку: у неё будет своя переписка с администратором.'
        }
        actions={isAdmin ? undefined : newButton}
        stats={[
          { label: 'Непрочитанные', value: unreadCount.data ?? '0' },
          { label: 'Новые', value: openCount.data ?? '0' },
          { label: 'В работе', value: progressCount.data ?? '0' },
        ]}
      />

      {/* Мессенджер: список чатов и открытый чат. Уже 1280 px (с боковой панелью чату тесно) по одному: список или переписка. */}
      <Card className="grid h-[calc(100dvh-5rem)] min-h-[30rem] overflow-hidden lg:h-[min(48rem,calc(100dvh-4rem))] xl:grid-cols-[22rem_minmax(0,1fr)]">
        <aside
          aria-label="Список заявок"
          className={cn('grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border-subtle xl:border-r', openId !== null && 'hidden xl:grid')}
        >
          <div className="border-b border-subtle p-3">
            <Segmented<Filter>
              label="Статус заявок"
              value={filter}
              onChange={(value) => update({ status: value === 'all' ? null : value, page: null })}
              options={filters.map((value) => ({ value, label: filterLabels[value] }))}
            />
          </div>
          <div className="min-h-0 overflow-y-auto">
            {tickets.isPending ? (
              <div className="grid gap-2 p-3" aria-busy="true" aria-label="Загрузка заявок">
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
              <ul aria-label="Заявки" className="divide-y divide-subtle">
                {items.map((ticket) => (
                  <li key={ticket.id}>
                    <ChatRow ticket={ticket} active={ticket.id === openId} onOpen={() => update({ ticket: String(ticket.id) })} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {total > PAGE_SIZE && (
            <nav aria-label="Страницы" className="flex items-center justify-between gap-3 border-t border-subtle px-4 py-2">
              <p className="text-sm text-fg-tertiary tabular">
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
        </aside>
        <div className={cn('min-h-0', openId === null ? 'hidden xl:grid' : 'grid')}>
          <TicketChat id={openId} onBack={() => update({ ticket: null })} />
        </div>
      </Card>

      <CreateTicketDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(ticket) => update({ ticket: String(ticket.id), status: null, page: null })}
      />
    </Page>
  )
}

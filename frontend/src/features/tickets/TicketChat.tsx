import { isSameDay, subDays } from 'date-fns'
import { ArrowLeft, ExternalLink, FileImage, FileText, MessagesSquare, Paperclip, SendHorizontal, X } from 'lucide-react'
import { motion } from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Listbox, ListboxContent, ListboxItem, ListboxTrigger, ListboxValue } from '@/components/ui/listbox'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Textarea } from '@/components/ui/textarea'
import { useAppInfo } from '@/features/app-info'
import { useCurrentUser } from '@/features/auth/guards'
import { cn } from '@/lib/cn'
import { formatDateLong, toIsoDate } from '@/lib/format'
import { fadeUp, reduced, useReducedMotion } from '@/lib/motion'
import {
  ACCEPT,
  attachmentUrl,
  MAX_FILE_MB,
  MAX_FILES,
  statusMeta,
  type Ticket,
  type TicketStatus,
  topicLabels,
  useMarkRead,
  usePatchTicket,
  useSendMessage,
  useTicket,
} from './api'
import { formatSize, PaymentRow, TicketStatusBadge } from './TicketParts'

type Attachment = Ticket['attachments'][number]

const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

function dayLabel(day: Date, today: Date): string {
  if (isSameDay(day, today)) return 'Сегодня'
  if (isSameDay(day, subDays(today, 1))) return 'Вчера'
  return formatDateLong(toIsoDate(day), today)
}

function errorText(error: unknown) {
  return error instanceof ApiError ? error.message : 'Не удалось отправить. Попробуйте ещё раз'
}

/** Файл в пузыре: ссылка на просмотр, иконка по типу. */
function BubbleFile({ ticketId, file, mine }: { ticketId: number; file: Attachment; mine: boolean }) {
  const Icon = file.content_type.startsWith('image/') ? FileImage : FileText
  return (
    <li>
      <a
        href={attachmentUrl(ticketId, file.id)}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ring',
          mine ? 'bg-fg-on-action/10' : 'bg-sunken text-link',
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{file.file_name}</span>
        <span className="ml-auto shrink-0 text-xs opacity-70 tabular">{formatSize(file.size)}</span>
      </a>
    </li>
  )
}

interface BubbleProps {
  mine: boolean
  author: string
  at: string
  ticketId: number
  text: string
  files: Attachment[]
  /** Первое сообщение с карточками платежей: шире обычного, чтобы суммы и сроки не сжимались. */
  wide?: boolean
  children?: ReactNode
}

/** Свои сообщения справа на фирменном голубом, чужие слева на поверхности карточки; у чужих подписан автор. */
function Bubble({ mine, author, at, ticketId, text, files, wide = false, children }: BubbleProps) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      variants={reduce ? reduced : fadeUp}
      initial="hidden"
      animate="show"
      className={cn(
        'flex flex-col gap-1',
        wide ? 'w-full max-w-[36rem]' : 'max-w-[min(36rem,88%)]',
        mine ? 'items-end self-end' : 'items-start self-start',
      )}
    >
      {!mine && <span className="px-1 text-xs font-medium text-fg-secondary">{author}</span>}
      <div
        className={cn(
          'grid w-full gap-2 rounded-xl px-3.5 py-2.5',
          mine ? 'rounded-br-sm bg-primary text-fg-on-action' : 'rounded-bl-sm border border-subtle bg-raised text-fg',
        )}
      >
        {text && <p className="text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap">{text}</p>}
        {children}
        {files.length > 0 && (
          <ul className="grid gap-1" aria-label="Файлы">
            {files.map((file) => (
              <BubbleFile key={file.id} ticketId={ticketId} file={file} mine={mine} />
            ))}
          </ul>
        )}
      </div>
      <time dateTime={at} className="px-1 text-xs text-fg-tertiary tabular">
        {timeFormat.format(new Date(at))}
      </time>
    </motion.div>
  )
}

/** Администратор меняет статус прямо в шапке чата. */
function StatusControl({ ticket }: { ticket: Ticket }) {
  const patch = usePatchTicket()
  const onChange = async (status: TicketStatus) => {
    try {
      await patch.mutateAsync({ id: ticket.id, body: { status } })
      toast.success(`Заявка №${ticket.id}: ${statusMeta[status].label.toLowerCase()}`)
    } catch (error) {
      toast.error('Статус не изменён', { description: error instanceof ApiError ? error.message : 'Попробуйте ещё раз' })
    }
  }
  return (
    <Listbox value={ticket.status} onValueChange={(value) => void onChange(value as TicketStatus)} disabled={patch.isPending}>
      <ListboxTrigger aria-label="Статус заявки" className="h-8 w-auto gap-2 text-[0.8125rem]">
        <ListboxValue />
      </ListboxTrigger>
      <ListboxContent align="end">
        {(Object.keys(statusMeta) as TicketStatus[]).map((status) => (
          <ListboxItem key={status} value={status}>
            {statusMeta[status].label}
          </ListboxItem>
        ))}
      </ListboxContent>
    </Listbox>
  )
}

/** Поле сообщения: Enter отправляет, Shift+Enter переносит строку; файлы копятся над полем до отправки. */
function Composer({ ticket }: { ticket: Ticket }) {
  const send = useSendMessage(ticket.id)
  const fileInput = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const empty = !text.trim() && files.length === 0

  const addFiles = (picked: File[]) => {
    const tooBig = picked.filter((file) => file.size > MAX_FILE_MB * 1024 * 1024)
    if (tooBig.length) toast.error(`Файл больше ${MAX_FILE_MB} МБ`, { description: tooBig.map((f) => f.name).join(', ') })
    const room = MAX_FILES - files.length
    const fitting = picked.filter((file) => !tooBig.includes(file))
    if (fitting.length > room) toast.error(`Не больше ${MAX_FILES} файлов в сообщении`)
    setFiles([...files, ...fitting.slice(0, Math.max(0, room))])
  }

  const submit = async () => {
    if (empty || send.isPending) return
    try {
      await send.mutateAsync({ text, files })
      setText('')
      setFiles([])
    } catch (error) {
      toast.error('Сообщение не отправлено', { description: errorText(error) })
    }
  }

  return (
    <form
      className="grid gap-2 border-t border-subtle bg-panel p-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Файлы к отправке">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex max-w-full items-center gap-1.5 rounded-md bg-sunken py-1 pr-1 pl-2 text-xs">
              <span className="min-w-0 truncate">{file.name}</span>
              <span className="shrink-0 text-fg-tertiary tabular">{formatSize(file.size)}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6"
                aria-label={`Убрать файл ${file.name}`}
                onClick={() => setFiles(files.filter((_, i) => i !== index))}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Выбрать файлы для сообщения"
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Прикрепить файлы"
          disabled={files.length >= MAX_FILES}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip aria-hidden />
        </Button>
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          }}
          rows={1}
          maxLength={4000}
          aria-label="Сообщение"
          aria-describedby={`composer-hint-${ticket.id}`}
          placeholder="Сообщение"
          className="max-h-40 min-h-10 resize-none [field-sizing:content]"
        />
        <span id={`composer-hint-${ticket.id}`} className="sr-only">
          Enter отправляет, Shift и Enter переносят строку
        </span>
        <Button type="submit" variant="primary" size="icon" aria-label="Отправить" disabled={empty} loading={send.isPending}>
          <SendHorizontal aria-hidden />
        </Button>
      </div>
    </form>
  )
}

function Thread({ ticket }: { ticket: Ticket }) {
  const user = useCurrentUser()
  const { today } = useAppInfo()
  const scroller = useRef<HTMLDivElement>(null)
  const count = ticket.messages.length

  // Новое сообщение (своё или пришедшее опросом) прокручивает ленту вниз, как в мессенджере. Прокручивается
  // только лента: scrollIntoView двигал бы и страницу.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [ticket.id, count])

  const opening = {
    id: 0,
    author: ticket.author,
    body: ticket.description,
    attachments: ticket.attachments,
    created_at: ticket.created_at,
  }
  const all = [opening, ...ticket.messages]
  // «Иван, администратор», но не «Администратор, администратор» у админа из .env.
  const nameOf = (author: Ticket['author']) =>
    author.role === 'admin' && author.display_name.toLowerCase() !== 'администратор'
      ? `${author.display_name}, администратор`
      : author.display_name

  return (
    <div ref={scroller} className="min-h-0 overflow-y-auto px-3 py-4 sm:px-5" aria-live="polite" aria-relevant="additions">
      <ol className="flex flex-col gap-3" aria-label="Сообщения">
        {all.map((message, index) => {
          const at = new Date(message.created_at)
          const newDay = index === 0 || !isSameDay(at, new Date(all[index - 1].created_at))
          const mine = message.author.id === user.id
          return (
            <li key={message.id} className="flex flex-col gap-3">
              {newDay && (
                <div className="self-center rounded-full bg-sunken px-2.5 py-0.5 text-xs text-fg-tertiary" role="separator">
                  {dayLabel(at, today)}
                </div>
              )}
              <Bubble
                mine={mine}
                author={nameOf(message.author)}
                at={message.created_at}
                ticketId={ticket.id}
                text={message.body}
                files={message.attachments}
                wide={message.id === 0 && ticket.payments.length > 0}
              >
                {message.id === 0 && ticket.payments.length > 0 && (
                  <ul className="grid gap-1.5 text-fg" aria-label="Платежи">
                    {ticket.payments.map((p) => (
                      <PaymentRow
                        key={p.occurrence_id}
                        payment={{ id: p.occurrence_id, name: p.name, due_date: p.due_date, amount: p.amount, currency: p.currency, paid: p.status === 'paid' }}
                        action={
                          <Button asChild variant="ghost" size="icon-sm">
                            <Link
                              to={`/payments?tab=all&archived=1&q=${encodeURIComponent(p.name)}`}
                              aria-label={`Открыть платёж ${p.name} в разделе «Платежи»`}
                            >
                              <ExternalLink aria-hidden />
                            </Link>
                          </Button>
                        }
                      />
                    ))}
                  </ul>
                )}
              </Bubble>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Чат заявки: шапка (номер, тема, статус), лента сообщений, поле ввода. Открытый чат отмечается прочитанным. */
export function TicketChat({ id, onBack }: { id: number | null; onBack: () => void }) {
  const user = useCurrentUser()
  const ticket = useTicket(id)
  const { mutate: markRead, isPending: marking } = useMarkRead()
  const data = ticket.data
  const unreadId = data?.unread && !marking ? data.id : null

  useEffect(() => {
    if (unreadId !== null) markRead(unreadId)
  }, [unreadId, markRead])

  if (id === null) {
    return (
      <EmptyState
        className="m-auto"
        icon={<MessagesSquare aria-hidden />}
        title="Выберите заявку"
        description="Переписка по заявке откроется здесь."
      />
    )
  }

  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]" aria-label={data ? `Заявка №${data.id}` : 'Заявка'}>
      <header className="flex items-center gap-2 border-b border-subtle px-2 py-2 sm:px-4">
        <Button variant="ghost" size="icon-sm" className="xl:hidden" aria-label="К списку заявок" onClick={onBack}>
          <ArrowLeft aria-hidden />
        </Button>
        {data ? (
          <>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <h2 className="truncate font-display font-bold">
                <span className="font-normal text-fg-tertiary tabular">№{data.id}</span> {topicLabels[data.topic]}
              </h2>
              <p className="truncate text-xs text-fg-tertiary">
                {user.role === 'admin' ? data.author.display_name : 'Переписка с администратором'}
              </p>
            </div>
            {user.role === 'admin' ? <StatusControl ticket={data} /> : <TicketStatusBadge status={data.status} />}
          </>
        ) : (
          <Skeleton className="h-9 flex-1" />
        )}
      </header>
      {ticket.isPending ? (
        <div className="grid content-start gap-3 p-5" aria-busy="true" aria-label="Загрузка переписки">
          <Skeleton className="h-16 w-2/3" />
          <Skeleton className="h-10 w-1/2 justify-self-end" />
        </div>
      ) : ticket.isError ? (
        <ErrorState error={ticket.error} onRetry={() => ticket.refetch()} />
      ) : (
        <Thread ticket={ticket.data} />
      )}
      {data && <Composer key={data.id} ticket={data} />}
    </section>
  )
}

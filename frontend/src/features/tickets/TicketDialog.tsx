import { ExternalLink, MessageSquareReply } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, fieldAria } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import { Segmented } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useCurrentUser } from '@/features/auth/guards'
import { formatDateTime } from '@/lib/format'
import { attachmentUrl, statusMeta, type Ticket, type TicketStatus, topicLabels, usePatchTicket, useTicket } from './api'
import { FileRow, PaymentRow, TicketStatusBadge } from './TicketParts'

const statusOptions = (Object.keys(statusMeta) as TicketStatus[]).map((value) => ({ value, label: statusMeta[value].label }))

/** Обработка заявки администратором: статус и ответ, сохраняются одной кнопкой. */
function AdminControls({ ticket }: { ticket: Ticket }) {
  const patch = usePatchTicket()
  const [status, setStatus] = useState(ticket.status)
  const [reply, setReply] = useState(ticket.admin_reply ?? '')
  const [error, setError] = useState<string>()

  const dirty = status !== ticket.status || reply.trim() !== (ticket.admin_reply ?? '')
  // mutateAsync, а не колбэки mutate: после сохранения компонент пересоздаётся по ключу версии, и колбэки mutate
  // размонтированного наблюдателя TanStack Query уже не вызывает.
  const save = async () => {
    if (reply.length > 4000) return setError('Не длиннее 4000 символов')
    setError(undefined)
    try {
      const saved = await patch.mutateAsync({ id: ticket.id, body: { status, admin_reply: reply.trim() || null } })
      toast.success(`Заявка №${saved.id}: ${statusMeta[saved.status].label.toLowerCase()}`)
    } catch (e) {
      toast.error('Изменения не сохранены', { description: e instanceof ApiError ? e.message : 'Попробуйте ещё раз' })
    }
  }

  return (
    <section className="grid gap-4 rounded-xl bg-sunken p-4" aria-label="Обработка заявки">
      <div className="grid gap-1.5">
        <span className="text-[0.8125rem] font-medium">Статус</span>
        <Segmented<TicketStatus> label="Статус заявки" value={status} onChange={setStatus} options={statusOptions} />
      </div>
      <Field id={`t-reply-${ticket.id}`} label="Ответ пользователю" hint="Пользователь увидит ответ в своей заявке" error={error}>
        <Textarea
          {...fieldAria(`t-reply-${ticket.id}`, error, true)}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          rows={3}
          placeholder="Что сделано или что нужно от пользователя"
          className="bg-raised"
        />
      </Field>
      <DialogFooter>
        <Button variant="primary" disabled={!dirty} loading={patch.isPending} onClick={save}>
          Сохранить
        </Button>
      </DialogFooter>
    </section>
  )
}

function TicketBody({ ticket }: { ticket: Ticket }) {
  const user = useCurrentUser()
  const isAdmin = user.role === 'admin'
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-fg-secondary">
        <TicketStatusBadge status={ticket.status} />
        <span>
          {isAdmin ? `${ticket.author.display_name}, ` : ''}
          <time dateTime={ticket.created_at} className="tabular">
            {formatDateTime(ticket.created_at)}
          </time>
        </span>
      </div>

      <p className="text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap">{ticket.description}</p>

      {ticket.payments.length > 0 && (
        <section className="grid gap-2" aria-label="Платежи">
          <h3 className="text-[0.8125rem] font-medium">Платежи</h3>
          <ul className="grid gap-1.5">
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
        </section>
      )}

      {ticket.attachments.length > 0 && (
        <section className="grid gap-2" aria-label="Файлы">
          <h3 className="text-[0.8125rem] font-medium">Файлы</h3>
          <ul className="grid gap-1.5">
            {ticket.attachments.map((a) => (
              <FileRow key={a.id} name={a.file_name} size={a.size} contentType={a.content_type} href={attachmentUrl(ticket.id, a.id)} />
            ))}
          </ul>
        </section>
      )}

      {isAdmin ? (
        // Ключ по версии заявки: после сохранения поля заново берут значения с сервера.
        <AdminControls key={`${ticket.id}-${ticket.updated_at}`} ticket={ticket} />
      ) : (
        <section className="grid gap-1.5 rounded-xl bg-sunken p-4" aria-label="Ответ администратора">
          <h3 className="flex items-center gap-2 text-[0.8125rem] font-medium">
            <MessageSquareReply className="size-4 text-fg-tertiary" aria-hidden />
            Ответ администратора
          </h3>
          <p className={ticket.admin_reply ? 'break-words whitespace-pre-wrap' : 'text-sm text-fg-tertiary'}>
            {ticket.admin_reply ?? 'Пока нет ответа. Он появится здесь, как только администратор возьмёт заявку.'}
          </p>
        </section>
      )}
    </div>
  )
}

export function TicketDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const ticket = useTicket(id)
  const title = ticket.data ? `№${ticket.data.id}. ${topicLabels[ticket.data.topic]}` : 'Заявка'
  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={title} className="max-w-xl">
        {ticket.isPending ? (
          <div className="grid gap-3" aria-busy="true" aria-label="Загрузка заявки">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-20" />
          </div>
        ) : ticket.isError ? (
          <ErrorState error={ticket.error} onRetry={() => ticket.refetch()} />
        ) : (
          <TicketBody ticket={ticket.data} />
        )}
      </DialogContent>
    </Dialog>
  )
}

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, CircleDot, Clock3, type LucideIcon } from 'lucide-react'
import { api, ApiError, type Schemas, unwrap } from '@/api/client'

export type Ticket = Schemas['Ticket']
export type TicketTopic = Ticket['topic']
export type TicketStatus = Ticket['status']
export type TicketPatch = Schemas['TicketPatch']
export type TicketMessage = Schemas['TicketMessage']

export const ticketsKey = ['tickets'] as const

export const MAX_FILES = 5
export const MAX_PAYMENTS = 10
export const MAX_FILE_MB = 5
export const ACCEPT = 'application/pdf,image/png,image/jpeg'

export const topicLabels: Record<TicketTopic, string> = {
  question: 'Вопрос по работе сервиса',
  bug: 'Неполадка',
  payment: 'Ошибка в платеже',
  access: 'Доступ и учётная запись',
  other: 'Другое',
}

export const statusMeta: Record<TicketStatus, { label: string; tone: 'info' | 'warning' | 'success'; icon: LucideIcon }> = {
  open: { label: 'Новая', tone: 'info', icon: CircleDot },
  in_progress: { label: 'В работе', tone: 'warning', icon: Clock3 },
  resolved: { label: 'Решена', tone: 'success', icon: CircleCheck },
}

export const attachmentUrl = (ticketId: number, attachmentId: number) =>
  `/api/v1/support-tickets/${ticketId}/attachments/${attachmentId}`

/** Чаты обновляются опросом (ADR-030): список реже, открытый чат чаще. */
const LIST_POLL = 20_000
const CHAT_POLL = 10_000

export function useTickets(status: TicketStatus | null, page: { limit: number; offset: number }) {
  const query = { ...(status ? { status } : {}), ...page }
  return useQuery({
    queryKey: [...ticketsKey, query],
    queryFn: () => unwrap(api.GET('/api/v1/support-tickets', { params: { query } })),
    placeholderData: keepPreviousData,
    refetchInterval: LIST_POLL,
  })
}

/** Сколько заявок по фильтру: `total` при `limit=1` (счётчики в шапке и в навигации). */
export function useTicketCount(filter: { status?: TicketStatus; unread?: boolean }) {
  return useQuery({
    queryKey: [...ticketsKey, 'count', filter],
    queryFn: () => unwrap(api.GET('/api/v1/support-tickets', { params: { query: { ...filter, limit: 1 } } })),
    select: (data) => data.total,
    refetchInterval: LIST_POLL,
  })
}

export interface TicketDraft {
  topic: TicketTopic
  description: string
  occurrenceIds: number[]
  files: File[]
}

/** multipart-запрос: файлы сохраняются вместе с заявкой или сообщением или не сохраняются вовсе. */
async function postForm(url: string, body: FormData): Promise<Ticket> {
  let response: Response
  try {
    response = await fetch(url, { method: 'POST', body, credentials: 'include' })
  } catch {
    throw new ApiError(0, undefined)
  }
  const data = await response.json().catch(() => undefined)
  if (!response.ok) throw new ApiError(response.status, data?.error)
  return data as Ticket
}

function createTicket(draft: TicketDraft): Promise<Ticket> {
  const body = new FormData()
  body.append('topic', draft.topic)
  body.append('description', draft.description)
  draft.occurrenceIds.forEach((id) => body.append('occurrence_ids', String(id)))
  draft.files.forEach((file) => body.append('files', file))
  return postForm('/api/v1/support-tickets', body)
}

export function useCreateTicket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createTicket,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ticketsKey }),
  })
}

export function usePatchTicket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: TicketPatch }) =>
      unwrap(api.PATCH('/api/v1/support-tickets/{ticket_id}', { params: { path: { ticket_id: id } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ticketsKey }),
  })
}

export function useTicket(id: number | null) {
  return useQuery({
    queryKey: [...ticketsKey, 'one', id],
    queryFn: () => unwrap(api.GET('/api/v1/support-tickets/{ticket_id}', { params: { path: { ticket_id: id! } } })),
    enabled: id !== null,
    refetchInterval: CHAT_POLL,
  })
}

export function useSendMessage(ticketId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ text, files }: { text: string; files: File[] }) => {
      const body = new FormData()
      body.append('body', text)
      files.forEach((file) => body.append('files', file))
      return postForm(`/api/v1/support-tickets/${ticketId}/messages`, body)
    },
    onSuccess: (ticket) => {
      queryClient.setQueryData([...ticketsKey, 'one', ticketId], ticket)
      void queryClient.invalidateQueries({ queryKey: ticketsKey })
    },
  })
}

/** Открытый чат с непрочитанным отмечается прочитанным; список и счётчики пересчитываются. */
export function useMarkRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      unwrap(api.POST('/api/v1/support-tickets/{ticket_id}/read', { params: { path: { ticket_id: id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ticketsKey }),
  })
}

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, CircleDot, Clock3, type LucideIcon } from 'lucide-react'
import { api, ApiError, type Schemas, unwrap } from '@/api/client'

export type Ticket = Schemas['Ticket']
export type TicketTopic = Ticket['topic']
export type TicketStatus = Ticket['status']
export type TicketPatch = Schemas['TicketPatch']

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

export function useTickets(status: TicketStatus | null, page: { limit: number; offset: number }) {
  const query = { ...(status ? { status } : {}), ...page }
  return useQuery({
    queryKey: [...ticketsKey, query],
    queryFn: () => unwrap(api.GET('/api/v1/support-tickets', { params: { query } })),
    placeholderData: keepPreviousData,
  })
}

/** Сколько заявок в статусе: `total` при `limit=1` (счётчики на вкладках и в навигации). */
export function useTicketCount(status: TicketStatus, enabled = true) {
  return useQuery({
    queryKey: [...ticketsKey, 'count', status],
    queryFn: () => unwrap(api.GET('/api/v1/support-tickets', { params: { query: { status, limit: 1 } } })),
    select: (data) => data.total,
    enabled,
    refetchInterval: 60_000,
  })
}

export interface TicketDraft {
  topic: TicketTopic
  description: string
  occurrenceIds: number[]
  files: File[]
}

/** Заявка уходит одним multipart-запросом: файлы и платежи сохраняются вместе с ней или не сохраняются вовсе. */
async function createTicket(draft: TicketDraft): Promise<Ticket> {
  const body = new FormData()
  body.append('topic', draft.topic)
  body.append('description', draft.description)
  draft.occurrenceIds.forEach((id) => body.append('occurrence_ids', String(id)))
  draft.files.forEach((file) => body.append('files', file))
  let response: Response
  try {
    response = await fetch('/api/v1/support-tickets', { method: 'POST', body, credentials: 'include' })
  } catch {
    throw new ApiError(0, undefined)
  }
  const data = await response.json().catch(() => undefined)
  if (!response.ok) throw new ApiError(response.status, data?.error)
  return data as Ticket
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
  })
}

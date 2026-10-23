import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Schemas, unwrap } from '@/api/client'
import type { paths } from '@/api/schema'

export type Occurrence = Schemas['Occurrence']
export type OccurrenceList = Schemas['OccurrenceList']
export type OccurrencePatch = Schemas['OccurrencePatch']
export type OccurrenceQuery = NonNullable<paths['/api/v1/payment-occurrences']['get']['parameters']['query']>

export const occurrencesKey = ['occurrences'] as const

export function useOccurrences(query: OccurrenceQuery) {
  return useQuery({
    queryKey: [...occurrencesKey, query],
    queryFn: () => unwrap(api.GET('/api/v1/payment-occurrences', { params: { query } })),
    placeholderData: keepPreviousData,
  })
}

/** Ожидаемый статус сразу после отметки (до ответа сервера). */
function optimistic(occ: Occurrence, patch: OccurrencePatch, todayIso: string): Occurrence {
  const status = patch.status ?? occ.status
  if (status === 'paid') {
    const paidAt = patch.paid_at ?? occ.paid_at ?? todayIso
    const late = paidAt > occ.due_date
    return { ...occ, status, paid_at: paidAt, is_overdue: late, display_status: late ? 'paid_late' : 'paid' }
  }
  const until = occ.days_until_due
  const display = until < 0 ? 'overdue' : until === 0 ? 'due_today' : until <= 3 ? 'due_soon' : 'upcoming'
  return { ...occ, status, paid_at: null, paid_by_label: null, is_overdue: until < 0, display_status: display }
}

export function usePatchOccurrence(todayIso: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: OccurrencePatch }) =>
      unwrap(api.PATCH('/api/v1/payment-occurrences/{occurrence_id}', { params: { path: { occurrence_id: id } }, body: patch })),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: occurrencesKey })
      const snapshot = queryClient.getQueriesData<OccurrenceList>({ queryKey: occurrencesKey })
      queryClient.setQueriesData<OccurrenceList>({ queryKey: occurrencesKey }, (old) =>
        old ? { ...old, items: old.items.map((item) => (item.id === id ? optimistic(item, patch, todayIso) : item)) } : old,
      )
      return { snapshot }
    },
    onError: (_error, _vars, context) => {
      context?.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data))
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: occurrencesKey })
      void queryClient.invalidateQueries({ queryKey: ['summary'] })
      void queryClient.invalidateQueries({ queryKey: ['recurring'] })
    },
  })
}

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Schemas, unwrap } from '@/api/client'
import type { paths } from '@/api/schema'
import { useAppInfo } from '@/features/app-info'
import { optimistic } from './status'

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

export function usePatchOccurrence() {
  const queryClient = useQueryClient()
  const { todayIso, reminderDays } = useAppInfo()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: OccurrencePatch }) =>
      unwrap(api.PATCH('/api/v1/payment-occurrences/{occurrence_id}', { params: { path: { occurrence_id: id } }, body: patch })),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: occurrencesKey })
      const snapshot = queryClient.getQueriesData<OccurrenceList>({ queryKey: occurrencesKey })
      queryClient.setQueriesData<OccurrenceList>({ queryKey: occurrencesKey }, (old) =>
        old ? { ...old, items: old.items.map((item) => (item.id === id ? optimistic(item, patch, todayIso, reminderDays) : item)) } : old,
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
      void queryClient.invalidateQueries({ queryKey: ['budget'] })
    },
  })
}

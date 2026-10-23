import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, type Schemas, unwrap } from '@/api/client'

export type Summary = Schemas['Summary']
export type CurrencySummary = Schemas['CurrencySummary']

export function useSummary(dueFrom: string, dueTo: string, asOf?: string) {
  return useQuery({
    queryKey: ['summary', dueFrom, dueTo, asOf ?? null],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/payments/summary', {
          params: { query: { due_from: dueFrom, due_to: dueTo, ...(asOf ? { as_of: asOf } : {}) } },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}

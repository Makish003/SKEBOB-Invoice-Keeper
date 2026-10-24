import { useQuery } from '@tanstack/react-query'
import { api, type Schemas, unwrap } from '@/api/client'

export type BudgetOverview = Schemas['BudgetOverview']

/** Бюджет месяца и года против запланированных платежей (FR-B9). */
export function useBudgetOverview(year: number, month: number) {
  return useQuery({
    queryKey: ['budget', year, month],
    queryFn: () => unwrap(api.GET('/api/v1/budgets/overview', { params: { query: { year, month } } })),
  })
}

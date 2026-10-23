import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Schemas, unwrap } from '@/api/client'

export type RecurringPayment = Schemas['RecurringPayment']
export type RecurringPaymentCreate = Schemas['RecurringPaymentCreate']
export type Period = RecurringPayment['period']

export const recurringKey = ['recurring'] as const

export const periodLabels: Record<Period, string> = {
  monthly: 'Ежемесячно',
  weekly: 'Еженедельно',
  quarterly: 'Ежеквартально',
  yearly: 'Ежегодно',
}

export function useRecurringPayments() {
  return useQuery({
    queryKey: recurringKey,
    queryFn: () => unwrap(api.GET('/api/v1/recurring-payments', { params: { query: { include_deleted: true } } })),
  })
}

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: recurringKey })
  void queryClient.invalidateQueries({ queryKey: ['occurrences'] })
  void queryClient.invalidateQueries({ queryKey: ['summary'] })
}

export function useCreateRecurring() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: RecurringPaymentCreate) => unwrap(api.POST('/api/v1/recurring-payments', { body })),
    onSuccess: () => invalidateAll(queryClient),
  })
}

export function useDeleteRecurring() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      unwrap(api.DELETE('/api/v1/recurring-payments/{payment_id}', { params: { path: { payment_id: id } } })),
    onSuccess: () => invalidateAll(queryClient),
  })
}

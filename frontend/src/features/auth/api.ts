import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type Schemas, unwrap } from '@/api/client'

export type User = Schemas['UserOut']

export const meKey = ['me'] as const

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: () => unwrap(api.GET('/api/v1/auth/me')),
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
    staleTime: 60_000,
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: Schemas['LoginIn']) => unwrap(api.POST('/api/v1/auth/login', { body })),
    onSuccess: (data) => {
      queryClient.clear()
      queryClient.setQueryData(meKey, data.user)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/auth/logout')),
    onSettled: () => queryClient.clear(),
  })
}

export const isAdmin = (user: User | undefined) => user?.role === 'admin'

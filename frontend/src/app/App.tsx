import { QueryClientProvider } from '@tanstack/react-query'
import { Suspense, useEffect } from 'react'
import { RouterProvider } from 'react-router/dom'
import { onUnauthorized } from '@/api/client'
import { Toaster } from '@/components/ui/toaster'
import { ThemeProvider } from '@/lib/theme'
import { queryClient } from './queryClient'
import { router } from './router'

/** Сессия истекла на любом запросе: сбрасываем кэш и уводим на вход с возвратом назад. */
function useSessionExpiry() {
  useEffect(
    () =>
      onUnauthorized(() => {
        const { pathname, search } = router.state.location
        if (pathname === '/login') return
        queryClient.clear()
        void router.navigate(`/login?next=${encodeURIComponent(pathname + search)}`, { replace: true })
      }),
    [],
  )
}

export function App() {
  useSessionExpiry()
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <Suspense>
          <RouterProvider router={router} />
        </Suspense>
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  )
}

import { Lock } from 'lucide-react'
import { createContext, type ReactNode, useContext } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { type User, useMe } from './api'

const UserContext = createContext<User | null>(null)

/** Текущий пользователь внутри защищённых маршрутов. */
export function useCurrentUser(): User {
  const user = useContext(UserContext)
  if (!user) throw new Error('useCurrentUser must be used inside RequireAuth')
  return user
}

function FullscreenLoading() {
  return (
    <div className="grid min-h-dvh place-items-center" aria-busy="true" aria-label="Загрузка">
      <div className="grid w-64 gap-3">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  )
}

/** Без сессии маршрут недоступен: редирект на /login?next=... (AC-2). */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const me = useMe()
  const location = useLocation()

  if (me.isPending) return <FullscreenLoading />
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      const next = encodeURIComponent(location.pathname + location.search)
      return <Navigate to={`/login?next=${next}`} replace />
    }
    return (
      <div className="grid min-h-dvh place-items-center">
        <ErrorState error={me.error} onRetry={() => me.refetch()} />
      </div>
    )
  }
  return <UserContext.Provider value={me.data}>{children ?? <Outlet />}</UserContext.Provider>
}

/** UI лишь прячет разделы; права всё равно проверяет сервер (FR-15). */
export function RequireAdmin() {
  const user = useCurrentUser()
  if (user.role !== 'admin') {
    return (
      <EmptyState
        className="py-24"
        icon={<Lock aria-hidden />}
        title="Раздел доступен только администратору"
        description="Платежи и отметки оплаты доступны в разделе «Платежи»."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/payments">Перейти к платежам</Link>
          </Button>
        }
      />
    )
  }
  return <Outlet />
}

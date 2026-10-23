import { TriangleAlert } from 'lucide-react'
import { useRouteError } from 'react-router'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/states'

/** Граница ошибок маршрутов: вместо стандартной страницы React Router - понятное сообщение и выход. */
export function RouteErrorPage() {
  const error = useRouteError()
  if (import.meta.env.DEV) console.error(error)
  return (
    <div className="grid min-h-dvh place-items-center bg-page px-4">
      <EmptyState
        icon={<TriangleAlert aria-hidden />}
        title="Что-то пошло не так"
        description="Страница не смогла отобразиться. Обновите её; если ошибка повторится, вернитесь на главную."
        action={
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => window.location.reload()}>
              Обновить страницу
            </Button>
            <Button variant="secondary" onClick={() => window.location.assign('/')}>
              На главную
            </Button>
          </div>
        }
      />
    </div>
  )
}

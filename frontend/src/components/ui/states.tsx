import { CircleAlert, Inbox, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { ApiError } from '@/api/client'
import { cn } from '@/lib/cn'
import { Button } from './button'

interface EmptyStateProps {
  title: string
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
}

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <div className="flex size-10 items-center justify-center rounded-lg bg-brand-tile text-brand-tile-fg [&_svg]:size-5">
        {icon ?? <Inbox aria-hidden />}
      </div>
      <div className="grid max-w-sm gap-1">
        <p className="font-medium text-fg">{title}</p>
        {description && <p className="text-sm text-fg-secondary">{description}</p>}
      </div>
      {action}
    </div>
  )
}

interface ErrorStateProps {
  error: unknown
  onRetry?: () => void
  className?: string
}

/** Ошибка загрузки: что случилось, почему и что сделать. */
export function ErrorState({ error, onRetry, className }: ErrorStateProps) {
  const message =
    error instanceof ApiError ? error.message : 'Не удалось загрузить данные. Проверьте подключение к сети'
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <div className="flex size-10 items-center justify-center rounded-full bg-danger-bg text-danger [&_svg]:size-5">
        <CircleAlert aria-hidden />
      </div>
      <div className="grid max-w-sm gap-1">
        <p className="font-medium text-fg">Данные не загрузились</p>
        <p className="text-sm text-fg-secondary">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden />
          Повторить
        </Button>
      )}
    </div>
  )
}

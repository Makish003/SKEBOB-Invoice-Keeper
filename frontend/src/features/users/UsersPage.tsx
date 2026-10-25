import { Lock, Pencil, Trash2, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { CardGrid, cardGridClass, ItemCard, Tile } from '@/components/CardGrid'
import { Page, PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/cn'
import { formatDate } from '@/lib/format'
import { type ManagedUser, useDeleteUser, useUsers } from './api'
import { UserFormDialog } from './UserFormDialog'

function RoleBadge({ user }: { user: ManagedUser }) {
  return user.role === 'admin' ? (
    <Badge tone="info">
      <Lock aria-hidden />
      Администратор
    </Badge>
  ) : (
    <Badge tone="neutral">Пользователь</Badge>
  )
}

function Actions({ user, onEdit, onDelete }: { user: ManagedUser; onEdit: () => void; onDelete: () => void }) {
  if (user.is_system) {
    return (
      <Tooltip content="Администратор задаётся в .env и не меняется через панель">
        <span tabIndex={0} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-fg-tertiary outline-none focus-visible:outline-2 focus-visible:outline-ring">
          <Lock className="size-3.5" aria-hidden />
          Из .env
        </span>
      </Tooltip>
    )
  }
  return (
    <div className="flex justify-end gap-1">
      <Tooltip content="Изменить">
        <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`Изменить ${user.display_name}`}>
          <Pencil aria-hidden />
        </Button>
      </Tooltip>
      <Tooltip content="Удалить">
        <Button variant="destructive-ghost" size="icon-sm" onClick={onDelete} aria-label={`Удалить ${user.display_name}`}>
          <Trash2 aria-hidden />
        </Button>
      </Tooltip>
    </div>
  )
}

/** Инициалы: первые буквы двух первых слов имени («Анна Смирнова» → «АС»). */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('')
}

/** Пользователь карточкой: инициалы на плитке (у администратора фирменная), имя, логин, роль, дата создания и действия. */
function UserCard({ user, onEdit, onDelete }: { user: ManagedUser; onEdit: () => void; onDelete: () => void }) {
  return (
    <ItemCard aria-label={user.display_name}>
      <header className="flex items-start gap-3">
        <Tile className={cn('font-display text-xl font-bold', user.role === 'admin' ? 'bg-brand-tile text-brand-tile-fg' : 'bg-sunken text-fg')}>
          {initials(user.display_name)}
        </Tile>
        <div className="grid min-w-0 gap-0.5 pt-1">
          <h3 className="font-display leading-snug font-bold break-words text-fg">{user.display_name}</h3>
          <span className="truncate font-mono text-xs text-fg-tertiary">{user.login}</span>
        </div>
      </header>

      <div>
        <RoleBadge user={user} />
      </div>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-subtle pt-3">
        <span className="text-sm text-fg-secondary">
          Создан <span className="text-fg tabular">{formatDate(user.created_at.slice(0, 10))}</span>
        </span>
        <Actions user={user} onEdit={onEdit} onDelete={onDelete} />
      </footer>
    </ItemCard>
  )
}

export function UsersPage() {
  const users = useUsers()
  const remove = useDeleteUser()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ManagedUser | null>(null)
  const [toDelete, setToDelete] = useState<ManagedUser | null>(null)

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }
  const items = users.data?.items ?? []
  const regular = items.filter((u) => !u.is_system)

  return (
    <Page>
      <PageHeader
        title="Пользователи"
        description="Пользователи видят общий список платежей и отмечают оплату. Управлять платежами может только администратор."
        actions={
          <Button variant="primary" onClick={openCreate}>
            <UserPlus aria-hidden />
            Добавить пользователя
          </Button>
        }
      />

      {users.isPending ? (
        <div className={cardGridClass} aria-busy="true" aria-label="Загрузка">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      ) : users.isError ? (
        <Card>
          <ErrorState error={users.error} onRetry={() => users.refetch()} />
        </Card>
      ) : (
        <>
          <CardGrid items={items} label="Пользователи">
            {(user) => (
              <UserCard
                user={user}
                onEdit={() => {
                  setEditing(user)
                  setFormOpen(true)
                }}
                onDelete={() => setToDelete(user)}
              />
            )}
          </CardGrid>
          {regular.length === 0 && (
            <Card>
              <EmptyState
                icon={<Users aria-hidden />}
                title="Обычных пользователей пока нет"
                description="Добавьте коллег, чтобы они могли отмечать оплату."
                action={
                  <Button variant="secondary" size="sm" onClick={openCreate}>
                    Добавить пользователя
                  </Button>
                }
              />
            </Card>
          )}
        </>
      )}

      <UserFormDialog open={formOpen} onOpenChange={setFormOpen} user={editing} />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={`Удалить пользователя ${toDelete?.display_name ?? ''}?`}
        description="Пользователь больше не сможет войти, его сессии завершатся. Отметки об оплате, которые он делал, останутся в истории."
        confirmLabel="Удалить пользователя"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          toDelete &&
          remove.mutate(toDelete.id, {
            onSuccess: () => {
              toast.success('Пользователь удалён', { description: toDelete.display_name })
              setToDelete(null)
            },
            onError: (error) =>
              toast.error('Не удалось удалить', { description: error instanceof ApiError ? error.message : 'Попробуйте ещё раз' }),
          })
        }
      />
    </Page>
  )
}

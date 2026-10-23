import { Lock, Pencil, Trash2, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { Page, PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Tooltip } from '@/components/ui/tooltip'
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
        <span tabIndex={0} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-fg-tertiary outline-none focus-visible:outline-2 focus-visible:outline-ring">
          <Lock className="size-3.5" aria-hidden />
          Из .env
        </span>
      </Tooltip>
    )
  }
  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Изменить ${user.display_name}`}>
        <Pencil aria-hidden />
        <span className="hidden sm:inline">Изменить</span>
      </Button>
      <Button variant="destructive-ghost" size="sm" onClick={onDelete} aria-label={`Удалить ${user.display_name}`}>
        <Trash2 aria-hidden />
        <span className="hidden sm:inline">Удалить</span>
      </Button>
    </div>
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

      <Card className="overflow-hidden">
        {users.isPending ? (
          <div className="grid gap-3 p-4" aria-busy="true" aria-label="Загрузка">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : users.isError ? (
          <ErrorState error={users.error} onRetry={() => users.refetch()} />
        ) : (
          <>
            <Table aria-label="Пользователи">
              <THead>
                <tr>
                  <TH className="pl-4">Имя</TH>
                  <TH>Логин</TH>
                  <TH className="hidden sm:table-cell">Роль</TH>
                  <TH className="hidden md:table-cell">Создан</TH>
                  <TH className="pr-4 text-right">
                    <span className="sr-only">Действия</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {items.map((user) => (
                  <TR key={user.id}>
                    <TD className="pl-4 font-medium">{user.display_name}</TD>
                    <TD className="font-mono text-[0.8125rem] text-fg-secondary">{user.login}</TD>
                    <TD className="hidden sm:table-cell">
                      <RoleBadge user={user} />
                    </TD>
                    <TD className="hidden text-fg-secondary tabular md:table-cell">{formatDate(user.created_at.slice(0, 10))}</TD>
                    <TD className="pr-4 text-right">
                      <Actions
                        user={user}
                        onEdit={() => {
                          setEditing(user)
                          setFormOpen(true)
                        }}
                        onDelete={() => setToDelete(user)}
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {regular.length === 0 && (
              <EmptyState
                className="border-t border-subtle"
                icon={<Users aria-hidden />}
                title="Обычных пользователей пока нет"
                description="Добавьте коллег, чтобы они могли отмечать оплату."
                action={
                  <Button variant="secondary" size="sm" onClick={openCreate}>
                    Добавить пользователя
                  </Button>
                }
              />
            )}
          </>
        )}
      </Card>

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

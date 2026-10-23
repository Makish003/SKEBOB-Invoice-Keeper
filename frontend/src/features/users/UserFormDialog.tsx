import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, fieldAria } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { type ManagedUser, useCreateUser, useUpdateUser } from './api'

const login = z
  .string()
  .trim()
  .min(3, 'Логин: от 3 символов')
  .max(64, 'Логин: не длиннее 64 символов')
  .regex(/^[A-Za-z0-9._-]+$/, 'Логин: латиница, цифры, точка, дефис или подчёркивание')

const createSchema = z.object({
  login,
  display_name: z.string().trim().max(120, 'Не длиннее 120 символов'),
  password: z.string().min(8, 'Пароль: не короче 8 символов').max(128, 'Пароль: не длиннее 128 символов'),
})
const editSchema = createSchema.extend({
  password: z.union([z.literal(''), z.string().min(8, 'Пароль: не короче 8 символов').max(128)]),
})
type FormValues = z.infer<typeof createSchema>

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  user?: ManagedUser | null
}

export function UserFormDialog({ open, onOpenChange, user }: Props) {
  const editing = Boolean(user)
  const create = useCreateUser()
  const update = useUpdateUser()
  const form = useForm<FormValues>({
    resolver: zodResolver(editing ? editSchema : createSchema),
    defaultValues: { login: '', display_name: '', password: '' },
  })
  const { register, handleSubmit, reset, setError, formState } = form
  const errors = formState.errors

  useEffect(() => {
    if (open) reset({ login: user?.login ?? '', display_name: user?.display_name ?? '', password: '' })
  }, [open, user, reset])

  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 409) return setError('login', { message: error.message })
    if (error instanceof ApiError && error.status === 422) return setError('root', { message: 'Проверьте поля: ' + error.message })
    toast.error('Изменения не сохранены', { description: error instanceof ApiError ? error.message : 'Попробуйте ещё раз' })
  }

  const onSubmit = handleSubmit((values) => {
    const displayName = values.display_name.trim()
    if (user) {
      update.mutate(
        {
          id: user.id,
          body: {
            login: values.login.trim(),
            display_name: displayName || values.login.trim(),
            ...(values.password ? { password: values.password } : {}),
          },
        },
        {
          onSuccess: () => {
            toast.success('Пользователь сохранён', {
              description: values.password ? 'Пароль изменён, сессии пользователя завершены' : undefined,
            })
            onOpenChange(false)
          },
          onError,
        },
      )
    } else {
      create.mutate(
        { login: values.login.trim(), password: values.password, display_name: displayName || null },
        {
          onSuccess: (created) => {
            toast.success('Пользователь создан', { description: `Логин: ${created.login}` })
            onOpenChange(false)
          },
          onError,
        },
      )
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={editing ? 'Изменить пользователя' : 'Новый пользователь'}
        description={editing ? undefined : 'Пользователь видит платежи и отмечает оплату. Роль администратора не выдаётся.'}
      >
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {errors.root && (
            <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
              {errors.root.message}
            </p>
          )}
          <Field id="u-name" label="Имя" hint="Его увидят рядом с отметкой оплаты" error={errors.display_name?.message}>
            <Input {...fieldAria('u-name', errors.display_name?.message, true)} {...register('display_name')} placeholder="Иван Петров" autoFocus />
          </Field>
          <Field id="u-login" label="Логин" error={errors.login?.message}>
            <Input
              {...fieldAria('u-login', errors.login?.message)}
              {...register('login')}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="ivan"
            />
          </Field>
          <Field
            id="u-password"
            label={editing ? 'Новый пароль' : 'Пароль'}
            hint={editing ? 'Оставьте пустым, чтобы не менять. Смена пароля завершит сессии пользователя' : 'Не короче 8 символов'}
            error={errors.password?.message}
          >
            <Input
              {...fieldAria('u-password', errors.password?.message, true)}
              {...register('password')}
              type="password"
              autoComplete="new-password"
            />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" variant="primary" loading={create.isPending || update.isPending}>
              {editing ? 'Сохранить' : 'Создать пользователя'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

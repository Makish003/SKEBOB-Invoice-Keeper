import { zodResolver } from '@hookform/resolvers/zod'
import { BellRing, Coins, History } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import { ApiError } from '@/api/client'
import { BrandPattern, panelText, patternMetrics } from '@/components/BrandPattern'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Field, fieldAria } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/cn'
import { useLogin, useMe } from './api'

const schema = z.object({
  login: z.string().trim().min(1, 'Введите логин'),
  password: z.string().min(1, 'Введите пароль'),
})
type FormValues = z.infer<typeof schema>

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Неверный логин или пароль. Проверьте раскладку клавиатуры и Caps Lock'
    if (error.status === 429) return error.message
    if (error.status === 0) return 'Сервер не отвечает. Проверьте, что приложение запущено, и попробуйте снова'
    return error.message
  }
  return 'Не удалось войти. Попробуйте ещё раз'
}

const facts = [
  { icon: BellRing, title: 'Напоминание до срока', text: 'Бот сам пишет в Telegram-чат команды, без дублей' },
  { icon: Coins, title: 'RUB, USD и EUR отдельно', text: 'Итоги по каждой валюте, без конвертации' },
  { icon: History, title: 'История по периодам', text: 'У каждого периода свой срок и своя отметка оплаты' },
]

export function LoginPage() {
  const me = useMe()
  const login = useLogin()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { login: '', password: '' } })

  const next = params.get('next')
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : null

  const home = (role: string) => target ?? (role === 'admin' ? '/' : '/payments')
  if (me.data) return <Navigate to={home(me.data.role)} replace />

  const onSubmit = handleSubmit((values) =>
    login.mutate(values, { onSuccess: ({ user }) => navigate(home(user.role), { replace: true }) }),
  )

  return (
    <div className="grid min-h-dvh grid-cols-1 bg-raised lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        {/* Форма по центру колонки: прижатая к логотипу, она оставляла пустой правую половину экрана. */}
        <div className="flex flex-1 items-center justify-center">
          <form onSubmit={onSubmit} noValidate className="grid w-full max-w-sm gap-6 py-12">
            <div className="grid gap-2">
              <h1 className="font-display text-4xl leading-none font-extrabold uppercase">Вход</h1>
              <p className="text-fg-secondary">Платежи команды, сроки и оплаты в одном месте.</p>
            </div>

            {login.isError && (
              <div role="alert" className="rounded-lg border border-subtle bg-danger-bg px-3 py-2.5 text-sm text-danger">
                {loginErrorMessage(login.error)}
              </div>
            )}

            <div className="grid gap-4">
              <Field id="login" label="Логин" error={errors.login?.message}>
                <Input
                  {...fieldAria('login', errors.login?.message)}
                  {...register('login')}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                />
              </Field>
              <Field id="password" label="Пароль" error={errors.password?.message}>
                <Input
                  {...fieldAria('password', errors.password?.message)}
                  {...register('password')}
                  type="password"
                  autoComplete="current-password"
                />
              </Field>
            </div>

            <Button type="submit" variant="primary" loading={login.isPending} className="w-full">
              {login.isPending ? 'Входим' : 'Войти'}
            </Button>
          </form>
        </div>
        <p className="mx-auto w-full max-w-sm text-xs text-fg-tertiary">Учётную запись выдаёт администратор.</p>
      </main>

      {/* Паттерн по стр. 22 гайдбука на всю панель; текст правее акцентной линии и выше её поворота. */}
      <aside className={cn('relative hidden overflow-hidden bg-brand-panel text-brand-panel-fg lg:block', patternMetrics.panel)}>
        <BrandPattern variant="panel" tone="panel" />
        <div className={cn('relative grid max-w-2xl gap-10 pt-16 pr-12', panelText)}>
          <p className="font-display text-4xl leading-[1.05] font-extrabold text-brand-accent uppercase xl:text-5xl">
            Ни один регулярный платёж не останется без внимания
          </p>
          <ul className="grid gap-6">
            {facts.map(({ icon: Icon, title, text }) => (
              <li key={title} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <span className="row-span-2 flex size-10 items-center justify-center rounded-md bg-brand-accent text-brand-panel">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="font-semibold">{title}</span>
                <span className="text-brand-panel-fg-secondary">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  )
}

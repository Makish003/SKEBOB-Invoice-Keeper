import {
  CalendarDays,
  ChartColumn,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  ReceiptText,
  Repeat,
  ScrollText,
  Sun,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { LayoutGroup, motion } from 'motion/react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { KeySkirt } from '@/components/KeySkirt'
import { Logo } from '@/components/Logo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useLogout } from '@/features/auth/api'
import { useCurrentUser } from '@/features/auth/guards'
import { MonthPlate } from '@/features/dashboard/MonthPlate'
import { OverdueNav } from '@/features/occurrences/OverdueNav'
import { cn } from '@/lib/cn'
import { pageEnter, spring, useReducedMotion } from '@/lib/motion'
import { type ThemePreference, useTheme } from '@/lib/theme'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  adminOnly?: boolean
}

export const navItems: NavItem[] = [
  { to: '/', label: 'Сводка', icon: LayoutDashboard },
  { to: '/payments', label: 'Платежи', icon: ReceiptText },
  { to: '/calendar', label: 'Календарь', icon: CalendarDays },
  { to: '/reports', label: 'Отчёты', icon: ChartColumn },
  { to: '/recurring', label: 'Регулярные', icon: Repeat, adminOnly: true },
  { to: '/users', label: 'Пользователи', icon: Users, adminOnly: true },
  { to: '/audit', label: 'Журнал', icon: ScrollText, adminOnly: true },
]

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const user = useCurrentUser()
  const items = navItems.filter((item) => !item.adminOnly || user.role === 'admin')
  const reduce = useReducedMotion()
  // LayoutGroup: когда под «Платежами» раскрывается просрочка, пункты ниже съезжают анимацией transform.
  return (
    <LayoutGroup>
      <motion.nav
        layoutScroll
        aria-label="Основная навигация"
        className="-mx-1 grid min-h-0 content-start gap-0.5 overflow-y-auto px-1 pb-1"
      >
        {items.map(({ to, label, icon: Icon }) => (
          <motion.div key={to} layout="position" transition={reduce ? { duration: 0 } : spring} className="grid gap-0.5">
            <NavLink
              to={to}
              end={to === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'icon-play flex h-10 items-center gap-2.5 rounded-md px-2 text-sm font-medium transition-control outline-none',
                  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                  isActive ? 'bg-sunken text-fg' : 'text-fg-secondary hover:bg-secondary-hover hover:text-fg',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* Иконка на фирменной плитке: чёрная клавиша с голубым знаком у активного раздела; под курсором плитка встаёт кейкапом и нажимается (.ik-tile, юбка KeySkirt). */}
                  <span className="ik-tile size-7 shrink-0">
                    <KeySkirt />
                    <span
                      className={cn(
                        'ik-tile-cap flex size-full items-center justify-center rounded-sm',
                        isActive ? 'bg-brand-tile text-brand-tile-fg' : 'text-fg-tertiary',
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                  </span>
                  {label}
                </>
              )}
            </NavLink>
            {to === '/payments' && <OverdueNav onNavigate={onNavigate} />}
          </motion.div>
        ))}
      </motion.nav>
    </LayoutGroup>
  )
}

const themeOptions: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Светлая тема', icon: Sun },
  { value: 'dark', label: 'Тёмная тема', icon: Moon },
  { value: 'system', label: 'Как в системе', icon: Monitor },
]

function UserMenu() {
  const user = useCurrentUser()
  const logout = useLogout()
  const navigate = useNavigate()
  const { preference, setPreference } = useTheme()
  const initials = user.display_name.trim().slice(0, 1).toUpperCase()

  const onLogout = () =>
    logout.mutate(undefined, {
      onSuccess: () => navigate('/login', { replace: true }),
      onError: () => toast.error('Не удалось выйти. Попробуйте ещё раз'),
    })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full min-w-0 items-center gap-2.5 rounded-md p-1.5 text-left transition-control outline-none',
            'hover:bg-secondary-hover focus-visible:outline-2 focus-visible:outline-ring',
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-brand-key text-sm font-bold text-brand-key-fg">
            {initials}
          </span>
          <span className="grid min-w-0 flex-1">
            <span className="truncate text-sm font-medium text-fg">{user.display_name}</span>
            <span className="truncate text-xs text-fg-tertiary">{user.role === 'admin' ? 'Администратор' : 'Пользователь'}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel>Вы вошли как {user.login}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {themeOptions.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => setPreference(value)}
            aria-checked={preference === value}
            role="menuitemradio"
          >
            <Icon aria-hidden />
            <span className="flex-1">{label}</span>
            {preference === value && <span className="size-1.5 rounded-full bg-primary" aria-hidden />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout} disabled={logout.isPending}>
          <LogOut aria-hidden />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Низ боковой панели: плитка месяца с фирменным паттерном (ADR-028) и профиль. На низком экране плитка уступает место меню. */
function SidebarFooter({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="mt-auto grid gap-3">
      <MonthPlate onNavigate={onNavigate} className="[@media(max-height:44rem)]:hidden" />
      <UserMenu />
    </div>
  )
}

function MobileNav() {
  const [open, setOpen] = useState(false)
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="Открыть меню">
          <Menu aria-hidden />
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-[ik-fade_var(--duration-base)_var(--ease-out)]" />
        <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-6 border-r border-subtle bg-panel p-4 data-[state=open]:animate-[ik-fade_var(--duration-base)_var(--ease-out)]">
          <DialogPrimitive.Title className="sr-only">Меню</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Разделы приложения</DialogPrimitive.Description>
          <Logo />
          <Navigation onNavigate={() => setOpen(false)} />
          <SidebarFooter onNavigate={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function Shell() {
  const user = useCurrentUser()
  const { pathname } = useLocation()
  const reduce = useReducedMotion()
  return (
    <TooltipProvider delayDuration={300}>
      <a
        href="#content"
        className="sr-only z-50 rounded-md bg-raised px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Перейти к содержимому
      </a>
      <div className="min-h-dvh lg:grid lg:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]">
        <div className="hidden border-r border-subtle bg-panel lg:block">
          <aside className="sticky top-0 flex h-dvh flex-col gap-6 p-3">
            <div className="px-2 pt-2">
              <Logo />
            </div>
            <Navigation />
            <SidebarFooter />
          </aside>
        </div>

        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-subtle bg-panel px-2 lg:hidden">
          <MobileNav />
          <Logo />
          {user.role === 'admin' && (
            <Badge tone="info" className="ml-auto">
              Админ
            </Badge>
          )}
        </header>

        <main id="content" tabIndex={-1} className="min-w-0 outline-none">
          {/* Ключ по пути: смена раздела проигрывает вход страницы, смена фильтров (search) нет. */}
          <motion.div key={pathname} initial={reduce ? false : 'hidden'} animate="show" variants={pageEnter}>
            <Outlet />
          </motion.div>
        </main>
      </div>
    </TooltipProvider>
  )
}

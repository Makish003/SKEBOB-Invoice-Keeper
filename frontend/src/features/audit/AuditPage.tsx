import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { isSameDay, subDays } from 'date-fns'
import {
  Ban,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CirclePlus,
  Database,
  LifeBuoy,
  Link2,
  LogIn,
  LogOut,
  type LucideIcon,
  MessageSquareText,
  Paperclip,
  Pencil,
  ScrollText,
  Search,
  ShieldAlert,
  Undo2,
  UserMinus,
  UserPen,
  UserPlus,
  Wallet,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useSearchParams } from 'react-router'
import { api, type Schemas, unwrap } from '@/api/client'
import { Page, PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Segmented } from '@/components/ui/tabs'
import { useAppInfo } from '@/features/app-info'
import { periodLabels, type Period } from '@/features/recurring/api'
import { statusMeta, topicLabels } from '@/features/tickets/api'
import { cn } from '@/lib/cn'
import { type Currency, formatDate, formatDateLong, formatMoney, toIsoDate } from '@/lib/format'
import { fadeUp, reduced, stagger, useReducedMotion } from '@/lib/motion'

type Entry = Schemas['AuditEntry']
type Category = 'all' | 'auth' | 'payments' | 'occurrences' | 'users' | 'tickets'
type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'
const PAGE_SIZE = 50

const categories: { value: Category; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'auth', label: 'Входы' },
  { value: 'payments', label: 'Платежи' },
  { value: 'occurrences', label: 'Оплаты' },
  { value: 'users', label: 'Пользователи' },
  { value: 'tickets', label: 'Заявки' },
]

const ticketTopics: Record<string, string> = topicLabels
const ticketStatuses: Record<string, string> = Object.fromEntries(Object.entries(statusMeta).map(([k, v]) => [k, v.label]))
const fieldNames: Record<string, string> = { login: 'логин', display_name: 'имя', password: 'пароль' }
const monthNames = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']

/** Иконка события на скруглённой плитке со сплошной заливкой, как в навигации (гайдбук, с. 21). Цвет плитки = тон события. */
const toneTile: Record<Tone, string> = {
  neutral: 'bg-sunken text-fg-secondary',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-info-bg text-info',
}

type Payload = Record<string, unknown> & {
  before?: { paid_at?: string | null }
  after?: { paid_at?: string | null }
}

/** Заголовок говорит, что случилось; подробность есть, только если добавляет что-то к заголовку. */
function describe(entry: Entry): { title: string; detail?: string; tone: Tone; icon: LucideIcon } {
  const p = (entry.payload ?? {}) as Payload
  switch (entry.action) {
    case 'auth.login.success':
      return { title: 'Вход в систему', tone: 'neutral', icon: LogIn }
    case 'auth.login.failed':
      return { title: 'Ошибка входа', tone: 'danger', icon: ShieldAlert, detail: `Неверный пароль или логин «${String(p.login ?? '')}»` }
    case 'auth.logout':
      return { title: 'Выход из системы', tone: 'neutral', icon: LogOut }
    case 'recurring_payment.created':
      return {
        title: 'Платёж добавлен',
        tone: 'info',
        icon: CirclePlus,
        detail: `${formatMoney(String(p.amount ?? '0'), (p.currency as Currency) ?? 'RUB')}, ${periodLabels[(p.period as Period) ?? 'monthly'].toLowerCase()}, первый срок ${p.first_due_date ? formatDate(String(p.first_due_date)) : ''}`,
      }
    case 'recurring_payment.updated': {
      const changes = (p.changes ?? {}) as Record<string, [string | null, string | null]>
      const parts = Object.entries(changes).map(([field, [before, after]]) =>
        field === 'amount'
          ? `сумма ${before} → ${after}${p.periods_repriced ? ` (периодов: ${String(p.periods_repriced)})` : ''}`
          : field === 'name'
            ? `название «${before ?? ''}» → «${after ?? ''}»`
            : 'комментарий',
      )
      return { title: 'Платёж изменён', tone: 'info', icon: Pencil, detail: parts.length ? `Изменено: ${parts.join(', ')}` : undefined }
    }
    case 'recurring_payment.deleted':
      return { title: 'Платёж прекращён', tone: 'warning', icon: Ban, detail: 'Новые периоды и напоминания остановлены, история сохранена' }
    case 'occurrence.paid': {
      const parts = [p.after?.paid_at ? `Дата оплаты ${formatDate(p.after.paid_at)}` : '', p.source === 'telegram' ? 'кнопкой в Telegram' : '']
      return { title: 'Отмечена оплата', tone: 'success', icon: CircleCheck, detail: parts.filter(Boolean).join(', ') || undefined }
    }
    case 'occurrence.unpaid':
      return { title: 'Отметка об оплате снята', tone: 'warning', icon: Undo2 }
    case 'occurrence.paid_at_changed':
      return {
        title: 'Исправлена дата оплаты',
        tone: 'info',
        icon: CalendarClock,
        detail: `Было ${p.before?.paid_at ? formatDate(p.before.paid_at) : '?'}, стало ${p.after?.paid_at ? formatDate(p.after.paid_at) : '?'}`,
      }
    case 'occurrence.note_changed':
      return { title: 'Изменён комментарий к периоду', tone: 'neutral', icon: MessageSquareText }
    case 'user.created':
      return { title: 'Пользователь создан', tone: 'info', icon: UserPlus }
    case 'user.updated':
      return {
        title: 'Пользователь изменён',
        tone: 'neutral',
        icon: UserPen,
        detail: `Изменено: ${((p.fields as string[]) ?? []).map((f) => fieldNames[f] ?? f).join(', ')}`,
      }
    case 'user.deleted':
      return { title: 'Пользователь удалён', tone: 'danger', icon: UserMinus, detail: 'Сессии завершены, история оплат сохранена' }
    case 'occurrence.receipt_uploaded':
      return { title: 'Прикреплён чек', tone: 'neutral', icon: Paperclip, detail: p.file_name ? String(p.file_name) : undefined }
    case 'occurrence.receipt_deleted':
      return { title: 'Чек удалён', tone: 'warning', icon: Paperclip, detail: p.file_name ? String(p.file_name) : undefined }
    case 'occurrence.receipt_link_changed':
      return { title: 'Изменена ссылка на чек', tone: 'neutral', icon: Link2 }
    case 'budget.set':
    case 'budget.deleted': {
      const scope = p.month ? `${monthNames[Number(p.month) - 1]} ${String(p.year)}` : `${String(p.year)} год`
      const currency = (p.currency as Currency) ?? 'RUB'
      return entry.action === 'budget.set'
        ? { title: 'Задан бюджет', tone: 'info', icon: Wallet, detail: `${scope}, ${formatMoney(String(p.amount ?? '0'), currency)}` }
        : { title: 'Бюджет снят', tone: 'neutral', icon: Wallet, detail: `${scope}, ${currency}` }
    }
    case 'ticket.created':
      return { title: 'Создана заявка', tone: 'info', icon: LifeBuoy, detail: ticketTopics[String(p.topic)] }
    case 'ticket.updated': {
      const status = p.status as { to?: string } | undefined
      const parts = [status?.to ? `статус «${ticketStatuses[status.to] ?? status.to}»` : '', p.admin_reply ? 'ответ' : '']
      return { title: 'Заявка обработана', tone: 'neutral', icon: MessageSquareText, detail: `Изменено: ${parts.filter(Boolean).join(', ')}` }
    }
    case 'seed.demo_data':
      return { title: 'Загружены демо-данные', tone: 'neutral', icon: Database, detail: 'Демонстрационные платежи и пользователи' }
    default:
      return { title: entry.action, tone: 'neutral', icon: ScrollText }
  }
}

/** Лента по дням: записи уже отсортированы сервером, новые сверху. */
function groupByDay(items: Entry[]): { day: Date; entries: Entry[] }[] {
  const groups: { day: Date; entries: Entry[] }[] = []
  for (const entry of items) {
    const at = new Date(entry.at)
    const last = groups.at(-1)
    if (last && isSameDay(last.day, at)) last.entries.push(entry)
    else groups.push({ day: at, entries: [entry] })
  }
  return groups
}

function dayLabel(day: Date, today: Date): string {
  if (isSameDay(day, today)) return 'Сегодня'
  if (isSameDay(day, subDays(today, 1))) return 'Вчера'
  return formatDateLong(toIsoDate(day), today)
}

const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

/** Телефон: плитка, событие в две-три строки, время справа. Шире: одна плотная строка, читается как запись лога
 * «время, автор, событие с подробностью», IP в стороне, чтобы широкий экран не превращался в пустые поля. */
function EntryRow({ entry }: { entry: Entry }) {
  const { title, detail, tone, icon: Icon } = describe(entry)
  const entity = entry.entity_label && !entry.action.startsWith('auth.') ? entry.entity_label : null
  const actor = entry.actor_label ?? 'Система'
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-2.5 sm:px-5 md:grid-cols-[2.75rem_8rem_auto_minmax(0,1fr)_7.5rem] md:items-center md:gap-x-4 md:py-2">
      <time dateTime={entry.at} className="order-last pt-1 text-sm text-fg-tertiary tabular md:order-1 md:pt-0">
        {timeFormat.format(new Date(entry.at))}
      </time>
      <span className={cn('flex size-7 items-center justify-center rounded-sm md:order-3', toneTile[tone])}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 md:order-4">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{title}</span>
          {entity && <span className="min-w-0 truncate text-fg-secondary">{entity}</span>}
          {detail && <span className="basis-full text-sm text-fg-tertiary md:basis-auto">{detail}</span>}
        </p>
        <p className="text-xs text-fg-tertiary md:hidden">{actor}</p>
      </div>
      <span className="hidden truncate text-sm text-fg-secondary md:order-2 md:block">{actor}</span>
      <span className="hidden truncate text-right text-xs text-fg-tertiary tabular md:order-5 md:block">{entry.ip}</span>
    </div>
  )
}

function LoadingRows() {
  return (
    <div className="grid" aria-busy="true" aria-label="Загрузка журнала">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <Skeleton className="size-8 rounded-md" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-10" />
        </div>
      ))}
    </div>
  )
}

/** Сколько записей журнала за сегодня (`total` при `limit=1`); фильтр: категория или точное действие. */
function useTodayCount(todayIso: string, filter: { category?: 'auth'; action?: string } = {}) {
  return useQuery({
    queryKey: ['audit', 'today-count', todayIso, filter],
    queryFn: () =>
      unwrap(api.GET('/api/v1/audit-log', { params: { query: { ...filter, date_from: todayIso, date_to: todayIso, limit: 1 } } })),
    select: (data) => data.total,
  })
}

function useTodayStats(todayIso: string) {
  const all = useTodayCount(todayIso)
  const logins = useTodayCount(todayIso, { action: 'auth.login.success' })
  const auth = useTodayCount(todayIso, { category: 'auth' })
  const counts = [all, logins, auth]
  if (counts.some((c) => c.isError)) return undefined
  const value = (n: number | undefined) => n ?? <Skeleton className="h-6 w-8" />
  // Изменения: всё, кроме входов и выходов (платежи, оплаты, пользователи, бюджет).
  const changes = all.data !== undefined && auth.data !== undefined ? all.data - auth.data : undefined
  return [
    { label: 'событий сегодня', value: value(all.data) },
    { label: 'входов', value: value(logins.data) },
    { label: 'изменений', value: value(changes) },
  ]
}

export function AuditPage() {
  const { today, todayIso } = useAppInfo()
  const stats = useTodayStats(todayIso)
  const reduce = useReducedMotion()
  const [params, setParams] = useSearchParams()
  const category = (categories.some((c) => c.value === params.get('category')) ? params.get('category') : 'all') as Category
  const q = params.get('q') ?? ''
  const page = Math.max(1, Number(params.get('page')) || 1)
  const update = (patch: Record<string, string | null>, resetPage = true) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
        if (resetPage) next.delete('page')
        return next
      },
      { replace: true },
    )

  const query = {
    ...(category !== 'all' ? { category } : {}),
    ...(q ? { q } : {}),
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  } as const
  const log = useQuery({
    queryKey: ['audit', query],
    queryFn: () => unwrap(api.GET('/api/v1/audit-log', { params: { query } })),
    placeholderData: keepPreviousData,
  })
  const items = log.data?.items ?? []
  const total = log.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const variants = reduce ? reduced : fadeUp

  return (
    <Page>
      <PageHeader title="Журнал" description="Кто, что и когда сделал: входы, платежи, оплаты, пользователи." stats={stats} />
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<Category> label="Категория" value={category} onChange={(v) => update({ category: v === 'all' ? null : v })} options={categories} />
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-tertiary" aria-hidden />
          <Input
            type="search"
            aria-label="Поиск по автору или IP"
            placeholder="Автор или IP"
            className="pl-9"
            defaultValue={q}
            key={q}
            onKeyDown={(e) => e.key === 'Enter' && update({ q: e.currentTarget.value.trim() || null })}
            onBlur={(e) => e.currentTarget.value.trim() !== q && update({ q: e.currentTarget.value.trim() || null })}
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        {log.isPending ? (
          <LoadingRows />
        ) : log.isError ? (
          <ErrorState error={log.error} onRetry={() => log.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon={<ScrollText aria-hidden />} title="Записей нет" description="Измените категорию или поиск." />
        ) : (
          <>
            <motion.div key={`${category}-${q}-${page}`} initial="hidden" animate="show" variants={stagger(0.02)} aria-label="Журнал действий" role="list">
              {groupByDay(items).map(({ day, entries }) => (
                <section key={day.toISOString()} aria-label={dayLabel(day, today)} role="listitem" className="border-b border-subtle last:border-0">
                  <h2 className="bg-page px-4 py-2 text-xs font-medium text-fg-tertiary sm:px-5">{dayLabel(day, today)}</h2>
                  <ul className="divide-y divide-subtle">
                    {entries.map((entry) => (
                      <motion.li key={entry.id} variants={variants}>
                        <EntryRow entry={entry} />
                      </motion.li>
                    ))}
                  </ul>
                </section>
              ))}
            </motion.div>
            {total > PAGE_SIZE && (
              <nav aria-label="Страницы" className="flex items-center justify-between gap-3 border-t border-subtle px-4 py-3 sm:px-5">
                <p className="text-fg-tertiary tabular">
                  {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} из {total}
                </p>
                <div className="flex gap-1">
                  <Button variant="secondary" size="icon-sm" aria-label="Предыдущая страница" disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)}>
                    <ChevronLeft aria-hidden />
                  </Button>
                  <Button variant="secondary" size="icon-sm" aria-label="Следующая страница" disabled={page >= pages} onClick={() => update({ page: String(page + 1) }, false)}>
                    <ChevronRight aria-hidden />
                  </Button>
                </div>
              </nav>
            )}
          </>
        )}
      </Card>
    </Page>
  )
}

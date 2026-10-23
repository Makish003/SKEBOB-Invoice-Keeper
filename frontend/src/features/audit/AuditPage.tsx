import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ScrollText, Search } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { api, type Schemas, unwrap } from '@/api/client'
import { Page, PageHeader } from '@/components/PageHeader'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Segmented } from '@/components/ui/tabs'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { periodLabels, type Period } from '@/features/recurring/api'
import { type Currency, formatDate, formatDateTime, formatMoney } from '@/lib/format'

type Entry = Schemas['AuditEntry']
type Category = 'all' | 'auth' | 'payments' | 'occurrences' | 'users'
const PAGE_SIZE = 50

const categories: { value: Category; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'auth', label: 'Входы' },
  { value: 'payments', label: 'Платежи' },
  { value: 'occurrences', label: 'Оплаты' },
  { value: 'users', label: 'Пользователи' },
]

const fieldNames: Record<string, string> = { login: 'логин', display_name: 'имя', password: 'пароль' }

type Payload = Record<string, unknown> & {
  before?: { paid_at?: string | null }
  after?: { paid_at?: string | null }
}

function describe(entry: Entry): { text: string; tone: BadgeProps['tone']; label: string } {
  const p = (entry.payload ?? {}) as Payload
  switch (entry.action) {
    case 'auth.login.success':
      return { label: 'Вход', tone: 'neutral', text: 'Вход в систему' }
    case 'auth.login.failed':
      return { label: 'Ошибка входа', tone: 'danger', text: `Неверный пароль или логин «${String(p.login ?? '')}»` }
    case 'auth.logout':
      return { label: 'Выход', tone: 'neutral', text: 'Выход из системы' }
    case 'recurring_payment.created':
      return {
        label: 'Платёж добавлен',
        tone: 'info',
        text: `${formatMoney(String(p.amount ?? '0'), (p.currency as Currency) ?? 'RUB')}, ${periodLabels[(p.period as Period) ?? 'monthly'].toLowerCase()}, первый срок ${p.first_due_date ? formatDate(String(p.first_due_date)) : ''}`,
      }
    case 'recurring_payment.deleted':
      return { label: 'Платёж прекращён', tone: 'warning', text: 'Новые периоды и напоминания остановлены, история сохранена' }
    case 'occurrence.paid':
      return {
        label: 'Оплата',
        tone: 'success',
        text: `Отмечена оплата ${p.after?.paid_at ? formatDate(p.after.paid_at) : ''}${p.source === 'telegram' ? ' кнопкой в Telegram' : ''}`,
      }
    case 'occurrence.unpaid':
      return { label: 'Отмена оплаты', tone: 'warning', text: 'Отметка об оплате снята' }
    case 'occurrence.paid_at_changed':
      return {
        label: 'Исправлена дата',
        tone: 'info',
        text: `Дата оплаты изменена с ${p.before?.paid_at ? formatDate(p.before.paid_at) : '?'} на ${p.after?.paid_at ? formatDate(p.after.paid_at) : '?'}`,
      }
    case 'occurrence.note_changed':
      return { label: 'Комментарий', tone: 'neutral', text: 'Изменён комментарий к периоду' }
    case 'user.created':
      return { label: 'Пользователь создан', tone: 'info', text: `Логин ${String(p.login ?? '')}` }
    case 'user.updated':
      return {
        label: 'Пользователь изменён',
        tone: 'neutral',
        text: `Изменено: ${((p.fields as string[]) ?? []).map((f) => fieldNames[f] ?? f).join(', ')}`,
      }
    case 'user.deleted':
      return { label: 'Пользователь удалён', tone: 'danger', text: 'Сессии завершены, история оплат сохранена' }
    case 'seed.demo_data':
      return { label: 'Демо-данные', tone: 'neutral', text: 'Загружены демонстрационные платежи и пользователи' }
    default:
      return { label: entry.action, tone: 'outline', text: '' }
  }
}

export function AuditPage() {
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

  return (
    <Page>
      <PageHeader title="Журнал" description="Кто, что и когда сделал: входы, платежи, оплаты, пользователи." />
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
          <div className="grid gap-3 p-4" aria-busy="true" aria-label="Загрузка журнала">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : log.isError ? (
          <ErrorState error={log.error} onRetry={() => log.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon={<ScrollText aria-hidden />} title="Записей нет" description="Измените категорию или поиск." />
        ) : (
          <>
            <Table aria-label="Журнал действий">
              <THead>
                <tr>
                  <TH className="pl-4">Когда</TH>
                  <TH>Кто</TH>
                  <TH>Действие</TH>
                  <TH className="hidden lg:table-cell">IP</TH>
                </tr>
              </THead>
              <TBody>
                {items.map((entry) => {
                  const d = describe(entry)
                  return (
                    <TR key={entry.id}>
                      <TD className="pl-4 align-top whitespace-nowrap text-fg-secondary tabular">{formatDateTime(entry.at)}</TD>
                      <TD className="max-w-40 align-top">
                        <span className="block truncate font-medium">{entry.actor_label ?? 'система'}</span>
                      </TD>
                      <TD className="align-top">
                        <div className="grid gap-1 py-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={d.tone}>{d.label}</Badge>
                            {entry.entity_label && !entry.action.startsWith('auth.') && <span className="font-medium">{entry.entity_label}</span>}
                          </div>
                          {d.text && <span className="text-fg-secondary">{d.text}</span>}
                        </div>
                      </TD>
                      <TD className="hidden align-top font-mono text-xs text-fg-tertiary lg:table-cell">{entry.ip ?? ''}</TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
            {total > PAGE_SIZE && (
              <nav aria-label="Страницы" className="flex items-center justify-between gap-3 border-t border-subtle px-4 py-3">
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

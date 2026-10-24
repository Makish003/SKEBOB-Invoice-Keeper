import { AlarmClock, CalendarCheck, CircleCheck, CircleDashed, Clock, MoreHorizontal, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, fieldAria } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Listbox, ListboxContent, ListboxItem, ListboxTrigger, ListboxValue } from '@/components/ui/listbox'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Segmented } from '@/components/ui/tabs'
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip'
import { type ThemePreference, useTheme } from '@/lib/theme'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-wrap items-start gap-3">{children}</CardBody>
    </Card>
  )
}

/** Витрина компонентов во всех состояниях: только в dev-сборке (/_ui). */
export function ShowcasePage() {
  const { preference, setPreference } = useTheme()
  const [tab, setTab] = useState<'due' | 'overdue' | 'paid' | 'all'>('due')
  const [today] = useState(() => new Date())
  const [date, setDate] = useState<Date | undefined>(today)
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <TooltipProvider>
      <main className="mx-auto grid max-w-5xl grid-cols-1 gap-4 px-4 py-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-fg-tertiary">Invoice Keeper</p>
            <h1 className="font-display text-4xl leading-none font-extrabold uppercase">Компоненты</h1>
          </div>
          <Segmented<ThemePreference>
            label="Тема"
            value={preference}
            onChange={setPreference}
            options={[
              { value: 'light', label: 'Светлая' },
              { value: 'dark', label: 'Тёмная' },
              { value: 'system', label: 'Системная' },
            ]}
          />
        </header>

        <Section title="Кнопки">
          <Button variant="primary">
            <Plus aria-hidden />
            Добавить платёж
          </Button>
          <Button variant="secondary">Отменить оплату</Button>
          <Button variant="ghost">Сбросить фильтры</Button>
          <Button variant="destructive">
            <Trash2 aria-hidden />
            Удалить
          </Button>
          <Button variant="destructive-ghost">Удалить</Button>
          <Button variant="primary" loading>
            Сохраняем
          </Button>
          <Button variant="secondary" disabled>
            Недоступно
          </Button>
          <Button variant="secondary" size="sm">
            Маленькая
          </Button>
          <Tooltip content="Изменить">
            <Button variant="ghost" size="icon" aria-label="Изменить">
              <Pencil aria-hidden />
            </Button>
          </Tooltip>
        </Section>

        <Section title="Поля ввода">
          <Field id="ui-name" label="Название" hint="Как платёж будет называться в списке" className="w-64">
            <Input {...fieldAria('ui-name', undefined, true)} placeholder="Аренда офиса" />
          </Field>
          <Field id="ui-amount" label="Сумма" error="Введите сумму больше нуля" className="w-64">
            <Input {...fieldAria('ui-amount', 'error')} inputMode="decimal" defaultValue="0" />
          </Field>
          <Field id="ui-disabled" label="Логин" className="w-64">
            <Input {...fieldAria('ui-disabled')} defaultValue="admin" disabled />
          </Field>
          <Field id="ui-currency" label="Валюта" className="w-48">
            <Listbox defaultValue="RUB">
              <ListboxTrigger id="ui-currency">
                <ListboxValue />
              </ListboxTrigger>
              <ListboxContent>
                <ListboxItem value="RUB">RUB, рубль</ListboxItem>
                <ListboxItem value="USD">USD, доллар</ListboxItem>
                <ListboxItem value="EUR">EUR, евро</ListboxItem>
              </ListboxContent>
            </Listbox>
          </Field>
        </Section>

        <Section title="Вкладки">
          <Segmented
            label="Быстрые фильтры"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'due', label: 'К оплате', count: 4 },
              { value: 'overdue', label: 'Просрочено', count: 1 },
              { value: 'paid', label: 'Оплачено', count: 7 },
              { value: 'all', label: 'Все' },
            ]}
          />
        </Section>

        <Section title="Статусы периодов">
          <Badge tone="success">
            <CircleCheck aria-hidden />
            Оплачен
          </Badge>
          <Badge tone="warning">
            <CalendarCheck aria-hidden />
            Оплачен с опозданием
          </Badge>
          <Badge tone="neutral">
            <CircleDashed aria-hidden />
            Ожидает
          </Badge>
          <Badge tone="info">
            <Clock aria-hidden />
            Скоро срок
          </Badge>
          <Badge tone="warning">
            <AlarmClock aria-hidden />
            Срок сегодня
          </Badge>
          <Badge tone="danger">
            <TriangleAlert aria-hidden />
            Просрочен
          </Badge>
        </Section>

        <Section title="Оверлеи">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Открыть диалог</Button>
            </DialogTrigger>
            <DialogContent title="Новый регулярный платёж" description="Напоминание придёт за 3 дня до срока">
              <Field id="ui-dialog-name" label="Название">
                <Input {...fieldAria('ui-dialog-name')} />
              </Field>
              <DialogFooter>
                <Button variant="primary">Сохранить</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            Удалить платёж
          </Button>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Прекратить платёж «Аренда офиса»?"
            description="Новые периоды и напоминания не появятся. Прошлые периоды и оплаты сохранятся в истории."
            confirmLabel="Прекратить"
            destructive
            onConfirm={() => setConfirmOpen(false)}
          />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary">Выбрать дату</Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto">
              <Calendar mode="single" selected={date} onSelect={setDate} disabled={{ after: today }} />
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Действия">
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>
                <Pencil aria-hidden />
                Исправить дату
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive>
                <Trash2 aria-hidden />
                Удалить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Section>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardBody className="grid gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-4 w-full" />
            </CardBody>
          </Card>
          <Card>
            <EmptyState title="Платежей пока нет" description="Добавьте первый регулярный платёж" />
          </Card>
          <Card>
            <ErrorState error={new Error('network')} onRetry={() => undefined} />
          </Card>
        </div>
      </main>
    </TooltipProvider>
  )
}

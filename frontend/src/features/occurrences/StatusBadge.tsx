import { AlarmClock, CalendarCheck, CircleCheck, CircleDashed, Clock, TriangleAlert, type LucideIcon } from 'lucide-react'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { days } from '@/lib/format'
import type { Occurrence } from './api'

type Display = Occurrence['display_status']

const config: Record<Display, { label: string; tone: BadgeProps['tone']; icon: LucideIcon }> = {
  paid: { label: 'Оплачен', tone: 'success', icon: CircleCheck },
  paid_late: { label: 'Оплачен с опозданием', tone: 'warning', icon: CalendarCheck },
  upcoming: { label: 'Ожидает', tone: 'neutral', icon: CircleDashed },
  due_soon: { label: 'Скоро срок', tone: 'info', icon: Clock },
  due_today: { label: 'Срок сегодня', tone: 'warning', icon: AlarmClock },
  overdue: { label: 'Просрочен', tone: 'danger', icon: TriangleAlert },
}

export function StatusBadge({ status }: { status: Display }) {
  const { label, tone, icon: Icon } = config[status]
  return (
    <Badge tone={tone}>
      <Icon aria-hidden />
      {label}
    </Badge>
  )
}

/** Пояснение к «Оплачен с опозданием»: «на 2 дня позже срока». У неоплаченной просрочки число дней уже
 * видно рядом со сроком («41 день назад»), поэтому второй раз его не повторяем. */
export function lateText(occ: Pick<Occurrence, 'status' | 'is_overdue' | 'overdue_days'>): string | null {
  return occ.status === 'paid' && occ.is_overdue ? `на ${days(occ.overdue_days)} позже срока` : null
}

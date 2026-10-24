import { addMonths, format, isSameMonth, startOfMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'

/** Переключатель месяца: «Сегодня» / назад / вперёд.
 *
 * «Сегодня» стоит слева и занимает место всегда (в текущем месяце невидима и вне порядка табуляции): иначе её
 * появление сдвигало бы стрелки, и следующий клик по стрелке попадал бы мимо. */
export function MonthSwitcher({ month, onChange, today }: { month: Date; onChange: (d: Date) => void; today: Date }) {
  const current = isSameMonth(month, today)
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className={cn(current && 'invisible')}
        aria-hidden={current}
        tabIndex={current ? -1 : undefined}
        onClick={() => onChange(startOfMonth(today))}
      >
        Сегодня
      </Button>
      <Button variant="secondary" size="icon-sm" aria-label="Предыдущий месяц" onClick={() => onChange(addMonths(month, -1))}>
        <ChevronLeft aria-hidden />
      </Button>
      <span className="min-w-36 text-center font-medium capitalize" aria-live="polite">
        {format(month, 'LLLL yyyy', { locale: ru })}
      </span>
      <Button variant="secondary" size="icon-sm" aria-label="Следующий месяц" onClick={() => onChange(addMonths(month, 1))}>
        <ChevronRight aria-hidden />
      </Button>
    </div>
  )
}

import { addMonths, format, isSameMonth, startOfMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Переключатель месяца: назад / вперёд / к текущему. */
export function MonthSwitcher({ month, onChange, today }: { month: Date; onChange: (d: Date) => void; today: Date }) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="secondary" size="icon-sm" aria-label="Предыдущий месяц" onClick={() => onChange(addMonths(month, -1))}>
        <ChevronLeft aria-hidden />
      </Button>
      <span className="min-w-36 text-center font-medium capitalize" aria-live="polite">
        {format(month, 'LLLL yyyy', { locale: ru })}
      </span>
      <Button variant="secondary" size="icon-sm" aria-label="Следующий месяц" onClick={() => onChange(addMonths(month, 1))}>
        <ChevronRight aria-hidden />
      </Button>
      {!isSameMonth(month, today) && (
        <Button variant="ghost" size="sm" onClick={() => onChange(startOfMonth(today))}>
          Текущий
        </Button>
      )}
    </div>
  )
}

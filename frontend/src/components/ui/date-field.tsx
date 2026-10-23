import { CalendarDays } from 'lucide-react'
import { useState } from 'react'
import type { Matcher } from 'react-day-picker'
import { cn } from '@/lib/cn'
import { formatDate, fromIsoDate, toIsoDate } from '@/lib/format'
import { Calendar } from './calendar'
import { fieldControl } from './input'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

interface DateFieldProps {
  id: string
  value: string | null
  onChange: (iso: string) => void
  placeholder?: string
  disabled?: Matcher | Matcher[]
  invalid?: boolean
  describedBy?: string
}

/** Поле даты: кнопка в стиле поля ввода + календарь в поповере. Значение в формате API (YYYY-MM-DD). */
export function DateField({ id, value, onChange, placeholder = 'Выберите дату', disabled, invalid, describedBy }: DateFieldProps) {
  const [open, setOpen] = useState(false)
  const selected = value ? fromIsoDate(value) : undefined
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(fieldControl, 'flex items-center justify-between gap-2 text-left', !value && 'text-fg-tertiary')}
        >
          <span className="tabular">{value ? formatDate(value) : placeholder}</span>
          <CalendarDays className="size-4 shrink-0 text-fg-tertiary" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          disabled={disabled}
          onSelect={(date) => {
            if (!date) return
            onChange(toIsoDate(date))
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

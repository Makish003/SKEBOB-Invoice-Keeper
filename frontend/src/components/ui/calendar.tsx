import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker, type DayPickerProps } from 'react-day-picker'
import { ru } from 'react-day-picker/locale'
import { cn } from '@/lib/cn'
import { buttonVariants } from './button'

/** Календарь на react-day-picker с локалью ru и нашими токенами. */
export function Calendar({ className, classNames, ...props }: DayPickerProps) {
  return (
    <DayPicker
      locale={ru}
      weekStartsOn={1}
      showOutsideDays
      className={cn('text-sm', className)}
      classNames={{
        months: 'relative',
        month: 'grid gap-3',
        month_caption: 'flex h-8 items-center px-1 font-semibold capitalize',
        nav: 'absolute top-0 right-0 flex gap-1',
        button_previous: buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
        button_next: buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
        month_grid: 'border-collapse',
        weekdays: 'flex',
        weekday: 'w-9 text-center text-xs font-normal text-fg-tertiary',
        week: 'mt-1 flex',
        day: 'size-9 p-0 text-center',
        day_button: cn(
          'size-9 rounded-md tabular transition-control outline-none hover:bg-secondary-hover',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
        ),
        selected: '[&>button]:bg-primary [&>button]:!text-fg-on-action [&>button:hover]:bg-primary-hover',
        today: '[&>button]:font-semibold [&>button]:text-link',
        outside: 'text-fg-tertiary',
        disabled: 'opacity-40 [&>button]:cursor-not-allowed [&>button:hover]:bg-transparent',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left' ? <ChevronLeft className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />,
      }}
      {...props}
    />
  )
}

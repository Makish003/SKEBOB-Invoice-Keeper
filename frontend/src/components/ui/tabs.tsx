import { motion } from 'motion/react'
import { ToggleGroup } from 'radix-ui'
import { useId } from 'react'
import { cn } from '@/lib/cn'
import { spring, useReducedMotion } from '@/lib/motion'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  count?: number
}

interface SegmentedProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: SegmentOption<T>[]
  label: string
  className?: string
}

/** Сегментированный переключатель (быстрые вкладки). Индикатор выбора плавно переезжает (layoutId). */
export function Segmented<T extends string>({ value, onChange, options, label, className }: SegmentedProps<T>) {
  const id = useId()
  const reduce = useReducedMotion()
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => next && onChange(next as T)}
      aria-label={label}
      className={cn('inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-sunken p-0.5', className)}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <ToggleGroup.Item
            key={option.value}
            value={option.value}
            className={cn(
              'relative inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium outline-none sm:gap-1.5 sm:px-3 sm:text-[0.8125rem]',
              'transition-control focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
              selected ? 'text-fg' : 'text-fg-secondary hover:text-fg',
            )}
          >
            {selected && (
              <motion.span
                layoutId={`${id}-segment`}
                transition={reduce ? { duration: 0 } : spring}
                className="absolute inset-0 rounded-md bg-raised shadow-raised ring-1 ring-subtle"
                aria-hidden
              />
            )}
            <span className="relative">{option.label}</span>
            {option.count !== undefined && (
              <span className="relative tabular text-xs text-fg-tertiary">{option.count}</span>
            )}
          </ToggleGroup.Item>
        )
      })}
    </ToggleGroup.Root>
  )
}

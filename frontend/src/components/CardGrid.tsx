import { AnimatePresence, motion } from 'motion/react'
import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { fadeUp, reduced, stagger, useReducedMotion } from '@/lib/motion'

/** Сетка карточек: одна колонка на телефоне, две с `sm`, три с `xl`. Скелетоны загрузки стоят в той же сетке. */
export const cardGridClass = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'

/** Поверхность карточки в сетке: содержимое колонкой, низ карточки прижимается `mt-auto`. */
export function ItemCard({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <article
      className={cn('flex h-full flex-col gap-4 rounded-xl border border-subtle bg-raised p-4 shadow-raised', className)}
      {...props}
    />
  )
}

/** Сплошная скруглённая плитка (стр. 21 гайдбука): срок, инициалы или иконка. Декоративная, смысл продублирован текстом. */
export function Tile({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div aria-hidden className={cn('grid size-14 shrink-0 content-center justify-items-center rounded-lg [&_svg]:size-6', className)}>
      {children}
    </div>
  )
}

interface CardGridProps<T extends { id: number }> {
  items: T[]
  label: string
  /** Смена ключа пересоздаёт список, и вход карточек играет заново (смена вкладки или страницы). */
  listKey?: string
  /** Выделенная карточка (кольцо), например период, открытый из боковой панели. */
  current?: (item: T) => boolean
  children: (item: T) => ReactNode
}

/**
 * Список карточек с входом лесенкой. Карточка, ушедшая из списка (оплачена, прекращена, удалена), гаснет, а соседние
 * сдвигаются на её место. Без `initial={false}` у AnimatePresence: иначе пересозданный ключом список пропускал бы вход.
 */
export function CardGrid<T extends { id: number }>({ items, label, listKey, current, children }: CardGridProps<T>) {
  const reduce = useReducedMotion()
  return (
    <motion.ul key={listKey} initial="hidden" animate="show" variants={stagger(0.03)} className={cardGridClass} aria-label={label}>
      <AnimatePresence mode="popLayout">
        {items.map((item) => (
          <motion.li
            key={item.id}
            layout={!reduce}
            variants={reduce ? reduced : fadeUp}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            aria-current={current?.(item) ? 'true' : undefined}
            className="rounded-xl aria-[current=true]:ring-2 aria-[current=true]:ring-danger/50"
          >
            {children(item)}
          </motion.li>
        ))}
      </AnimatePresence>
    </motion.ul>
  )
}

import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'

/**
 * Фирменный паттерн Aéza: три прямые параллельные линии и линии, которые идут параллельно и меняют
 * направление со скруглённым углом. Правило гайдбука: линия не обрывается внутри кадра, оба её конца
 * уходят за край контейнера. Поэтому паттерн собран из CSS-рамок, привязанных к краям, а не из SVG
 * фиксированной высоты: при любой ширине и высоте концы остаются за краем.
 *
 * - `panel`: низ брендовой панели входа (рельсы снизу, тройка линий поднимается и уходит вправо);
 * - `strip`: то же мельче, основание боковой панели;
 * - `corner`: тройка линий спускается сверху и уходит вправо, угол карточки.
 *
 * Контейнер родителя должен быть `relative overflow-hidden`. Декорация, скрыта от скринридеров.
 */
type Variant = 'panel' | 'strip' | 'corner'

const metrics: Record<Variant, string> = {
  panel: '[--s:8px] [--p:24px] [--r:20px] [--x:3] [--y:4.5] 2xl:[--s:10px] 2xl:[--p:32px] 2xl:[--r:24px] 2xl:[--y:5]',
  strip: '[--s:4px] [--p:12px] [--r:10px] [--x:2.5] [--y:4.5]',
  corner: '[--s:6px] [--p:16px] [--r:14px]',
}

const lines = [0, 1, 2]
const v = (expr: string) => `calc(${expr})`

/** Прямая рельса от левого до правого края, `y`: центр линии от низа. */
function Rail({ y, className }: { y: string; className: string }) {
  return (
    <span
      className={cn('absolute h-(--s)', className)}
      style={{ left: v('-1 * var(--s)'), right: v('-1 * var(--s)'), bottom: v(`${y} - var(--s) / 2`) }}
    />
  )
}

/**
 * Линия поднимается от нижнего края и поворачивает вправо к правому краю.
 * `x`: центр вертикали от левого края, `y`: центр горизонтали от низа, `r`: радиус по центру линии.
 */
function RiseRight({ x, y, r, className }: { x: string; y: string; r: string; className: string }) {
  const style: CSSProperties = {
    left: v(`${x} - var(--s) / 2`),
    right: v('-1 * var(--s)'),
    bottom: v('-1 * var(--s)'),
    height: v(`${y} + var(--s) * 1.5`),
    borderTopLeftRadius: v(`${r} + var(--s) / 2`),
  }
  return <span className={cn('absolute border-t-(length:--s) border-l-(length:--s)', className)} style={style} />
}

/**
 * Линия спускается от верхнего края и поворачивает вправо к правому краю.
 * `x`: центр вертикали от правого края, `y`: центр горизонтали от верха.
 */
function DropRight({ x, y, r, className }: { x: string; y: string; r: string; className: string }) {
  const style: CSSProperties = {
    top: v('-1 * var(--s)'),
    right: v('-1 * var(--s)'),
    width: v(`${x} + var(--s) * 1.5`),
    height: v(`${y} + var(--s) * 1.5`),
    borderBottomLeftRadius: v(`${r} + var(--s) / 2`),
  }
  return <span className={cn('absolute border-b-(length:--s) border-l-(length:--s)', className)} style={style} />
}

// Концентрические повороты: i = 0: внутренняя линия (ближе к углу поворота), шаг и радиус растут на --p.
const step = (base: string, i: number) => `${base} + var(--p) * ${i}`

export function BrandPattern({
  variant,
  tone = 'app',
  className,
}: {
  variant: Variant
  /** `panel`: чёрная брендовая панель (белые линии в обеих темах), `app`: поверхность приложения. */
  tone?: 'panel' | 'app'
  className?: string
}) {
  const line = tone === 'panel' ? 'border-brand-line' : 'border-brand-pattern-line'
  const accent = 'border-brand-accent'
  const rail = 'bg-brand-accent'

  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', metrics[variant], className)}>
      {variant === 'corner' ? (
        lines.map((i) => (
          <DropRight
            key={i}
            x={step('var(--p) * 7', i)}
            y={step('var(--p) * 1.5', i)}
            r={step('var(--r)', i)}
            className={i === 0 ? accent : line}
          />
        ))
      ) : (
        <>
          {lines.map((i) => (
            <Rail key={i} y={step('var(--p) * 1.5', i)} className={rail} />
          ))}
          {/* Ближняя к левому краю линия поворачивает выше всех: у неё самый большой радиус. */}
          {lines.map((i) => (
            <RiseRight
              key={i}
              x={step('var(--p) * var(--x)', 2 - i)}
              y={step('var(--p) * var(--y)', i)}
              r={step('var(--r)', i)}
              className={line}
            />
          ))}
        </>
      )}
    </div>
  )
}

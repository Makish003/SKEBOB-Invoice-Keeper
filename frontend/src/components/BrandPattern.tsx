import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'

/**
 * Фирменный паттерн Aéza по гайдбуку (docs/aeza-guidebook-2026.pdf, стр. 22): три прямые параллельные
 * линии и одна акцентная линия контрастного цвета, которая идёт параллельно и меняет направление
 * с плавным скруглением угла. Линия не обрывается внутри кадра: оба конца уходят за край контейнера,
 * поэтому паттерн собран из CSS-рамок, привязанных к краям, и не зависит от размеров контейнера.
 *
 * - `panel`: композиция стр. 22. Три белые вертикали на всю высоту у левого края, три голубые
 *   горизонтали у нижнего, голубая акцентная линия спускается сверху правее вертикалей и поворачивает
 *   к правому краю. Текст панели ставится правее акцентной линии и выше её поворота (`panelText`);
 * - `strip`: основание боковой панели. Её верхний край не край кадра, поэтому вертикалей нет:
 *   три голубые горизонтали и акцентная линия цвета линий, которая поднимается от низа и уходит вправо.
 *
 * Контейнер родителя должен быть `relative overflow-hidden`. Декорация, скрыта от скринридеров.
 */
type Variant = 'panel' | 'strip'

/** Толщина --s, шаг --p (у гайдбука толщина около половины шага), радиус поворота --r по центру линии. */
export const patternMetrics: Record<Variant, string> = {
  panel: '[--s:12px] [--p:24px] [--r:44px] 2xl:[--s:14px] 2xl:[--p:28px] 2xl:[--r:52px]',
  strip: '[--s:4px] [--p:10px] [--r:14px]',
}

/** Отступы текста брендовой панели: правее акцентной вертикали и выше её поворота. */
export const panelText = 'pl-[calc(var(--p)*7.5)] pb-[calc(var(--p)*9)]'

// Полные имена классов: Tailwind не видит классы, собранные из частей.
const tones = {
  panel: { post: 'bg-brand-line', turn: 'border-brand-line' },
  app: { post: 'bg-brand-pattern-line', turn: 'border-brand-pattern-line' },
}

const lines = [0, 1, 2]
const v = (expr: string) => `calc(${expr})`
const bleed = v('-1 * var(--s)')
const step = (base: string, i: number) => `${base} + var(--p) * ${i}`

/** Горизонталь от левого до правого края, `y`: центр линии от низа. */
function Rail({ y, className }: { y: string; className: string }) {
  return (
    <span className={cn('absolute h-(--s)', className)} style={{ left: bleed, right: bleed, bottom: v(`${y} - var(--s) / 2`) }} />
  )
}

/** Вертикаль от верхнего до нижнего края, `x`: центр линии от левого края. */
function Post({ x, className }: { x: string; className: string }) {
  return (
    <span className={cn('absolute w-(--s)', className)} style={{ top: bleed, bottom: bleed, left: v(`${x} - var(--s) / 2`) }} />
  )
}

/**
 * Акцентная линия: вертикаль на `x` от левого края, поворот к правому краю на высоте `y` от низа.
 * `from`: край, откуда приходит вертикаль, сверху (поворот вниз-вправо) или снизу (вверх-вправо).
 */
function Turn({ x, y, from, className }: { x: string; y: string; from: 'top' | 'bottom'; className: string }) {
  const radius = v('var(--r) + var(--s) / 2')
  const style: CSSProperties =
    from === 'top'
      ? { top: bleed, bottom: v(`${y} - var(--s) / 2`), borderBottomLeftRadius: radius }
      : { bottom: bleed, height: v(`${y} + var(--s) * 1.5`), borderTopLeftRadius: radius }
  return (
    <span
      className={cn(
        'absolute border-l-(length:--s)',
        from === 'top' ? 'border-b-(length:--s)' : 'border-t-(length:--s)',
        className,
      )}
      style={{ ...style, left: v(`${x} - var(--s) / 2`), right: bleed }}
    />
  )
}

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
  const { post, turn } = tones[tone]
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', patternMetrics[variant], className)}>
      {lines.map((i) => (
        <Rail key={i} y={step('var(--p) * 1.5', i)} className="bg-brand-accent" />
      ))}
      {variant === 'panel' ? (
        <>
          <Turn x="var(--p) * 5.5" y="var(--p) * 6.5" from="top" className="border-brand-accent" />
          {/* Вертикали последними: на стр. 22 белые линии лежат поверх голубых горизонталей. */}
          {lines.map((i) => (
            <Post key={i} x={step('var(--p) * 2', i)} className={post} />
          ))}
        </>
      ) : (
        <Turn x="var(--p) * 3" y="var(--p) * 5.5" from="bottom" className={turn} />
      )}
    </div>
  )
}

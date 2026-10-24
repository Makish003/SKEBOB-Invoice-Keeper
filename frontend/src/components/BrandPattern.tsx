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
 * - `card`: та же композиция в миниатюре на плитке месяца в боковой панели (ADR-028). Текст правее
 *   акцентной вертикали и ниже её поворота (`cardText`);
 * - `header`: шапка раздела (ADR-028). Горизонтали на всю ширину внизу, вертикали и оба поворота
 *   (акцентный и цвета линий) в правой части, текст слева над горизонталями (`headerText`).
 *   На узком экране вертикали прижаты к правому краю, второго поворота нет.
 *
 * Контейнер родителя должен быть `relative overflow-hidden`. Декорация, скрыта от скринридеров.
 */
type Variant = 'panel' | 'card' | 'header'

/** Толщина --s, шаг --p (у гайдбука толщина около половины шага), радиус поворота --r по центру линии, --x: первая вертикаль шапки. */
export const patternMetrics: Record<Variant, string> = {
  panel: '[--s:12px] [--p:24px] [--r:44px] 2xl:[--s:14px] 2xl:[--p:28px] 2xl:[--r:52px]',
  card: '[--s:5px] [--p:10px] [--r:16px]',
  header: '[--s:6px] [--p:12px] [--r:22px] [--x:calc(100%-4.5rem)] md:[--s:7px] md:[--p:14px] md:[--r:26px] md:[--x:58%]',
}

/** Отступы текста брендовой панели: правее акцентной вертикали и выше её поворота. */
export const panelText = 'pl-[calc(var(--p)*7.5)] pb-[calc(var(--p)*9)]'
/** Текст плитки месяца: правее акцентной вертикали, ниже её поворота. */
export const cardText = 'left-[calc(var(--p)*7)] top-[calc(var(--p)*4.4)] right-[calc(var(--p)*1.4)]'
/** Текст шапки: левее вертикалей и выше горизонталей. */
export const headerText = 'pr-[calc(100%-var(--x)+var(--p)*2)] pb-[calc(var(--p)*3.5+1.75rem)]'

// Полные имена классов: Tailwind не видит классы, собранные из частей.
const tones = {
  panel: { post: 'bg-brand-line', turn: 'border-brand-line' },
  plate: { post: 'bg-brand-pattern-line', turn: 'border-brand-pattern-line' },
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
 * Поворачивающая линия: вертикаль на `x` от левого края приходит сверху и поворачивает к правому краю
 * на высоте `y` от низа (`100% - …` отсчитывает от верха).
 */
function Turn({ x, y, className }: { x: string; y: string; className: string }) {
  const style: CSSProperties = {
    top: bleed,
    bottom: v(`${y} - var(--s) / 2`),
    left: v(`${x} - var(--s) / 2`),
    right: bleed,
    borderBottomLeftRadius: v('var(--r) + var(--s) / 2'),
  }
  return <span className={cn('absolute border-b-(length:--s) border-l-(length:--s)', className)} style={style} />
}

export function BrandPattern({
  variant,
  tone = 'plate',
  className,
}: {
  variant: Variant
  /** `panel`: чёрная брендовая панель (белые линии в обеих темах), `plate`: плитка приложения (линии по теме). */
  tone?: 'panel' | 'plate'
  className?: string
}) {
  const { post, turn } = tones[tone]
  const layout = {
    panel: { post: 'var(--p) * 2', accent: { x: 'var(--p) * 5.5', y: 'var(--p) * 6.5' } },
    card: { post: 'var(--p) * 1.8', accent: { x: 'var(--p) * 5.4', y: '100% - var(--p) * 2.8' } },
    header: { post: 'var(--x)', accent: { x: 'var(--x) + var(--p) * 3.75', y: '100% - var(--p) * 4.5' } },
  }[variant]
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', patternMetrics[variant], className)}>
      {lines.map((i) => (
        <Rail key={i} y={step('var(--p) * 1.5', i)} className="bg-brand-accent" />
      ))}
      <Turn {...layout.accent} className="border-brand-accent" />
      {/* Второй поворот стр. 22: цвета линий, справа, над горизонталями. */}
      {variant === 'header' && <Turn x="86%" y="var(--p) * 6" className={cn('hidden md:block', turn)} />}
      {/* Вертикали последними: на стр. 22 белые линии лежат поверх голубых горизонталей. */}
      {lines.map((i) => (
        <Post key={i} x={step(layout.post, i)} className={post} />
      ))}
    </div>
  )
}

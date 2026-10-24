import { cn } from '@/lib/cn'

/**
 * Фирменный паттерн Aéza: три прямые параллельные линии и акцентная линия, которая идёт параллельно
 * и меняет направление со скруглением угла. Широкая полоса, прижата к низу и левому краю. Декорация,
 * скрыта от скринридеров.
 */
export function BrandPattern({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 800 240"
      preserveAspectRatio="xMinYMax slice"
      fill="none"
      strokeWidth="8"
      aria-hidden
      className={cn('block', className)}
    >
      <g className="stroke-brand-accent">
        <path d="M0 150H800M0 176H800M0 202H800" />
        <path d="M200 0V40a40 40 0 0 0 40 40H800" />
      </g>
      <g className="stroke-brand-line">
        <path d="M80 0V240M106 0V240M132 0V240" />
        <path d="M560 0V70a40 40 0 0 0 40 40H800" />
      </g>
    </svg>
  )
}

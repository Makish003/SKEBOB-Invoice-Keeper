import { cn } from '@/lib/cn'

/**
 * Знак «Клавиша IK» (brand/README.md, ADR-025): клавиша Aéza, на ней I и K, у которой плечи образуют голубую галочку.
 * Геометрия из brand/svg/ik-symbol-small.svg (версия для 32 px и меньше), цвета через токены: в тёмной теме клавиша светлеет.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-fg', className)}>
      <svg viewBox="8 8 240 240" className="size-7 shrink-0" aria-hidden focusable="false">
        <rect x="8" y="8" width="240" height="240" rx="60" className="fill-brand-key" />
        <path d="M45.25 56H81.25V198H45.25Z" className="fill-brand-key-fg" />
        <path
          d="M97.25 144.04L185.29 56L210.75 81.46L148.16 144.04L176.67 172.54L151.21 198Z"
          className="fill-brand-accent"
        />
      </svg>
      <span className="font-display text-lg leading-none font-bold tracking-[-0.01em] whitespace-nowrap lowercase">
        Invoice Keeper
      </span>
    </span>
  )
}

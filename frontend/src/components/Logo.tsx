import { cn } from '@/lib/cn'

/** Знак в стиле Aéza: строчные буквы на «клавишах» (гайдбук, раздел «Логотип»), рядом название шрифтом Exo 2. */
const keys = ['i', 'k']

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-fg', className)}>
      <span className="flex gap-0.5" aria-hidden>
        {keys.map((key) => (
          <span
            key={key}
            className="flex size-7 items-center justify-center rounded-sm bg-brand-key pb-0.5 text-base leading-none font-bold text-brand-key-fg"
          >
            {key}
          </span>
        ))}
      </span>
      <span className="font-display text-base leading-none font-extrabold whitespace-nowrap uppercase">Invoice Keeper</span>
    </span>
  )
}

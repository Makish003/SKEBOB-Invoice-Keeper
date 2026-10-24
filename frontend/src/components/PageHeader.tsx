import type { ReactNode } from 'react'
import { BrandPattern, headerText, patternMetrics } from '@/components/BrandPattern'
import { cn } from '@/lib/cn'

interface PageHeaderProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
  /** Ключевые цифры раздела под описанием: число Exo 2 акцентным цветом и подпись. */
  stats?: { label: string; value: ReactNode }[]
  className?: string
}

/**
 * Шапка раздела на фирменной плитке (ADR-028): композиция стр. 22 гайдбука справа, текст и действия слева
 * над горизонталями. В светлой теме плитка светлая, в тёмной чёрная (токен brand-plate).
 */
export function PageHeader({ title, description, actions, stats, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'relative overflow-hidden rounded-xl bg-brand-plate text-fg ring-1 ring-subtle',
        'min-h-44 pt-6 pl-5 sm:pl-7 md:min-h-52 md:pt-7 md:pl-9',
        patternMetrics.header,
        className,
      )}
    >
      <BrandPattern variant="header" tone="plate" />
      <div className={cn('relative grid justify-items-start gap-4', headerText)}>
        <div className="grid gap-1.5">
          <h1 className="font-display text-3xl leading-none font-extrabold uppercase sm:text-4xl">{title}</h1>
          {description && <p className="hidden max-w-prose text-fg-secondary sm:block">{description}</p>}
        </div>
        {stats && (
          <dl className="flex flex-wrap gap-x-7 gap-y-2">
            {stats.map(({ label, value }) => (
              <div key={label} className="flex flex-col-reverse gap-1">
                <dt className="text-xs text-fg-secondary">{label}</dt>
                <dd className="font-display text-2xl leading-none font-extrabold text-link tabular">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto grid w-full max-w-[96rem] grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8', className)}>{children}</div>
}

import type { ReactNode } from 'react'
import { BrandPattern, headerRails, headerText, patternMetrics } from '@/components/BrandPattern'
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
 * Шапка раздела на фирменной плитке (ADR-028): композиция стр. 22 гайдбука справа, текст слева над горизонталями.
 * В светлой теме плитка светлая, в тёмной чёрная (токен brand-plate). Плитка: слой на строках 1-3 сетки:
 * текст, действия, место под горизонталями. Действия стоят на плитке, только когда она шире 48rem; на узкой
 * колонка текста слева от вертикалей не вмещает переключатель месяца, и действия уходят под плитку (строка 4).
 */
export function PageHeader({ title, description, actions, stats, className }: PageHeaderProps) {
  return (
    <header className={cn('@container grid grid-rows-[1fr_auto_auto_auto] text-fg', patternMetrics.header, className)}>
      <div className="relative col-start-1 row-span-3 row-start-1 min-h-44 overflow-hidden rounded-xl bg-brand-plate ring-1 ring-subtle md:min-h-52">
        <BrandPattern variant="header" tone="plate" />
      </div>
      <div className={cn('relative col-start-1 row-start-1 grid content-start justify-items-start gap-4 pt-6 pl-5 sm:pl-7 md:pt-7 md:pl-9', headerText)}>
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
      </div>
      {actions && (
        <div
          className={cn(
            'relative col-start-1 row-start-4 mt-3 flex flex-wrap items-center gap-2',
            '@3xl:row-start-2 @3xl:mt-4 @3xl:pr-[calc(100%-var(--x)+var(--p)*2)] @3xl:pl-9',
          )}
        >
          {actions}
        </div>
      )}
      <div aria-hidden className={cn('col-start-1 row-start-3', headerRails)} />
    </header>
  )
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto grid w-full max-w-[96rem] grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8', className)}>{children}</div>
}

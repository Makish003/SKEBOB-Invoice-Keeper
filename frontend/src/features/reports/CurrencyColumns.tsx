import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { type Currency, currencyNames } from '@/lib/format'

/** Три валюты в одной карточке, как колонки сводки: на телефоне друг под другом, шире в ряд через разделитель. */
export function CurrencyColumns({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div role={label ? 'group' : undefined} aria-label={label} className="grid divide-y divide-subtle border-t border-subtle md:grid-cols-3 md:divide-x md:divide-y-0">
      {children}
    </div>
  )
}

export function CurrencyColumn({ currency, label, children }: { currency: Currency; label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="grid content-start gap-4 p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">{currency}</h3>
        <span className="text-xs text-fg-tertiary">{currencyNames[currency]}</span>
      </div>
      {children}
    </section>
  )
}

/** Строка легенды: цветная точка, подпись, сумма. Цвет дублируется словом, не несёт смысл в одиночку. */
export function StatRow({ dot, label, children, className }: { dot: string; label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="flex items-center gap-1.5 text-fg-secondary">
        <span className={cn('size-2 rounded-full', dot)} aria-hidden />
        {label}
      </dt>
      <dd className={cn('font-medium tabular', className)}>{children}</dd>
    </div>
  )
}

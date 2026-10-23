import { ReceiptText } from 'lucide-react'
import { cn } from '@/lib/cn'

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight text-fg', className)}>
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-fg-on-action">
        <ReceiptText className="size-4" aria-hidden />
      </span>
      Invoice Keeper
    </span>
  )
}

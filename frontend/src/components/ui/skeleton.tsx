import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('animate-[ik-shimmer_1.4s_var(--ease-in-out)_infinite] rounded-md bg-sunken', className)}
      {...props}
    />
  )
}

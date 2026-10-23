import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export const fieldControl = cn(
  'h-10 w-full min-w-0 rounded-md border border-strong bg-raised px-3 text-sm text-fg',
  'placeholder:text-fg-tertiary transition-control outline-none',
  'hover:border-fg-tertiary focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring',
  'disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-60',
  'aria-invalid:border-danger aria-invalid:focus-visible:outline-danger',
)

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return <input type={type} className={cn(fieldControl, className)} {...props} />
}

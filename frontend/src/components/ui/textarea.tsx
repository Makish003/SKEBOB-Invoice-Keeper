import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'
import { fieldControl } from './input'

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(fieldControl, 'h-auto min-h-20 resize-y py-2 leading-normal', className)} {...props} />
}

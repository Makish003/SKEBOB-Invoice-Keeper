import { CircleAlert } from 'lucide-react'
import { Label as LabelPrimitive } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn('text-[0.8125rem] font-medium text-fg', className)} {...props} />
}

interface FieldProps {
  id: string
  label: string
  hint?: ReactNode
  error?: string
  children: ReactNode
  className?: string
}

/** Подпись + контрол + подсказка/ошибка. Ошибка связана с контролом через aria-describedby (у контрола). */
export function Field({ id, label, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-[0.8125rem] text-danger" role="alert">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[0.8125rem] text-fg-tertiary">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** aria-атрибуты контрола поля с ошибкой/подсказкой. */
export function fieldAria(id: string, error?: string, hint?: boolean) {
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const
}

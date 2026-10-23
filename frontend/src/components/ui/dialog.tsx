import { X } from 'lucide-react'
import { AlertDialog as AlertPrimitive, Dialog as DialogPrimitive } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Button, buttonVariants } from './button'

const overlay = 'fixed inset-0 z-50 bg-scrim data-[state=open]:animate-[ik-fade_var(--duration-base)_var(--ease-out)]'
const panel = cn(
  'fixed top-1/2 left-1/2 z-50 grid w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4',
  'max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-subtle bg-overlay p-5 text-fg shadow-overlay sm:p-6',
  'data-[state=open]:animate-[ik-pop_var(--duration-base)_var(--ease-out)]',
)

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

interface DialogContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  title: string
  description?: ReactNode
}

export function DialogContent({ title, description, className, children, ...props }: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlay} />
      <DialogPrimitive.Content className={cn(panel, className)} {...props}>
        <div className="grid gap-1 pr-8">
          <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="text-sm text-fg-secondary">{description}</DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          )}
        </div>
        {children}
        <DialogPrimitive.Close asChild>
          <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" aria-label="Закрыть">
            <X aria-hidden />
          </Button>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
}

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  loading?: boolean
  onConfirm: () => void
}

/** Подтверждение необратимого действия. Деструктивная кнопка того же варианта, что и триггер. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Отмена',
  destructive = false,
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertPrimitive.Portal>
        <AlertPrimitive.Overlay className={overlay} />
        <AlertPrimitive.Content className={panel}>
          <div className="grid gap-1.5">
            <AlertPrimitive.Title className="text-lg font-semibold tracking-tight">{title}</AlertPrimitive.Title>
            <AlertPrimitive.Description className="text-sm text-fg-secondary">{description}</AlertPrimitive.Description>
          </div>
          <DialogFooter>
            <AlertPrimitive.Cancel className={buttonVariants({ variant: 'secondary' })}>{cancelLabel}</AlertPrimitive.Cancel>
            <Button
              variant={destructive ? 'destructive' : 'primary'}
              loading={loading}
              onClick={(event) => {
                event.preventDefault()
                onConfirm()
              }}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </AlertPrimitive.Content>
      </AlertPrimitive.Portal>
    </AlertPrimitive.Root>
  )
}

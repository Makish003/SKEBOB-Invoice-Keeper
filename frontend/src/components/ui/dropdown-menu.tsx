import { DropdownMenu as MenuPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export const DropdownMenu = MenuPrimitive.Root
export const DropdownMenuTrigger = MenuPrimitive.Trigger

export function DropdownMenuContent({
  className,
  align = 'end',
  sideOffset = 4,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          'z-50 min-w-48 rounded-lg border border-subtle bg-overlay p-1 text-fg shadow-overlay',
          'data-[state=open]:animate-[ik-pop_var(--duration-fast)_var(--ease-out)]',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  )
}

interface ItemProps extends ComponentProps<typeof MenuPrimitive.Item> {
  destructive?: boolean
}

export function DropdownMenuItem({ className, destructive, ...props }: ItemProps) {
  return (
    <MenuPrimitive.Item
      className={cn(
        'icon-play flex h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm outline-none select-none [&_svg]:size-4',
        'data-[highlighted]:bg-secondary-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        destructive ? 'text-danger data-[highlighted]:bg-danger-bg' : 'text-fg',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn('my-1 h-px bg-subtle', className)} {...props} />
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cn('px-2.5 py-1.5 text-xs text-fg-tertiary', className)} {...props} />
}

import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { Slot } from 'radix-ui'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/** Варианты по смыслу: primary: одно главное действие, destructive: удаление/отмена везде одинаково. */
export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium select-none',
    'transition-control outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress active:scale-[0.98] motion-reduce:active:scale-100',
    // Любая кнопка, с иконкой и без, становится кейкапом (index.css, .ik-key): под курсором встаёт клавишей, при нажатии опускается.
    'icon-play ik-key [&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'ik-key-primary bg-primary font-semibold text-fg-on-action hover:bg-primary-hover active:bg-primary-active',
        secondary:
          'ik-key-ring border border-default bg-raised text-fg hover:border-strong hover:bg-secondary-hover active:bg-secondary-active',
        ghost: 'text-fg-secondary hover:bg-secondary-hover hover:text-fg active:bg-secondary-active',
        destructive: 'ik-key-destructive bg-destructive text-fg-on-destructive hover:bg-destructive-hover active:bg-destructive-hover',
        'destructive-ghost': 'ik-key-danger text-danger hover:bg-danger-bg active:bg-danger-bg',
      },
      size: {
        sm: 'h-8 px-3 text-[0.8125rem]',
        md: 'h-10 px-4 text-sm',
        icon: 'size-10',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  if (asChild) {
    return (
      <Slot.Root className={cn(buttonVariants({ variant, size }), className)} {...props}>
        {children}
      </Slot.Root>
    )
  }
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

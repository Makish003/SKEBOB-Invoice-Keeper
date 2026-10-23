import { Toaster as Sonner } from 'sonner'
import { useTheme } from '@/lib/theme'

export function Toaster() {
  const { resolved } = useTheme()
  return (
    <Sonner
      theme={resolved}
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: 'rounded-lg border border-subtle bg-overlay text-fg shadow-overlay',
          description: 'text-fg-secondary',
        },
      }}
    />
  )
}

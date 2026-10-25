import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, FileText, Paperclip, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, ApiError, unwrap } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Field, fieldAria } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/cn'
import { type Occurrence, occurrencesKey } from './api'

const ACCEPT = 'application/pdf,image/png,image/jpeg'
const MAX_MB = 5

export const receiptFileUrl = (id: number) => `/api/v1/payment-occurrences/${id}/receipt`

function errorText(error: unknown) {
  return error instanceof ApiError ? error.message : 'Не удалось сохранить. Попробуйте ещё раз'
}

async function uploadReceipt(id: number, file: File): Promise<Occurrence> {
  const body = new FormData()
  body.append('file', file)
  const response = await fetch(receiptFileUrl(id), { method: 'POST', body, credentials: 'include' })
  const data = await response.json().catch(() => undefined)
  if (!response.ok) throw new ApiError(response.status, data?.error)
  return data as Occurrence
}

/** Чек к конкретной оплате (FR-B8): ссылка или файл PDF/PNG/JPG до 5 МБ. */
export function ReceiptPopover({ occ }: { occ: Occurrence }) {
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState(occ.receipt_url ?? '')
  const [linkError, setLinkError] = useState<string>()
  const done = () => queryClient.invalidateQueries({ queryKey: occurrencesKey })

  const saveLink = useMutation({
    mutationFn: (url: string | null) =>
      unwrap(
        api.PATCH('/api/v1/payment-occurrences/{occurrence_id}', {
          params: { path: { occurrence_id: occ.id } },
          body: { receipt_url: url },
        }),
      ),
    onSuccess: (_data, url) => {
      void done()
      toast.success(url ? 'Ссылка на чек сохранена' : 'Ссылка на чек удалена')
    },
    onError: (error) =>
      setLinkError(error instanceof ApiError && error.status === 422 ? 'Нужна ссылка вида https://…' : errorText(error)),
  })
  const upload = useMutation({
    mutationFn: (file: File) => uploadReceipt(occ.id, file),
    onSuccess: (data) => {
      void done()
      toast.success('Чек прикреплён', { description: data.receipt_file_name ?? undefined })
    },
    onError: (error) => toast.error('Чек не прикреплён', { description: errorText(error) }),
  })
  const removeFile = useMutation({
    mutationFn: () =>
      unwrap(
        api.DELETE('/api/v1/payment-occurrences/{occurrence_id}/receipt', {
          params: { path: { occurrence_id: occ.id } },
        }),
      ),
    onSuccess: () => {
      void done()
      toast.success('Файл чека удалён')
    },
    onError: (error) => toast.error('Не удалось удалить файл', { description: errorText(error) }),
  })

  const hasReceipt = Boolean(occ.receipt_url || occ.receipt_file_name)
  const label = `Чек: ${occ.recurring_payment.name}`

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setLink(occ.receipt_url ?? '')
          setLinkError(undefined)
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={hasReceipt ? `${label} (прикреплён)` : label}
          className={cn(hasReceipt && 'text-link')}
        >
          <Paperclip aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" aria-label={label}>
        <div className="grid gap-4">
          <div className="grid gap-0.5">
            <p className="font-medium">Чек или ссылка</p>
            <p className="text-xs text-fg-tertiary">Подтверждение оплаты для этого периода</p>
          </div>

          <form
            noValidate
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setLinkError(undefined)
              saveLink.mutate(link.trim() || null)
            }}
          >
            <Field id={`receipt-url-${occ.id}`} label="Ссылка" error={linkError}>
              <Input
                {...fieldAria(`receipt-url-${occ.id}`, linkError)}
                type="url"
                inputMode="url"
                placeholder="https://bank.ru/receipt/…"
                value={link}
                onChange={(event) => setLink(event.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" variant="secondary" size="sm" loading={saveLink.isPending}>
                Сохранить ссылку
              </Button>
              {occ.receipt_url && (
                <Button asChild variant="ghost" size="sm">
                  <a href={occ.receipt_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink aria-hidden />
                    Открыть
                  </a>
                </Button>
              )}
            </div>
          </form>

          <div className="grid gap-2 border-t border-subtle pt-3">
            <span className="text-[0.8125rem] font-medium">Файл</span>
            {occ.receipt_file_name ? (
              <div className="flex items-center justify-between gap-2 rounded-md bg-sunken px-2.5 py-2">
                <a
                  href={receiptFileUrl(occ.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 items-center gap-2 text-link hover:underline"
                >
                  <FileText className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{occ.receipt_file_name}</span>
                </a>
                <Button
                  variant="destructive-ghost"
                  size="icon-sm"
                  aria-label="Удалить файл чека"
                  loading={removeFile.isPending}
                  onClick={() => removeFile.mutate()}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ) : (
              <p className="text-xs text-fg-tertiary">PDF, PNG или JPG до {MAX_MB} МБ</p>
            )}
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              aria-label="Выбрать файл чека"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                if (file.size > MAX_MB * 1024 * 1024) {
                  toast.error('Файл больше 5 МБ', { description: 'Сожмите файл или прикрепите ссылку' })
                  return
                }
                upload.mutate(file)
              }}
            />
            <Button variant="secondary" size="sm" loading={upload.isPending} onClick={() => fileInput.current?.click()}>
              <Upload aria-hidden />
              {occ.receipt_file_name ? 'Заменить файл' : 'Прикрепить файл'}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

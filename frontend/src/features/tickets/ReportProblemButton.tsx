import { MessageSquareWarning } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { useCurrentUser } from '@/features/auth/guards'
import type { Occurrence } from '@/features/occurrences/api'
import { CreateTicketDialog } from './CreateTicketDialog'

/** Заявка администратору прямо из карточки платежа: период уже приложен. Администратору не нужна, он и есть адресат. */
export function ReportProblemButton({ occ }: { occ: Occurrence }) {
  const user = useCurrentUser()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  if (user.role === 'admin') return null
  const label = `Сообщить о проблеме: ${occ.recurring_payment.name}`
  return (
    <>
      <Tooltip content="Сообщить администратору о проблеме">
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={() => setOpen(true)}>
          <MessageSquareWarning aria-hidden />
        </Button>
      </Tooltip>
      {open && (
        <CreateTicketDialog
          open={open}
          onOpenChange={setOpen}
          occurrence={occ}
          onCreated={(ticket) => navigate(`/tickets?ticket=${ticket.id}`)}
        />
      )}
    </>
  )
}

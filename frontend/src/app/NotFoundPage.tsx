import { Compass } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/states'

export function NotFoundPage() {
  return (
    <EmptyState
      className="min-h-[60dvh] justify-center"
      icon={<Compass aria-hidden />}
      title="Страница не найдена"
      description="Возможно, ссылка устарела. Вернитесь к сводке и выберите раздел в меню."
      action={
        <Button asChild variant="secondary" size="sm">
          <Link to="/">К сводке</Link>
        </Button>
      }
    />
  )
}

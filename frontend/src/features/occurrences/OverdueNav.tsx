import { TriangleAlert } from 'lucide-react'
import { AnimatePresence, motion, type Transition } from 'motion/react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { cn } from '@/lib/cn'
import { days, pluralize } from '@/lib/format'
import { spring, useReducedMotion } from '@/lib/motion'
import { type Occurrence, type OccurrenceList, useOccurrences } from './api'

const VISIBLE = 5
/** Срок истекает в полночь, а не по действию пользователя: список переспрашиваем раз в минуту. */
const POLL_MS = 60_000
/** Через сколько после входа на сайт просрочка раскрывается из «Платежей». */
const REVEAL_DELAY_MS = 2000
/** Раскрыто один раз до перезагрузки страницы: мобильное меню монтирует список заново и не должно ждать снова. */
let revealedThisLoad = false

/** id → «просрочка появилась после первой загрузки». */
type Known = Map<number, boolean>

/** Первую загрузку не подсвечиваем; ушедший и вернувшийся (сняли отметку об оплате) платёж снова новый. */
function track(prev: Known | null, items: Occurrence[]): Known {
  const ids = new Set(items.map((occ) => occ.id))
  const next: Known = new Map([...(prev ?? [])].filter(([id]) => ids.has(id)))
  for (const id of ids) if (!next.has(id)) next.set(id, prev !== null)
  return next
}

export const overdueHref = (id?: number) => `/payments?tab=overdue${id ? `&focus=${id}` : ''}`

/**
 * Просроченные платежи подстрокой под «Платежами». Через пару секунд после входа выезжают каскадом из-под
 * пункта «Платежи» и остаются открытыми до перезагрузки; платёж, просроченный уже при открытой странице,
 * въезжает сбоку с подсветкой. Скрыть список нельзя: он уходит с последней просрочкой.
 * Пункты меню ниже сдвигаются через layout-анимацию (transform), см. LayoutGroup в Shell.
 */
export function OverdueNav({ onNavigate }: { onNavigate?: () => void }) {
  const overdue = useOccurrences({ status: 'unpaid', overdue: true, sort: 'due_date', limit: VISIBLE }, { refetchInterval: POLL_MS })
  const reduce = useReducedMotion()
  const location = useLocation()
  const focused = location.pathname === '/payments' ? new URLSearchParams(location.search).get('focus') : null
  const items = overdue.data?.items ?? []
  const rest = (overdue.data?.total ?? 0) - items.length
  // Пересчёт «новых» при каждом ответе сервера (паттерн «состояние по смене данных», без эффекта).
  const [seen, setSeen] = useState<{ data?: OccurrenceList; known: Known | null }>({ known: null })
  if (overdue.data && overdue.data !== seen.data) setSeen({ data: overdue.data, known: track(seen.known, items) })
  const fresh = (id: number) => seen.known?.get(id) ?? false

  const [revealed, setRevealed] = useState(revealedThisLoad)
  useEffect(() => {
    if (revealed) return
    const timer = setTimeout(() => {
      revealedThisLoad = true
      setRevealed(true)
    }, REVEAL_DELAY_MS)
    return () => clearTimeout(timer)
  }, [revealed])

  const move: Transition = reduce ? { duration: 0 } : spring
  // Раскрытие: пункт выезжает из-под «Платежей» (чем ниже, тем длиннее путь). Новая просрочка: сбоку.
  const unfold = (index: number) => (reduce ? { opacity: 0 } : { opacity: 0, y: -24 * (index + 1), scale: 0.96 })
  const enter = reduce ? { opacity: 0 } : { opacity: 0, x: -8 }

  return (
    <AnimatePresence mode="popLayout">
      {revealed && items.length > 0 && (
        <motion.div key="overdue" layout="position" transition={move} exit={{ opacity: 0 }} className="ml-9 grid gap-0.5 pb-1">
          <ul aria-label="Просроченные платежи" className="grid gap-0.5">
            <AnimatePresence mode="popLayout">
              {items.map((occ, index) => (
                <motion.li
                  key={occ.id}
                  layout="position"
                  initial={fresh(occ.id) ? enter : unfold(index)}
                  animate={{ opacity: 1, x: 0, y: 0, scale: 1, transition: reduce ? { duration: 0 } : { ...spring, delay: index * 0.07 } }}
                  exit={{ ...enter, transition: { duration: reduce ? 0 : 0.15 } }}
                  transition={move}
                >
                  <Link
                    to={overdueHref(occ.id)}
                    onClick={onNavigate}
                    aria-current={focused === String(occ.id) ? 'true' : undefined}
                    className={cn(
                      'relative grid min-h-[4.5rem] content-center gap-0.5 overflow-hidden rounded-md px-2.5 py-3 transition-control outline-none',
                      'bg-danger-bg/50 hover:bg-danger-bg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                      'aria-[current=true]:bg-danger-bg aria-[current=true]:ring-1 aria-[current=true]:ring-danger/40',
                    )}
                  >
                    {fresh(occ.id) && !reduce && (
                      <motion.span
                        className="pointer-events-none absolute inset-0 bg-danger/25"
                        initial={{ opacity: 1 }}
                        animate={{ opacity: 0 }}
                        transition={{ duration: 1.6, ease: 'easeOut', delay: 0.2 }}
                        aria-hidden
                      />
                    )}
                    <span className="relative truncate text-sm leading-6 font-medium text-fg">{occ.recurring_payment.name}</span>
                    <span className="relative flex items-center gap-1.5 text-xs leading-5 text-danger">
                      <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                      Просрочен на {days(occ.overdue_days)}
                    </span>
                  </Link>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          {rest > 0 && (
            <Link
              to={overdueHref()}
              onClick={onNavigate}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-danger transition-control outline-none hover:bg-danger-bg focus-visible:outline-2 focus-visible:outline-ring"
            >
              Ещё {rest} {pluralize(rest, { one: 'просроченный', few: 'просроченных', many: 'просроченных' })}
            </Link>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

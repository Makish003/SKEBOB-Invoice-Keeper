import { startOfMonth } from 'date-fns'
import { useState } from 'react'
import { MonthSwitcher } from '@/components/MonthSwitcher'
import { Page, PageHeader } from '@/components/PageHeader'
import { useAppInfo } from '@/features/app-info'
import { AsOfCard } from './AsOfCard'
import { BudgetCard } from './BudgetCard'

/** Отчёты: план против факта по бюджету и итоги на произвольную дату. Сводка остаётся рабочим экраном «что платить». */
export function ReportsPage() {
  const { today } = useAppInfo()
  const [month, setMonth] = useState<Date | null>(null)
  const current = month ?? startOfMonth(today)
  return (
    <Page>
      <PageHeader
        title="Отчёты"
        description="Бюджет против запланированных платежей и итоги на любую дату. Валюты не смешиваются."
        actions={<MonthSwitcher month={current} onChange={(d) => setMonth(startOfMonth(d))} today={today} />}
      />
      <BudgetCard year={current.getFullYear()} month={current.getMonth() + 1} />
      <AsOfCard />
    </Page>
  )
}

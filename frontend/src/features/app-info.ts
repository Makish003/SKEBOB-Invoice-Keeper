import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api, unwrap } from '@/api/client'
import { fromIsoDate, toIsoDate } from '@/lib/format'

const browserToday = toIsoDate(new Date())

/** «Сегодня» берётся с сервера (часовой пояс приложения, CLOCK_OVERRIDE), а не из часов браузера. */
export function useAppInfo() {
  const query = useQuery({
    queryKey: ['app-info'],
    queryFn: () => unwrap(api.GET('/api/v1/app-info')),
    staleTime: 5 * 60_000,
  })
  const todayIso = query.data?.today ?? browserToday
  const today = useMemo(() => fromIsoDate(todayIso), [todayIso])
  return { ...query, todayIso, today, reminderDays: query.data?.reminder_days_before ?? 3 }
}

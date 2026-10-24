/** Форматирование денег и дат для ru-RU (F-09). Деньги приходят строкой: число используется только для отображения. */
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'

export type Currency = 'RUB' | 'USD' | 'EUR'

const moneyFormatters = new Map<string, Intl.NumberFormat>()

export function formatMoney(amount: string | number, currency: Currency): string {
  let formatter = moneyFormatters.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat('ru-RU', { style: 'currency', currency, minimumFractionDigits: 2 })
    moneyFormatters.set(currency, formatter)
  }
  return formatter.format(typeof amount === 'string' ? Number(amount) : amount)
}

const compactFormatters = new Map<string, Intl.NumberFormat>()

/** Короткая сумма для тесных мест (ячейка календаря): «85 тыс. ₽», «1,5 млн ₽», «49,9 $». Точная сумма — рядом. */
export function formatMoneyCompact(amount: string | number, currency: Currency): string {
  let formatter = compactFormatters.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat('ru-RU', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 })
    compactFormatters.set(currency, formatter)
  }
  return formatter.format(typeof amount === 'string' ? Number(amount) : amount)
}

export const currencyNames: Record<Currency, string> = {
  RUB: 'Российский рубль',
  USD: 'Доллар США',
  EUR: 'Евро',
}

/** "2026-10-23" -> "23.10.2026" */
export function formatDate(iso: string): string {
  return format(parseISO(iso), 'dd.MM.yyyy')
}

/** "2026-10-23" -> "23 октября" (или с годом, если он не текущий) */
export function formatDateLong(iso: string, today: Date = new Date()): string {
  const date = parseISO(iso)
  return format(date, date.getFullYear() === today.getFullYear() ? 'd MMMM' : 'd MMMM yyyy', { locale: ru })
}

export function formatDateTime(iso: string): string {
  return format(new Date(iso), 'dd.MM.yyyy HH:mm')
}

/** Дата в формате API (YYYY-MM-DD) в локальном времени, без сдвига часового пояса. */
export function toIsoDate(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function fromIsoDate(iso: string): Date {
  return parseISO(iso)
}

const plural = new Intl.PluralRules('ru-RU')

export function pluralize(count: number, forms: { one: string; few: string; many: string }): string {
  const rule = plural.select(count)
  return rule === 'one' ? forms.one : rule === 'few' ? forms.few : forms.many
}

export function days(count: number): string {
  return `${count} ${pluralize(count, { one: 'день', few: 'дня', many: 'дней' })}`
}

/** Относительный срок: "сегодня", "завтра", "через 3 дня", "вчера", "3 дня назад". */
export function relativeDue(daysUntilDue: number): string {
  if (daysUntilDue === 0) return 'сегодня'
  if (daysUntilDue === 1) return 'завтра'
  if (daysUntilDue === -1) return 'вчера'
  return daysUntilDue > 0 ? `через ${days(daysUntilDue)}` : `${days(-daysUntilDue)} назад`
}

export function daysBetween(fromIso: string, toIso: string): number {
  return differenceInCalendarDays(parseISO(toIso), parseISO(fromIso))
}

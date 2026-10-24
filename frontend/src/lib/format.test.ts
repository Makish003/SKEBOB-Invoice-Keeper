import { describe, expect, it } from 'vitest'
import { days, daysBetween, formatDate, formatMoney, formatMoneyCompact, pluralize, relativeDue } from './format'
import { formatAmountInput, parseAmount, sanitizeAmountInput } from './money-input'

const nbsp = (s: string) => s.replace(/[  ]/g, ' ')

describe('format', () => {
  it('деньги — по-русски, два знака, валюта', () => {
    expect(nbsp(formatMoney('85000.00', 'RUB'))).toBe('85 000,00 ₽')
    expect(nbsp(formatMoney('49.9', 'USD'))).toBe('49,90 $')
  })

  it('короткая сумма для ячейки календаря', () => {
    expect(nbsp(formatMoneyCompact('85000.00', 'RUB'))).toBe('85 тыс. ₽')
    expect(nbsp(formatMoneyCompact('1214550', 'RUB'))).toBe('1,2 млн ₽')
    expect(nbsp(formatMoneyCompact('49.9', 'USD'))).toBe('49,9 $')
  })

  it('склонение', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map(days)).toEqual(['1 день', '2 дня', '5 дней', '11 дней', '21 день', '22 дня', '25 дней'])
    expect(pluralize(3, { one: 'платёж', few: 'платежа', many: 'платежей' })).toBe('платежа')
  })

  it('относительный срок', () => {
    expect([0, 1, -1, 3, -41].map(relativeDue)).toEqual(['сегодня', 'завтра', 'вчера', 'через 3 дня', '41 день назад'])
  })

  it('даты без сдвига часового пояса', () => {
    expect(formatDate('2026-02-28')).toBe('28.02.2026')
    expect(daysBetween('2026-10-20', '2026-10-23')).toBe(3)
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2) // переход на летнее время в Европе
  })
})

describe('money-input', () => {
  it('принимает привычные записи суммы', () => {
    expect(parseAmount('85 000,5')).toBe('85000.50')
    expect(parseAmount('85000.50')).toBe('85000.50')
    expect(parseAmount('007')).toBe('7.00')
  })

  it('отклоняет то, что не является суммой', () => {
    for (const bad of ['', 'abc', '1,234', '1.2.3', '-5', '1234567890123']) expect(parseAmount(bad)).toBeNull()
  })

  it('чистит ввод и красиво форматирует', () => {
    expect(sanitizeAmountInput('12a3.456')).toBe('123,45')
    expect(nbsp(formatAmountInput('85000,5'))).toBe('85 000,50')
  })
})

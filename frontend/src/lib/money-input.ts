/** Ввод суммы: «85 000,50» / «85000.5» -> "85000.50". Возвращает null, если ввод не похож на сумму. */
export function parseAmount(raw: string): string | null {
  const cleaned = raw.replace(/[\s  ]/g, '').replace(',', '.')
  if (!/^\d{1,12}(\.\d{0,2})?$/.test(cleaned)) return null
  const [whole, fraction = ''] = cleaned.split('.')
  return `${String(Number(whole))}.${fraction.padEnd(2, '0')}`
}

/** Оставляет только цифры и один десятичный разделитель (не больше двух знаков после него). */
export function sanitizeAmountInput(raw: string): string {
  const normalized = raw.replace(/\./g, ',').replace(/[^\d,\s ]/g, '')
  const [whole, ...rest] = normalized.split(',')
  return rest.length ? `${whole},${rest.join('').slice(0, 2)}` : whole
}

/** Красивое отображение после ввода: «85 000,00». */
export function formatAmountInput(raw: string): string {
  const value = parseAmount(raw)
  if (value === null) return raw
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))
}

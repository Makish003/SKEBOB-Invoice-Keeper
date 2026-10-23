import type { APIRequestContext } from '@playwright/test'

export async function apiLogin(request: APIRequestContext, who: { login: string; password: string }): Promise<string> {
  const response = await request.post('/api/v1/auth/login', { data: who })
  if (!response.ok()) throw new Error(`login failed: ${response.status()}`)
  return (await response.json()).access_token as string
}

export function isoFromToday(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export async function createPayment(
  request: APIRequestContext,
  token: string,
  p: { name: string; amount: string; currency: 'RUB' | 'USD' | 'EUR'; daysFromToday: number },
) {
  const response = await request.post('/api/v1/recurring-payments', {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: p.name, amount: p.amount, currency: p.currency, first_due_date: isoFromToday(p.daysFromToday) },
  })
  if (response.status() !== 201) throw new Error(`create failed: ${response.status()} ${await response.text()}`)
  return response.json()
}

export async function deletePayment(request: APIRequestContext, token: string, id: number) {
  await request.delete(`/api/v1/recurring-payments/${id}`, { headers: { Authorization: `Bearer ${token}` } })
}

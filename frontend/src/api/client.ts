import createClient, { type Middleware } from 'openapi-fetch'
import type { components, paths } from './schema'

export type Schemas = components['schemas']
export type ErrorBody = Schemas['ErrorBody']

/** Ошибка API в едином формате бэкенда: {"error": {code, message, details}}. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, body: Partial<ErrorBody> | undefined) {
    super(body?.message ?? 'Сервер не ответил. Проверьте подключение и попробуйте ещё раз')
    this.status = status
    this.code = body?.code ?? 'network_error'
    this.details = body?.details
  }
}

type UnauthorizedListener = () => void
const unauthorizedListeners = new Set<UnauthorizedListener>()

/** Подписка на «сессия истекла» (401 на любом запросе, кроме входа). */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener)
  return () => unauthorizedListeners.delete(listener)
}

const unauthorizedMiddleware: Middleware = {
  onResponse({ response, schemaPath }) {
    if (response.status === 401 && schemaPath !== '/api/v1/auth/login') {
      unauthorizedListeners.forEach((listener) => listener())
    }
    return undefined
  },
}

export const api = createClient<paths>({ baseUrl: '', credentials: 'include' })
api.use(unauthorizedMiddleware)

type Result<T> = { data?: T; error?: unknown; response: Response }

/** Возвращает data или бросает ApiError — для TanStack Query. */
export async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  let result: Result<T>
  try {
    result = await promise
  } catch {
    throw new ApiError(0, undefined)
  }
  if (!result.response.ok) {
    const body = (result.error as { error?: ErrorBody } | undefined)?.error
    throw new ApiError(result.response.status, body)
  }
  return result.data as T
}

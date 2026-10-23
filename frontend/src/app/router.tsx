import { lazy } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router'

const ShowcasePage = lazy(() =>
  import('@/features/showcase/ShowcasePage').then((m) => ({ default: m.ShowcasePage })),
)

function Placeholder() {
  return (
    <main>
      <h1>Invoice Keeper</h1>
      <p>Панель напоминаний о регулярных платежах.</p>
    </main>
  )
}

const devRoutes: RouteObject[] = import.meta.env.DEV ? [{ path: '/_ui', element: <ShowcasePage /> }] : []

export const router = createBrowserRouter([...devRoutes, { path: '*', element: <Placeholder /> }])

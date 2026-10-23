import { lazy } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router'
import { AuditPage } from '@/features/audit/AuditPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { RequireAdmin, RequireAuth } from '@/features/auth/guards'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { PaymentsPage } from '@/features/occurrences/PaymentsPage'
import { RecurringPage } from '@/features/recurring/RecurringPage'
import { UsersPage } from '@/features/users/UsersPage'
import { NotFoundPage } from './NotFoundPage'
import { RouteErrorPage } from './RouteErrorPage'
import { Shell } from './Shell'

const ShowcasePage = lazy(() =>
  import('@/features/showcase/ShowcasePage').then((m) => ({ default: m.ShowcasePage })),
)

const devRoutes: RouteObject[] = import.meta.env.DEV ? [{ path: '/_ui', element: <ShowcasePage /> }] : []

export const router = createBrowserRouter([
  ...devRoutes,
  { path: '/login', element: <LoginPage />, errorElement: <RouteErrorPage /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <Shell />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'payments', element: <PaymentsPage /> },
          {
            element: <RequireAdmin />,
            children: [
              { path: 'recurring', element: <RecurringPage /> },
              { path: 'users', element: <UsersPage /> },
              { path: 'audit', element: <AuditPage /> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])

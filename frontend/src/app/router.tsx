import { createBrowserRouter } from 'react-router'

function Placeholder() {
  return (
    <main>
      <h1>Invoice Keeper</h1>
      <p>Панель напоминаний о регулярных платежах.</p>
    </main>
  )
}

export const router = createBrowserRouter([{ path: '*', element: <Placeholder /> }])

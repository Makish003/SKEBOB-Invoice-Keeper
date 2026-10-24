import { expect, test } from '@playwright/test'
import { ADMIN, signIn } from './helpers'

// Шапка раздела — плитка с паттерном (ADR-028): заголовок, описание, цифры и действия не должны
// заходить на вертикальные линии ни на телефоне, ни на десктопе.
test('шапка раздела: текст и действия не пересекают линии паттерна @mobile', async ({ page }) => {
  test.setTimeout(60_000) // семь разделов подряд
  await signIn(page, ADMIN)
  for (const path of ['/', '/payments', '/calendar', '/reports', '/recurring', '/users', '/audit']) {
    await page.goto(path)
    const header = page.locator('main header').first()
    await expect(header.getByRole('heading', { level: 1 })).toBeVisible()
    const overlaps = await header.evaluate((root) => {
      const rects = (selector: string) =>
        [...root.querySelectorAll(selector)].map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.width > 0)
      const posts = rects('[data-line="post"]')
      return rects('h1, p, dl, button, a')
        .filter(({ r }) => posts.some(({ r: p }) => r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top))
        .map(({ el }) => el.textContent?.trim() || el.tagName)
    })
    expect(overlaps, `${path}: заходят на линии`).toEqual([])
  }
})

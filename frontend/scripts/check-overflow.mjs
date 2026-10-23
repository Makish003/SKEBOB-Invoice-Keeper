// Проверка отсутствия горизонтального скролла на узких экранах: node scripts/check-overflow.mjs <url> [widths...]
import { chromium } from '@playwright/test'

const [url, ...rest] = process.argv.slice(2)
const widths = rest.length ? rest.map(Number) : [320, 360, 414, 768, 1280]
const browser = await chromium.launch()
let failed = false
for (const width of widths) {
  const page = await browser.newPage({ viewport: { width, height: 800 } })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.locator('h1').first().waitFor({ timeout: 15000 })
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth)
  const ok = scroll <= width
  failed ||= !ok
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${width}px: scrollWidth=${scroll}`)
  await page.close()
}
await browser.close()
process.exit(failed ? 1 : 0)

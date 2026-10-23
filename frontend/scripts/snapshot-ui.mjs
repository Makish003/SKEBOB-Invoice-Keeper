// Статический снимок страницы SPA для рендер-гейтов ux-ui-agent-skills (они открывают file://).
// node scripts/snapshot-ui.mjs <url> <out.html>
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium } from '@playwright/test'

const [url = 'http://localhost:5173/_ui', out = '../.tmp/ui/showcase.html'] = process.argv.slice(2)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('pageerror', (error) => console.error('pageerror:', error.message))
page.on('console', (msg) => msg.type() === 'error' && console.error('console:', msg.text()))
await page.goto(url, { waitUntil: 'networkidle' })
await page.locator('h1').first().waitFor({ timeout: 15000 })
await page.waitForTimeout(300)
const html = await page.evaluate(() => {
  const css = Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join('\n')
      } catch {
        return ''
      }
    })
    .join('\n')
  const body = document.body.cloneNode(true)
  body.querySelectorAll('script').forEach((node) => node.remove())
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>snapshot</title><style>${css}</style></head>${body.outerHTML}</html>`
})
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, html)
await browser.close()
console.log(`snapshot ${url} -> ${out} (${html.length} bytes)`)

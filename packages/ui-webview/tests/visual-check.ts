/**
 * Computed-style verification (not part of the test suite): boots the e2e
 * services, opens the panel with a pick, and dumps the resolved token styles
 * of every key surface in light and dark theme. Run with:
 *   pnpm exec tsx packages/ui-webview/tests/visual-check.ts
 */
import { chromium, clickWhenStable, connectWorkspace, newPage, startServices } from './e2e-scaffold.ts'

const services = await startServices()
const browser = await chromium.launch()
try {
  const page = await newPage(browser)
  await page.goto(services.webUrl)
  await connectWorkspace(page, services.workspaceRoot, 'check')
  await clickWhenStable(page, page.getByRole('button', { name: 'Web preview' }))
  const urlInput = page.getByPlaceholder('Enter a URL and press Enter (e.g. http://localhost:5173)')
  await urlInput.waitFor({ timeout: 15_000 })
  await urlInput.fill(services.demoUrl)
  await urlInput.press('Enter')
  const frame = page.frameLocator('iframe.wv-frame')
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pick element' }).click()
  await page.waitForTimeout(300)
  const armedChip = await page.evaluate(() => {
    const el = document.querySelector('.wv-chip-pick[aria-pressed="true"]')
    if (el === null) return 'NOT ARMED'
    const cs = getComputedStyle(el)
    return `armed | bg:${cs.backgroundColor} | color:${cs.color}`
  })
  console.log(armedChip)
  await frame.locator('button.btn-primary').click()
  await page.locator('.wv-pick').waitFor({ timeout: 10_000 })
  await page.locator('.wv-pick textarea.wv-comment').fill('darker please')

  const light = await page.evaluate(() => {
    const sels = [
      '.wv-toggle', '.wv-title', '.wv-url', '.wv-seg', '.wv-chip[aria-pressed="true"]',
      '.wv-chip-pick[aria-pressed="true"]', '.wv-hint', '.wv-frame-wrap', '.wv-annotations-label',
      '.wv-annotations-count', '.wv-pick', '.wv-pick-index', '.wv-pick-selector',
      '.wv-pick-snippet', '.wv-comment', '.wv-send',
    ]
    const rows: string[] = []
    for (const sel of sels) {
      const el = document.querySelector(sel)
      if (el === null) continue
      const cs = getComputedStyle(el)
      rows.push(`${sel} | bg:${cs.backgroundColor} | color:${cs.color} | borderTop:${cs.borderTopColor} | font:${cs.fontSize}/${cs.lineHeight}/${cs.fontWeight} | radius:${cs.borderTopLeftRadius}`)
    }
    const panel = document.querySelector('.wv-panel')
    if (panel !== null) {
      const box = panel.getBoundingClientRect()
      rows.push(`.wv-panel | rect ${Math.round(box.width)}x${Math.round(box.height)} @ (${Math.round(box.left)},${Math.round(box.top)})`)
      const cs = getComputedStyle(panel)
      rows.push(`.wv-panel | shadow:${cs.boxShadow}`)
      rows.push(`.wv-panel | --dsh-scrollbar-thumb:${cs.getPropertyValue('--dsh-scrollbar-thumb').trim()}`)
    }
    const split = document.querySelector('.wv-split')
    if (split !== null) rows.push(`.wv-split | h:${split.getBoundingClientRect().height}`)
    return rows.join('\n')
  })
  console.log('=== light ===')
  console.log(light)

  // Dark theme: force the attribute the theme service sets.
  await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
  await page.waitForTimeout(300)
  const dark = await page.evaluate(() => {
    const sels = [
      '.wv-panel', '.wv-title', '.wv-url', '.wv-pick', '.wv-pick-snippet',
      '.wv-comment', '.wv-send', '.wv-chip-pick[aria-pressed="true"]',
    ]
    const rows: string[] = []
    for (const sel of sels) {
      const el = document.querySelector(sel)
      if (el === null) continue
      const cs = getComputedStyle(el)
      rows.push(`${sel} | bg:${cs.backgroundColor} | color:${cs.color} | borderTop:${cs.borderTopColor}`)
    }
    return rows.join('\n')
  })
  console.log('=== dark ===')
  console.log(dark)
  await page.close()
} finally {
  await browser.close()
  await services.stop()
}

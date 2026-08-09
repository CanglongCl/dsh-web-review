/**
 * Computed-style verification (not part of the test suite): boots the e2e
 * services, annotates two elements, and dumps the resolved token styles of
 * the new surfaces (capsule, detail card, armed pick button, iframe markers) in
 * light and dark theme. Run with:
 *   pnpm exec tsx packages/ui-webview/tests/visual-check.ts
 */
import { chromium, clickWhenStable, connectWorkspace, newPage, startServices } from './e2e-scaffold.ts'

const services = await startServices()
const browser = await chromium.launch()
try {
  const page = await newPage(browser)
  await page.goto(services.webUrl)
  await connectWorkspace(page, services.workspaceRoot, 'check')
  await clickWhenStable(page, page.getByRole('tab', { name: 'Preview' }))
  const urlInput = page.getByPlaceholder('Enter a URL and press Enter (e.g. http://localhost:5173)')
  await urlInput.waitFor({ timeout: 15_000 })
  await urlInput.fill(services.demoUrl)
  await urlInput.press('Enter')
  const frame = page.frameLocator('iframe[title="Web preview"]')
  await page.waitForTimeout(1500)

  // Arm pick mode: capture the armed icon button style, then annotate twice.
  await page.getByRole('button', { name: 'Pick element' }).click()
  await frame.locator('button.btn-primary').click()
  const input = frame.locator('.dsh-wv-comment-input')
  await input.waitFor({ timeout: 10_000 })

  // While the comment field is open, the picked element keeps its outline.
  const selected = await frame.locator('button.btn-primary').evaluate((el) => {
    const cs = getComputedStyle(el)
    return `selected outline: ${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor} offset:${cs.outlineOffset}`
  })
  console.log(selected)

  await input.fill('darker')
  await input.press('Enter')
  await frame.locator('.card:nth-of-type(2) button').click()
  const input2 = frame.locator('.dsh-wv-comment-input')
  await input2.waitFor({ timeout: 10_000 })
  await input2.fill('spacing')
  await input2.press('Enter')
  const capsule = page.locator('[data-webview-annotation-capsule]')
  await capsule.waitFor({ timeout: 10_000 })
  await capsule.hover()
  await page.locator('[data-webview-annotation-row]').nth(1).waitFor({ timeout: 10_000 })

  const dump = async (): Promise<string> => {
    const rows: string[] = []
    const sels = [
      '[data-webview-annotation-capsule]',
      '[data-webview-annotation-details]',
      '[data-webview-annotation-row]',
    ]
    for (const sel of sels) {
      const el = document.querySelector(sel)
      if (el === null) continue
      const cs = getComputedStyle(el)
      rows.push(`${sel} | bg:${cs.backgroundColor} | color:${cs.color} | borderTop:${cs.borderTopColor} | font:${cs.fontSize}/${cs.lineHeight}/${cs.fontWeight} | radius:${cs.borderTopLeftRadius}`)
    }
    const pickBtn = document.querySelector('[aria-label="Stop picking"]')
    if (pickBtn !== null) {
      const cs = getComputedStyle(pickBtn)
      rows.push(`[aria-label="Stop picking"] | bg:${cs.backgroundColor} | color:${cs.color}`)
    }
    const panel = document.querySelector('[data-webview-panel]')
    if (panel !== null) {
      const box = panel.getBoundingClientRect()
      rows.push(`[data-webview-panel] | rect ${Math.round(box.width)}x${Math.round(box.height)} @ (${Math.round(box.left)},${Math.round(box.top)})`)
    }
    return rows.join('\n')
  }
  const panelDump = await page.evaluate(dump)
  console.log('=== light ===')
  console.log(panelDump)

  const markerDump = await frame.locator('.dsh-wv-marker').evaluateAll((markers) => {
    const rows: string[] = []
    rows.push(`marker count: ${markers.length}`)
    markers.forEach((m, i) => {
      const cs = getComputedStyle(m)
      const r = m.getBoundingClientRect()
      rows.push(`marker[${i}] text:${m.textContent} bg:${cs.backgroundColor} color:${cs.color} size:${Math.round(r.width)}x${Math.round(r.height)} pos:(${Math.round(r.left)},${Math.round(r.top)})`)
    })
    return rows.join('\n')
  })
  console.log(markerDump)

  await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
  await page.waitForTimeout(300)
  const dark = await page.evaluate(dump)
  console.log('=== dark ===')
  console.log(dark)
  await page.close()
} finally {
  await browser.close()
  await services.stop()
}

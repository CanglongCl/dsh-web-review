/**
 * Visual-verification helper (not part of the test suite): boots the e2e
 * services, opens the Preview tab against the demo page, annotates two
 * elements, and saves screenshots into .artifacts/ui/. Run with:
 *   pnpm exec tsx packages/dsh-web-review/tests/visual-shot.ts
 */
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import {
  chromium,
  clickWhenStable,
  connectWorkspace,
  newPage,
  startServices,
  type E2EServices,
  REPO_ROOT,
} from './e2e-scaffold.ts'

async function shot(page: import('playwright').Page, name: string): Promise<void> {
  const dir = join(REPO_ROOT, '.artifacts', 'ui')
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: join(dir, `${name}.png`) })
  console.log(`saved .artifacts/ui/${name}.png`)
}

const services: E2EServices = await startServices()
const browser = await chromium.launch()
try {
  const page = await newPage(browser)
  await page.goto(services.webUrl)
  await connectWorkspace(page, services.workspaceRoot, 'visual')
  await clickWhenStable(page, page.getByRole('tab', { name: 'Web Preview' }))
  const urlInput = page.getByPlaceholder('Enter a URL and press Enter (e.g. http://localhost:5173)')
  await urlInput.waitFor({ timeout: 15_000 })
  await shot(page, 'panel-open-empty')

  await urlInput.fill(services.demoUrl)
  await urlInput.press('Enter')
  const frame = page.frameLocator('iframe[title="Web preview"]')
  await page.waitForFunction(
    (expected) => (document.querySelector('iframe[title="Web preview"]') as HTMLIFrameElement | null)
      ?.contentDocument?.title.startsWith(expected) ?? false,
    '魔法 UI',
    { timeout: 20_000 },
  ).catch(() => {})
  await page.waitForTimeout(500)
  await shot(page, 'panel-with-page')

  // Floating comment field open over the first element.
  await page.getByRole('button', { name: 'Add page comments' }).click()
  await frame.locator('button.btn-primary').click()
  const commentInput = page.locator('[data-webview-annotation-editor] .dsh-wv-comment-input')
  await commentInput.waitFor({ timeout: 10_000 })
  await commentInput.fill('Make the button color darker and increase spacing.')
  await shot(page, 'panel-comment-open')
  await page.locator('[data-webview-annotation-editor]').getByRole('button', { name: 'Select', exact: true }).click()
  await page.locator('[data-webview-element-selector]').waitFor()
  await shot(page, 'panel-element-selector-open')
  await page.locator('[data-webview-annotation-editor]').getByRole('button', { name: 'Select', exact: true }).click()
  await page.locator('[data-webview-annotation-editor]').getByRole('button', { name: 'Adjust' }).click()
  await shot(page, 'panel-property-editor-open')
  const widthPreset = page.locator('[data-webview-annotation-editor]').getByRole('button', { name: 'Width · Choose preset', exact: true })
  await widthPreset.click()
  await shot(page, 'panel-property-editor-keyword-menu')
  await page.keyboard.press('Escape')
  await page.locator('[data-webview-annotation-editor]').getByRole('button', { name: 'Effects' }).click()
  await page.locator('[data-webview-property-inspector]').evaluate(element => { element.scrollTop = element.scrollHeight })
  await shot(page, 'panel-property-editor-effects')
  await page.locator('[data-webview-property-inspector]').evaluate(element => { element.scrollTop = 0 })
  await page.setViewportSize({ width: 597, height: 835 })
  await shot(page, 'panel-property-editor-narrow')
  await widthPreset.click()
  await shot(page, 'panel-property-editor-keyword-menu-narrow')
  await page.keyboard.press('Escape')
  await page.locator('[data-webview-annotation-editor]').getByRole('button', { name: 'Text color' }).click()
  const colorDialog = page.getByRole('dialog', { name: 'Text color · 颜色选择器' })
  await colorDialog.waitFor()
  const geometry = await colorDialog.evaluate((dialog) => {
    const outer = dialog.getBoundingClientRect()
    const fields = [...dialog.querySelectorAll('input')].map(field => field.getBoundingClientRect())
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      outer: { left: outer.left, top: outer.top, right: outer.right, bottom: outer.bottom },
      fields: fields.map(rect => ({ left: rect.left, right: rect.right })),
    }
  })
  if (geometry.outer.left < 0 || geometry.outer.right > geometry.viewport.width || geometry.outer.top < 0 || geometry.outer.bottom > geometry.viewport.height) throw new Error('Color popover escaped the viewport')
  if (geometry.fields.some(field => field.left < geometry.outer.left || field.right > geometry.outer.right)) throw new Error('Color field escaped the popover')
  await shot(page, 'panel-color-popover-narrow')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1680, height: 1000 })
  await page.locator('[data-webview-annotation-editor]').getByRole('button', { name: 'Adjust' }).click()
  await commentInput.press('Enter')

  // Second annotation: capsule detail rows + markers echo.
  await frame.locator('.card:nth-of-type(2) button').click()
  const comment2 = page.locator('[data-webview-annotation-editor] .dsh-wv-comment-input')
  await comment2.waitFor({ timeout: 10_000 })
  await comment2.fill('Increase the spacing.')
  await comment2.press('Enter')
  const capsule = page.locator('[data-webview-annotation-capsule]')
  await capsule.waitFor({ timeout: 10_000 })
  await capsule.hover()
  await page.locator('[data-webview-annotation-row]').nth(1).waitFor({ timeout: 10_000 })
  await page.waitForTimeout(300)
  await shot(page, 'panel-two-annotations')

  // Dark theme variant.
  await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
  await page.waitForTimeout(400)
  await shot(page, 'panel-dark-annotations')
  await page.close()
} finally {
  await browser.close()
  await services.stop()
}

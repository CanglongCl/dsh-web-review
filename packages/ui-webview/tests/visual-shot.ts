/**
 * Visual-verification helper (not part of the test suite): boots the e2e
 * services, opens the webview panel against the demo page, picks an element,
 * and saves screenshots into .artifacts/ui/. Run with:
 *   pnpm exec tsx packages/ui-webview/tests/visual-shot.ts
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
  await clickWhenStable(page, page.getByRole('button', { name: 'Web preview' }))
  const urlInput = page.getByPlaceholder('Enter a URL and press Enter (e.g. http://localhost:5173)')
  await urlInput.waitFor({ timeout: 15_000 })
  await shot(page, 'panel-open-empty')

  await urlInput.fill(services.demoUrl)
  await urlInput.press('Enter')
  const frame = page.frameLocator('iframe.wv-frame')
  await page.waitForFunction(
    (expected) => document.querySelector('iframe.wv-frame')?.contentDocument?.title?.startsWith(expected) ?? false,
    '魔法 UI',
    { timeout: 20_000 },
  ).catch(() => {})
  await page.waitForTimeout(500)
  await shot(page, 'panel-with-page')

  await page.getByRole('button', { name: 'Pick element' }).click()
  await frame.locator('button.btn-primary').click()
  const pickCard = page.locator('.wv-pick')
  await pickCard.waitFor({ timeout: 10_000 })
  await pickCard.locator('textarea.wv-comment').fill('Make the button color darker and increase spacing.')
  await page.waitForTimeout(200)
  await shot(page, 'panel-with-pick')

  // Dragged split, to verify the splitter affordance visually.
  const split = page.locator('.wv-split')
  const box = await split.boundingBox()
  if (box !== null) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + 140, { steps: 8 })
    await page.mouse.up()
  }
  await page.waitForTimeout(300)
  await shot(page, 'panel-split-dragged')

  // Dark theme variant of the pick state.
  await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
  await page.waitForTimeout(400)
  await shot(page, 'panel-dark-with-pick')
  await page.close()
} finally {
  await browser.close()
  await services.stop()
}

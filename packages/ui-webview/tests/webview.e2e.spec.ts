/**
 * Webview e2e scenarios (harness web-e2e style: vitest + Playwright, DOM
 * assertions via expect.poll over locators): real GUI + real proxy + real
 * demo page. Scenarios:
 *  1. panel opens from the session header, proxies the demo page into the
 *     same-origin iframe (base-injected document rendered);
 *  2. element picking: pick mode → click inside the iframe → annotation card
 *     with the generated selector; commenting arms the send button;
 *  3. direct mode degrades: iframe loads the raw URL, picking is disabled
 *     with an explanatory hint;
 *  4. the FULL loop: pick + comment + send → the annotation message lands in
 *     the conversation transcript and the pick list clears (this pins the
 *     scope-addressed send path, which used to raise "cannot get property
 *     conversation without inject").
 * No API key is required: with a real key the probe message succeeds, and
 * without one the dead-loopback provider makes the probe turn settle fast —
 * either way the sent user message lands in the transcript.
 */
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { Browser, Page } from 'playwright'
import {
  chromium,
  clickWhenStable,
  connectWorkspace,
  newPage,
  saveFailureShot,
  startServices,
  type E2EServices,
} from './e2e-scaffold.ts'

let services: E2EServices
let browser: Browser

beforeAll(async () => {
  services = await startServices()
  browser = await chromium.launch()
}, 180_000)

afterAll(async () => {
  await browser?.close()
  await services?.stop()
}, 30_000)

/** Boot the GUI, connect a per-test workspace (isolated sessions), and open the webview panel. */
async function bootWithPanel(page: Page, name: string): Promise<void> {
  await page.goto(services.webUrl)
  await connectWorkspace(page, services.workspaceRoot, name)
  await clickWhenStable(page, page.getByRole('button', { name: 'Web preview' }))
  await page.getByPlaceholder('Enter a URL and press Enter (e.g. http://localhost:5173)').waitFor({ timeout: 15_000 })
}

describe('ui-webview e2e', () => {
  it('opens the panel and renders the demo page through the proxy iframe', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'proxy-navigation'))
    await bootWithPanel(page, 'proxy-nav')

    const urlInput = page.getByPlaceholder('Enter a URL and press Enter (e.g. http://localhost:5173)')
    await urlInput.fill(services.demoUrl)
    await urlInput.press('Enter')

    const frame = page.frameLocator('iframe.wv-frame')
    await expect.poll(
      async () => frame.locator('h1').textContent(),
      { timeout: 20_000, message: 'proxied demo page should render in the iframe' },
    ).toBe('魔法 UI 演示页')
    // The proxied document is same-origin: the iframe src rides the proxy path.
    expect(await page.locator('iframe.wv-frame').getAttribute('src')).toContain('/webview-proxy/http%3A//127.0.0.1%3A')
    await page.close()
  })

  it('picks an element in the iframe, comments on it, and arms the send button', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'element-pick'))
    await bootWithPanel(page, 'element-pick')

    const urlInput = page.getByPlaceholder('Enter a URL and press Enter (e.g. http://localhost:5173)')
    await urlInput.fill(services.demoUrl)
    await urlInput.press('Enter')

    const frame = page.frameLocator('iframe.wv-frame')
    await expect.poll(async () => frame.locator('h1').textContent(), { timeout: 20_000 }).toBe('魔法 UI 演示页')

    // Send is disabled with no picks.
    const send = page.getByRole('button', { name: 'Add to chat and send' })
    await expect.poll(async () => send.isDisabled(), { timeout: 10_000 }).toBe(true)

    // Pick mode: hover highlights, click selects the primary button.
    await page.getByRole('button', { name: 'Pick element' }).click()
    await frame.locator('button.btn-primary').click()

    // One annotation card with the generated selector and the snapshot.
    const pickCard = page.locator('.wv-pick')
    await expect.poll(async () => pickCard.count(), { timeout: 10_000 }).toBe(1)
    expect(await pickCard.locator('.wv-pick-selector').textContent()).toBe('.btn-primary')

    // Commenting arms the send button.
    await pickCard.locator('textarea.wv-comment').fill('Make the button color darker and increase spacing.')
    await expect.poll(async () => send.isEnabled(), { timeout: 10_000 }).toBe(true)
    await page.close()
  })

  it('degrades to direct mode: raw URL iframe, picking disabled with a hint', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'direct-mode'))
    await bootWithPanel(page, 'direct-mode')

    const urlInput = page.getByPlaceholder('Enter a URL and press Enter (e.g. http://localhost:5173)')
    await urlInput.fill(services.demoUrl)
    await urlInput.press('Enter')
    const frame = page.frameLocator('iframe.wv-frame')
    await expect.poll(async () => frame.locator('h1').textContent(), { timeout: 20_000 }).toBe('魔法 UI 演示页')

    await page.getByRole('button', { name: 'Direct' }).click()
    // Direct mode loads the raw URL (cross-origin) and disables picking.
    await expect.poll(
      async () => page.locator('iframe.wv-frame').getAttribute('src'),
      { timeout: 15_000 },
    ).toBe(services.demoUrl)
    await expect.poll(async () => page.getByRole('button', { name: 'Pick element' }).isDisabled(), { timeout: 10_000 }).toBe(true)
    await expect.poll(async () => page.getByText(/cross-origin|unavailable/).count(), { timeout: 10_000 }).toBeGreaterThan(0)
    await page.close()
  })

  it('sends the annotation into the conversation after picking and commenting', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'annotation-send'))
    await bootWithPanel(page, 'annotation-send')

    const urlInput = page.getByPlaceholder('Enter a URL and press Enter (e.g. http://localhost:5173)')
    await urlInput.fill(services.demoUrl)
    await urlInput.press('Enter')
    const frame = page.frameLocator('iframe.wv-frame')
    await expect.poll(async () => frame.locator('h1').textContent(), { timeout: 20_000 }).toBe('魔法 UI 演示页')

    // Pick an element and comment on it.
    await page.getByRole('button', { name: 'Pick element' }).click()
    await frame.locator('button.btn-primary').click()
    const pickCard = page.locator('.wv-pick')
    await expect.poll(async () => pickCard.count(), { timeout: 10_000 }).toBe(1)
    await pickCard.locator('textarea.wv-comment').fill('Make the button color darker.')

    // Send: the formatted annotation must land in the conversation transcript
    // (scope-addressed send), and the pick list must clear.
    const send = page.getByRole('button', { name: 'Add to chat and send' })
    await expect.poll(async () => send.isEnabled(), { timeout: 10_000 }).toBe(true)
    await send.click()
    await expect.poll(
      async () => page.getByText('[Page change request]').count(),
      { timeout: 20_000 },
    ).toBeGreaterThan(0)
    await expect.poll(async () => page.getByText('CSS selector: .btn-primary').count(), { timeout: 10_000 }).toBeGreaterThan(0)
    await expect.poll(async () => pickCard.count(), { timeout: 10_000 }).toBe(0)
    await expect.poll(async () => page.getByText('No elements picked yet').count(), { timeout: 10_000 }).toBeGreaterThan(0)
    await page.close()
  })
})

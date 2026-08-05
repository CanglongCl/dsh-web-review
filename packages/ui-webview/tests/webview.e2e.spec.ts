/**
 * Webview e2e scenarios (harness web-e2e style: vitest + Playwright, DOM
 * assertions via expect.poll over locators): real GUI + real proxy + real
 * demo page. Scenarios:
 *  1. panel opens from the session header, proxies the demo page into the
 *     same-origin iframe (base-injected document rendered);
 *  2. annotation flow: pick mode → click an element in the iframe → a
 *     floating comment field appears next to it → Enter commits a chip into
 *     the "Comments" bar and a numbered marker over the element;
 *  3. echo layer: two annotations → two chips and two markers with matching
 *     numbers; clicking a marker re-expands that element's comment field
 *     with its stored value;
 *  4. the FULL loop: annotate + send → the annotation message lands in the
 *     conversation transcript and the comment chips clear (this pins the
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

/** Load the demo page through the proxy and wait for the hero to render. */
async function loadDemoPage(page: Page): Promise<import('playwright').FrameLocator> {
  const urlInput = page.getByPlaceholder('Enter a URL and press Enter (e.g. http://localhost:5173)')
  await urlInput.fill(services.demoUrl)
  await urlInput.press('Enter')
  const frame = page.frameLocator('iframe.wv-frame')
  await expect.poll(
    async () => frame.locator('h1').textContent(),
    { timeout: 20_000, message: 'proxied demo page should render in the iframe' },
  ).toBe('魔法 UI 演示页')
  return frame
}

/** Pick one element: arm pick mode (idempotent — it stays armed after a
 * commit), click it, commit the floating comment. */
async function annotate(
  page: Page,
  frame: import('playwright').FrameLocator,
  selector: string,
  comment: string,
): Promise<void> {
  const pickBtn = page.getByRole('button', { name: /^Pick element$|^Stop picking$/ })
  if ((await pickBtn.getAttribute('aria-pressed')) !== 'true') {
    await pickBtn.click()
  }
  await frame.locator(selector).click()
  const commentInput = frame.locator('.dsh-wv-comment-input')
  await commentInput.waitFor({ timeout: 10_000 })
  await commentInput.fill(comment)
  await commentInput.press('Enter')
  // The floating field closes on commit.
  await commentInput.waitFor({ state: 'detached', timeout: 10_000 })
}

describe('ui-webview e2e', () => {
  it('opens the panel and renders the demo page through the proxy iframe', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'proxy-navigation'))
    await bootWithPanel(page, 'proxy-nav')
    const frame = await loadDemoPage(page)
    // The proxied document is same-origin: the iframe src rides the proxy path.
    expect(await page.locator('iframe.wv-frame').getAttribute('src')).toContain('/webview-proxy/http%3A//127.0.0.1%3A')
    await page.close()
  })

  it('annotates an element: floating comment field commits a chip and a marker', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'annotation-flow'))
    await bootWithPanel(page, 'annotation-flow')
    const frame = await loadDemoPage(page)

    // Send is disabled with no picks.
    const send = page.getByRole('button', { name: 'Add to chat and send' })
    await expect.poll(async () => send.isDisabled(), { timeout: 10_000 }).toBe(true)

    await annotate(page, frame, 'button.btn-primary', 'Make the button color darker.')

    // One chip in the Comments bar with the element identity, and one
    // numbered marker floating over the element in the iframe.
    const chip = page.locator('.wv-chip')
    await expect.poll(async () => chip.count(), { timeout: 10_000 }).toBe(1)
    expect(await chip.locator('.wv-chip-index').textContent()).toBe('1')
    expect(await chip.locator('.wv-chip-label').textContent()).toBe('button.btn-primary')
    await expect.poll(async () => frame.locator('.dsh-wv-marker').count(), { timeout: 10_000 }).toBe(1)
    expect(await frame.locator('.dsh-wv-marker').first().textContent()).toBe('1')

    // Commenting arms the send button.
    await expect.poll(async () => send.isEnabled(), { timeout: 10_000 }).toBe(true)
    await page.close()
  })

  it('echoes multiple annotations: chips and markers in sync, marker click re-opens the comment', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'annotation-echo'))
    await bootWithPanel(page, 'annotation-echo')
    const frame = await loadDemoPage(page)

    // Pick mode stays armed after a commit: two elements in a row.
    await annotate(page, frame, 'button.btn-primary', 'Make the submit darker.')
    await annotate(page, frame, '.card:nth-of-type(2) button', 'Increase the spacing.')

    const chips = page.locator('.wv-chip')
    await expect.poll(async () => chips.count(), { timeout: 10_000 }).toBe(2)
    expect(await chips.nth(0).locator('.wv-chip-index').textContent()).toBe('1')
    expect(await chips.nth(1).locator('.wv-chip-index').textContent()).toBe('2')

    const markers = frame.locator('.dsh-wv-marker')
    await expect.poll(async () => markers.count(), { timeout: 10_000 }).toBe(2)
    expect(await markers.nth(0).textContent()).toBe('1')
    expect(await markers.nth(1).textContent()).toBe('2')

    // Clicking a marker re-expands that element's comment field with its value.
    await markers.nth(1).click()
    const commentInput = frame.locator('.dsh-wv-comment-input')
    await commentInput.waitFor({ timeout: 10_000 })
    expect(await commentInput.inputValue()).toBe('Increase the spacing.')
    await page.close()
  })

  it('sends the annotation into the conversation after annotating', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'annotation-send'))
    await bootWithPanel(page, 'annotation-send')
    const frame = await loadDemoPage(page)

    await annotate(page, frame, 'button.btn-primary', 'Make the button color darker.')

    // Send: the formatted annotation must land in the conversation transcript
    // (scope-addressed send), and the comment bar must clear.
    const send = page.getByRole('button', { name: 'Add to chat and send' })
    await expect.poll(async () => send.isEnabled(), { timeout: 10_000 }).toBe(true)
    await send.click()
    await expect.poll(
      async () => page.getByText('[Page change request]').count(),
      { timeout: 20_000 },
    ).toBeGreaterThan(0)
    await expect.poll(async () => page.getByText('CSS selector: .btn-primary').count(), { timeout: 10_000 }).toBeGreaterThan(0)
    await expect.poll(async () => page.locator('.wv-chip').count(), { timeout: 10_000 }).toBe(0)
    await expect.poll(async () => page.getByText('No comments yet').count(), { timeout: 10_000 }).toBeGreaterThan(0)
    await page.close()
  })
})

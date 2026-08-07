/**
 * Webview e2e scenarios (harness web-e2e style: vitest + Playwright, DOM
 * assertions via expect.poll over locators): real GUI + real proxy + real
 * demo page. The preview is a conversation view TAB now (plan §2): boot opens
 * the 'Preview' tab from the conversation header's tablist, loads the demo
 * page through the proxy into the same-origin iframe, and annotates elements.
 * Scenarios:
 *  1. the Preview tab opens and the proxied demo page renders in the wv-frame
 *     iframe (tab activation asserted via aria-selected);
 *  2. annotation flow: pick mode → click an element in the iframe → a
 *     floating comment field appears next to it → Enter commits a chip into
 *     the dock strip above the composer and a numbered marker over the
 *     element; clicking the dock chip re-outlines the element and re-opens
 *     its comment;
 *  3. echo layer: two annotations → two chips and two markers with matching
 *     numbers; clicking a marker re-expands that element's comment field
 *     with its stored value;
 *  4. the FULL loop: annotate, type a short message into the STOCK composer
 *     and click the dsh send button → the annotation XML lands as a
 *     user-content prefix of that message in the transcript (this pins the
 *     node-half agent/prompt-submit injection with the real host);
 *  5. no annotations → the same send carries no '<annotation' prefix
 *     (clearing the last annotation syncs an empty xml; next() passes the
 *     message through unchanged).
 * No API key is required: with a real key the probe message succeeds, and
 * without one the dead-loopback provider makes the probe turn settle fast —
 * either way the sent user message lands in the transcript.
 */
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

/** Boot the GUI, connect a per-test workspace (isolated sessions), and open the Preview tab. */
async function bootWithPanel(page: Page, name: string): Promise<void> {
  await page.goto(services.webUrl)
  await connectWorkspace(page, services.workspaceRoot, name)
  // The preview is a conversation view tab now (no header toggle button): the
  // conversation header's tablist holds [Chat] [Preview], and the active tab
  // carries aria-selected="true". The header re-mounts while a turn settles,
  // so the click is retried, then the activation state is asserted.
  const previewTab = page.getByRole('tab', { name: 'Preview' })
  await clickWhenStable(page, previewTab)
  await expect.poll(
    async () => previewTab.getAttribute('aria-selected'),
    { timeout: 10_000, message: 'the Preview tab should be the active conversation view' },
  ).toBe('true')
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
  // The pick toggle only enables once the picker is injected into the
  // same-origin frame (after the iframe load); wait for it before clicking.
  const pickBtn = page.getByRole('button', { name: /^Pick element$|^Stop picking$/ })
  await expect.poll(
    async () => pickBtn.isEnabled(),
    { timeout: 15_000, message: 'the pick button should be enabled' },
  ).toBe(true)
  if ((await pickBtn.getAttribute('aria-pressed')) !== 'true') {
    await pickBtn.click()
  }
  await frame.locator(selector).click()
  const commentInput = frame.locator('.dsh-wv-comment-input')
  await commentInput.waitFor({ timeout: 10_000 })
  // The picked element keeps its outline while the comment field is open.
  await expect.poll(
    async () => frame.locator(selector).getAttribute('data-dsh-wv-selected'),
    { timeout: 10_000 },
  ).not.toBeNull()
  await commentInput.fill(comment)
  await commentInput.press('Enter')
  // The floating field closes on commit, and the outline moves on.
  await commentInput.waitFor({ state: 'detached', timeout: 10_000 })
  await expect.poll(
    async () => frame.locator(selector).getAttribute('data-dsh-wv-selected'),
    { timeout: 10_000 },
  ).toBeNull()
}

/** Send one message through the STOCK composer: type into the native box and
 * click the dsh primary send button. The primary button doubles as 'Stop
 * generating' while a turn runs (the blank-state probe may still be settling
 * with a real provider key), so wait for the idle 'Send message' label and an
 * enabled button before clicking — a click during the running turn would stop
 * it instead of sending. */
async function sendViaComposer(page: Page, text: string): Promise<void> {
  const composer = page.getByPlaceholder('Message the agent')
  await composer.waitFor({ timeout: 15_000 })
  await expect.poll(
    async () => composer.isEditable(),
    { timeout: 45_000, message: 'the stock composer should be editable' },
  ).toBe(true)
  await composer.fill(text)
  const send = page.getByRole('button', { name: 'Send message' })
  await expect.poll(
    async () => send.isEnabled(),
    { timeout: 45_000, message: 'the dsh send button should be enabled' },
  ).toBe(true)
  await send.click()
}

describe('ui-webview e2e', () => {
  it('opens the Preview tab and renders the demo page through the proxy iframe', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'proxy-navigation'))
    await bootWithPanel(page, 'proxy-nav')
    const frame = await loadDemoPage(page)
    // The proxied document is same-origin: the iframe src rides the proxy path.
    expect(await page.locator('iframe.wv-frame').getAttribute('src')).toContain('/webview-proxy/http%3A//127.0.0.1%3A')
    await page.close()
  })

  it('annotates an element: the floating comment commits a dock chip and a marker; clicking the chip re-outlines the element', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'annotation-flow'))
    await bootWithPanel(page, 'annotation-flow')
    const frame = await loadDemoPage(page)

    // No annotations yet: the dock strip renders nothing.
    expect(await page.locator('.wv-annotations-bar').count()).toBe(0)

    await annotate(page, frame, 'button.btn-primary', 'Make the button color darker.')

    // One chip in the dock strip (the new overlay bar above the composer)
    // with the element identity, and one numbered marker over the element.
    const bar = page.locator('.wv-annotations-bar')
    await expect.poll(async () => bar.count(), { timeout: 10_000 }).toBe(1)
    const chip = bar.locator('.wv-chip')
    await expect.poll(async () => chip.count(), { timeout: 10_000 }).toBe(1)
    expect(await chip.locator('.wv-chip-index').textContent()).toBe('1')
    expect(await chip.locator('.wv-chip-label').textContent()).toBe('button.btn-primary')
    await expect.poll(async () => frame.locator('.dsh-wv-marker').count(), { timeout: 10_000 }).toBe(1)
    expect(await frame.locator('.dsh-wv-marker').first().textContent()).toBe('1')

    // Clicking the dock chip re-outlines the element and re-opens its comment
    // with the stored value (the preview tab's focus signal).
    await chip.click()
    const commentInput = frame.locator('.dsh-wv-comment-input')
    await commentInput.waitFor({ timeout: 10_000 })
    expect(await commentInput.inputValue()).toBe('Make the button color darker.')
    await expect.poll(
      async () => frame.locator('button.btn-primary').getAttribute('data-dsh-wv-selected'),
      { timeout: 10_000 },
    ).not.toBeNull()
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

    const chips = page.locator('.wv-annotations-bar .wv-chip')
    await expect.poll(async () => chips.count(), { timeout: 10_000 }).toBe(2)
    expect(await chips.nth(0).locator('.wv-chip-index').textContent()).toBe('1')
    expect(await chips.nth(1).locator('.wv-chip-index').textContent()).toBe('2')

    const markers = frame.locator('.dsh-wv-marker')
    await expect.poll(async () => markers.count(), { timeout: 10_000 }).toBe(2)
    expect(await markers.nth(0).textContent()).toBe('1')
    expect(await markers.nth(1).textContent()).toBe('2')

    // Clicking a marker re-expands that element's comment field with its value
    // and re-outlines the element.
    await markers.nth(1).click()
    const commentInput = frame.locator('.dsh-wv-comment-input')
    await commentInput.waitFor({ timeout: 10_000 })
    expect(await commentInput.inputValue()).toBe('Increase the spacing.')
    await expect.poll(
      async () => frame.locator('.card:nth-of-type(2) button').getAttribute('data-dsh-wv-selected'),
      { timeout: 10_000 },
    ).not.toBeNull()
    await page.close()
  })

  it('sends the annotation as a user-content prefix through the stock composer', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'annotation-send'))
    await bootWithPanel(page, 'annotation-send')
    const frame = await loadDemoPage(page)

    await annotate(page, frame, 'button.btn-primary', 'Make the button color darker.')
    // The annotation XML syncs to the node half trailing-throttled; let the
    // POST land before sending so prompt-submit reads it.
    await page.waitForTimeout(800)

    // Send through the STOCK composer: the dsh input box + the dsh send
    // button. The node half's agent/prompt-submit listener rewrites the
    // prompt into XML + the user's own text.
    await sendViaComposer(page, 'apply')

    // The view ring mounts only the active view, so read the transcript from
    // the Chat tab.
    await clickWhenStable(page, page.getByRole('tab', { name: 'Chat' }))
    // The annotation lands as a location-oriented XML prefix: hint on the
    // open tag, text identity + stable classes + full DOM path (the demo page
    // has no framework, so no source anchor tier), all inside the user's own
    // message that also carries the typed text.
    await expect.poll(
      async () => page.getByText('<annotation hint=').count(),
      { timeout: 30_000, message: 'the annotation XML should appear in the transcript' },
    ).toBeGreaterThan(0)
    await expect.poll(async () => page.getByText('text="button &quot;提交&quot;"').count(), { timeout: 10_000 }).toBeGreaterThan(0)
    await expect.poll(async () => page.getByText('classes="btn-primary"').count(), { timeout: 10_000 }).toBeGreaterThan(0)
    await expect.poll(
      async () => page.getByText(/path="html > body > main\.cards > div\.card > button\.btn-primary"/).count(),
      { timeout: 10_000 },
    ).toBeGreaterThan(0)
    // The typed user content rides the SAME message, after the XML block.
    await expect.poll(
      async () => page.getByText(/<annotation[\s\S]*apply/).count(),
      { timeout: 10_000, message: 'the annotation and the user text should be one message' },
    ).toBeGreaterThan(0)
    await page.close()
  })

  it('does not inject the annotation when the annotation is cleared before sending', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'annotation-clear-send'))
    await bootWithPanel(page, 'annotation-clear-send')
    const frame = await loadDemoPage(page)

    await annotate(page, frame, 'button.btn-primary', 'Make the button color darker.')
    // Clear the annotation: removing the last pick syncs an empty xml, which
    // makes the next send pass through unchanged.
    await page.locator('.wv-annotations-bar .wv-chip-remove').click()
    await expect.poll(async () => page.locator('.wv-chip').count(), { timeout: 10_000 }).toBe(0)
    // The trailing-throttled clear POST must land before the send.
    await page.waitForTimeout(800)

    await sendViaComposer(page, 'apply')

    await clickWhenStable(page, page.getByRole('tab', { name: 'Chat' }))
    await expect.poll(
      async () => page.getByText('apply').count(),
      { timeout: 30_000, message: 'the sent user message should appear in the transcript' },
    ).toBeGreaterThan(0)
    // No annotation was synced: the message passes through without the prefix.
    expect(await page.getByText('<annotation hint=').count()).toBe(0)
    await page.close()
  })
})

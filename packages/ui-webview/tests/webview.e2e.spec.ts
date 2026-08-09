/**
 * Real GUI + proxy + picker + separate `agent.inject` context acceptance.
 * Fixed sleeps are deliberately absent: the composer capsule's synced state
 * is the browser-visible host acknowledgement boundary.
 */
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { Browser, FrameLocator, Page } from 'playwright'
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

async function bootWithPanel(page: Page, name: string): Promise<void> {
  await page.goto(services.webUrl)
  await connectWorkspace(page, services.workspaceRoot, name)
  const previewTab = page.getByRole('tab', { name: 'Preview' })
  await clickWhenStable(page, previewTab)
  await expect.poll(
    async () => previewTab.getAttribute('aria-selected'),
    { timeout: 10_000, message: 'Preview should be the active conversation view' },
  ).toBe('true')
  await page.getByPlaceholder('Enter a URL and press Enter (e.g. http://localhost:5173)').waitFor({ timeout: 15_000 })
}

async function loadDemoPage(page: Page): Promise<FrameLocator> {
  const input = page.getByPlaceholder('Enter a URL and press Enter (e.g. http://localhost:5173)')
  await input.fill(services.demoUrl)
  await input.press('Enter')
  const frame = page.frameLocator('iframe[title="Web preview"]')
  await expect.poll(
    async () => frame.locator('h1').textContent(),
    { timeout: 20_000, message: 'proxied demo page should render' },
  ).toBe('魔法 UI 演示页')
  return frame
}

async function annotate(page: Page, frame: FrameLocator, selector: string, comment: string): Promise<void> {
  const pick = page.getByRole('button', { name: /^Pick element$|^Stop picking$/ })
  await expect.poll(async () => pick.isEnabled(), { timeout: 15_000 }).toBe(true)
  if ((await pick.getAttribute('aria-pressed')) !== 'true') await pick.click()
  await frame.locator(selector).click()
  const input = frame.locator('.dsh-wv-comment-input')
  await input.waitFor({ timeout: 10_000 })
  await expect.poll(
    async () => frame.locator(selector).getAttribute('data-dsh-wv-selected'),
    { timeout: 10_000 },
  ).not.toBeNull()
  await input.fill(comment)
  await input.press('Enter')
  await input.waitFor({ state: 'detached', timeout: 10_000 })
}

async function waitForAnnotationSync(page: Page): Promise<void> {
  const capsule = page.locator('[data-webview-annotation-capsule]')
  await capsule.waitFor({ timeout: 10_000 })
  await expect.poll(
    async () => capsule.getAttribute('data-sync-status'),
    { timeout: 15_000, message: 'annotation context should be acknowledged by the host' },
  ).toBe('synced')
}

async function sendViaComposer(page: Page, text: string): Promise<void> {
  const composer = page.getByPlaceholder('Message the agent')
  await composer.waitFor({ timeout: 15_000 })
  await expect.poll(async () => composer.isEditable(), { timeout: 45_000 }).toBe(true)
  await composer.fill(text)
  const send = page.getByRole('button', { name: 'Send message' })
  await expect.poll(async () => send.isEnabled(), { timeout: 45_000 }).toBe(true)
  await send.click()
}

async function openLastContext(page: Page): Promise<import('playwright').Locator> {
  const rows = page.locator('[data-chat-flow-kind="context"]')
  await expect.poll(async () => rows.count(), { timeout: 30_000 }).toBeGreaterThan(0)
  const row = rows.last()
  await row.getByText('Context injection', { exact: true }).click()
  const body = row.locator('[data-context-injection-body]')
  await body.waitFor({ timeout: 10_000 })
  return body
}

describe('ui-webview e2e', () => {
  it('opens Preview and renders the same-origin proxy iframe', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'proxy-navigation'))
    await bootWithPanel(page, 'proxy-nav')
    await loadDemoPage(page)
    expect(await page.locator('iframe[title="Web preview"]').getAttribute('src'))
      .toContain('/webview-proxy/http%3A//127.0.0.1%3A')
    await page.close()
  })

  it('commits one capsule/marker and exposes comment context on hover', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'annotation-flow'))
    await bootWithPanel(page, 'annotation-flow')
    const frame = await loadDemoPage(page)
    expect(await page.locator('[data-webview-annotations]').count()).toBe(0)

    await annotate(page, frame, 'button.btn-primary', 'Make the button color darker.')
    await waitForAnnotationSync(page)
    await expect.poll(async () => frame.locator('.dsh-wv-marker').count(), { timeout: 10_000 }).toBe(1)
    expect(await frame.locator('.dsh-wv-marker').textContent()).toBe('1')

    const capsule = page.locator('[data-webview-annotation-capsule]')
    expect(await capsule.textContent()).toContain('1 comment')
    await capsule.hover()
    const details = page.locator('[data-webview-annotation-details]')
    await details.waitFor({ timeout: 10_000 })
    expect(await details.textContent()).toContain('button')
    expect(await details.textContent()).toContain('提交')
    expect(await details.textContent()).toContain('Make the button color darker.')

    await details.locator('[data-webview-annotation-row] button').first().click()
    const commentInput = frame.locator('.dsh-wv-comment-input')
    await commentInput.waitFor({ timeout: 10_000 })
    expect(await commentInput.inputValue()).toBe('Make the button color darker.')
    await page.close()
  })

  it('keeps multiple detail rows and iframe markers in the same order', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'annotation-echo'))
    await bootWithPanel(page, 'annotation-echo')
    const frame = await loadDemoPage(page)
    await annotate(page, frame, 'button.btn-primary', 'Make the submit darker.')
    await annotate(page, frame, '.card:nth-of-type(2) button', 'Increase the spacing.')
    await waitForAnnotationSync(page)

    const markers = frame.locator('.dsh-wv-marker')
    await expect.poll(async () => markers.count(), { timeout: 10_000 }).toBe(2)
    expect(await markers.nth(0).textContent()).toBe('1')
    expect(await markers.nth(1).textContent()).toBe('2')

    await page.locator('[data-webview-annotation-capsule]').hover()
    const rows = page.locator('[data-webview-annotation-row]')
    await expect.poll(async () => rows.count(), { timeout: 10_000 }).toBe(2)
    expect(await rows.nth(0).textContent()).toContain('Make the submit darker.')
    expect(await rows.nth(1).textContent()).toContain('Increase the spacing.')

    await markers.nth(1).click()
    const input = frame.locator('.dsh-wv-comment-input')
    await input.waitFor({ timeout: 10_000 })
    expect(await input.inputValue()).toBe('Increase the spacing.')
    await page.close()
  })

  it('logs browser comments as a separate context before unchanged user input', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'annotation-context-send'))
    await bootWithPanel(page, 'annotation-context-send')
    const frame = await loadDemoPage(page)
    await annotate(page, frame, 'button.btn-primary', 'Make the button color darker.')
    await waitForAnnotationSync(page)
    await sendViaComposer(page, 'apply')
    await clickWhenStable(page, page.getByRole('tab', { name: 'Chat' }))

    const contextBody = await openLastContext(page)
    const contextText = await contextBody.textContent()
    expect(contextText).toContain('# Browser comments')
    expect(contextText).toContain('untrusted page evidence')
    expect(contextText).toContain('Comment (user-authored)')
    expect(contextText).toContain('Make the button color darker.')
    expect(contextText).toContain('"kind": "plugin"')
    expect(contextText).toContain('"plugin": "ui-webview"')

    const userRows = page.locator('[data-chat-flow-kind="user"]')
    const user = userRows.filter({ hasText: 'apply' }).last()
    await user.waitFor({ timeout: 30_000 })
    expect((await user.textContent())?.includes('# Browser comments')).toBe(false)
    expect((await user.textContent())?.includes('<annotation')).toBe(false)

    const ordered = await page.locator('[data-chat-flow]').evaluate((flow) => {
      const items = Array.from(flow.querySelectorAll<HTMLElement>('[data-chat-flow-kind]'))
      const contextIndex = items.findLastIndex(item => item.dataset.chatFlowKind === 'context')
      const userIndex = items.findLastIndex(item => item.dataset.chatFlowKind === 'user' && item.textContent?.includes('apply') === true)
      return { contextIndex, userIndex }
    })
    expect(ordered.contextIndex).toBeGreaterThanOrEqual(0)
    expect(ordered.userIndex).toBeGreaterThan(ordered.contextIndex)
    await page.close()
  })

  it('acknowledges a clearing context before hiding the capsule', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'annotation-clear-send'))
    await bootWithPanel(page, 'annotation-clear-send')
    const frame = await loadDemoPage(page)
    await annotate(page, frame, 'button.btn-primary', 'Make the button color darker.')
    await waitForAnnotationSync(page)

    await page.getByRole('button', { name: 'Clear all comments' }).click()
    await expect.poll(
      async () => page.locator('[data-webview-annotations]').count(),
      { timeout: 15_000, message: 'capsule hides only after the clearing context is acknowledged' },
    ).toBe(0)
    await sendViaComposer(page, 'apply')
    await clickWhenStable(page, page.getByRole('tab', { name: 'Chat' }))
    const contextBody = await openLastContext(page)
    expect(await contextBody.textContent()).toContain('There are no active browser comments.')
    expect(await page.locator('[data-chat-flow-kind="user"]').filter({ hasText: 'apply' }).last().textContent())
      .not.toContain('# Browser comments')
    await page.close()
  })
})

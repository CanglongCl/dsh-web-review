/**
 * Real GUI + proxy + picker + send-time pre-step context acceptance.
 * Fixed sleeps are deliberately absent: the composer capsule's ready state
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
  const previewTab = page.getByRole('tab', { name: 'Web Preview' })
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
  const toolbar = page.locator('[data-webview-annotation-toolbar]')
  if (await toolbar.count() === 0) {
    const pick = page.getByRole('button', { name: 'Add page comments' })
    await expect.poll(async () => pick.isEnabled(), { timeout: 15_000 }).toBe(true)
    await pick.click()
  }
  await frame.locator(selector).click()
  const input = page.locator('[data-webview-annotation-editor] .dsh-wv-comment-input')
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

describe('dsh-web-review e2e', () => {
  it('opens an assistant-authored HTTP link directly in Preview', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'assistant-link-preview'))
    await bootWithPanel(page, 'assistant-link-preview')
    await clickWhenStable(page, page.getByRole('tab', { name: 'Chat' }))
    await page.locator('[data-chat-flow]').evaluate((flow, url) => {
      const row = document.createElement('div')
      row.dataset.chatFlowKind = 'assistant'
      const link = document.createElement('a')
      link.dataset.previewE2e = ''
      link.href = url
      link.textContent = 'Open review'
      row.appendChild(link)
      flow.appendChild(row)
    }, services.demoUrl)
    await page.locator('[data-preview-e2e]').click()

    const previewTab = page.getByRole('tab', { name: 'Web Preview' })
    await expect.poll(
      async () => previewTab.getAttribute('aria-selected'),
      { timeout: 10_000, message: 'assistant link should activate Preview' },
    ).toBe('true')
    await expect.poll(
      async () => page.frameLocator('iframe[title="Web preview"]').locator('h1').textContent(),
      { timeout: 20_000, message: 'assistant link target should render through the proxy' },
    ).toBe('魔法 UI 演示页')
    await page.close()
  })

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
    const commentInput = page.locator('[data-webview-annotation-editor] .dsh-wv-comment-input')
    await commentInput.waitFor({ timeout: 10_000 })
    expect(await commentInput.inputValue()).toBe('Make the button color darker.')
    await page.close()
  })

  it('previews rich style/text edits, resets one field, injects diffs, and rolls the page back', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'rich-annotation-editor'))
    await bootWithPanel(page, 'rich-annotation-editor')
    const frame = await loadDemoPage(page)
    const heading = frame.locator('.hero h1')
    const original = await heading.evaluate(element => ({
      color: getComputedStyle(element).color,
      fontSize: getComputedStyle(element).fontSize,
      text: element.textContent,
    }))

    await page.getByRole('button', { name: 'Add page comments' }).click()
    await heading.click()
    const editor = page.locator('[data-webview-annotation-editor]')
    await editor.waitFor({ timeout: 10_000 })
    await editor.getByRole('button', { name: 'Adjust' }).click()
    expect(await editor.locator('select').count()).toBe(0)
    expect(await editor.locator('[data-webview-text-content]').count()).toBe(1)
    expect(await editor.locator('[data-webview-target-title]').count()).toBe(0)
    await editor.getByRole('button', { name: 'Bold' }).waitFor()
    const fontSizeField = editor.getByRole('spinbutton', { name: 'Font size', exact: true })
    expect(await fontSizeField.evaluate(element => element.getBoundingClientRect().width))
      .toBeGreaterThan(120)
    expect(await fontSizeField.evaluate((element) => {
      const editorRect = element.closest('[data-webview-annotation-editor]')!.getBoundingClientRect()
      const fieldRect = element.getBoundingClientRect()
      return fieldRect.left > editorRect.left + editorRect.width / 2
    })).toBe(true)
    const fontSizeHandle = editor.getByRole('button', { name: 'Font size · 拖动调整' })
    const handleBox = await fontSizeHandle.boundingBox()
    if (handleBox === null) throw new Error('Font-size scrub handle has no layout box')
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 8, handleBox.y + handleBox.height / 2)
    await expect.poll(async () => editor.getAttribute('data-scrubbing')).toBe('font-size')
    const scrubStyles = await editor.evaluate((element) => {
      const active = element.querySelector('[data-scrub-active]')
      const inspector = element.querySelector('[data-webview-property-inspector]')
      const compose = element.querySelector('.dsh-wv-comment-input')?.parentElement
      const footer = element.querySelector('[data-webview-editor-footer]')
      const inactiveRow = element.querySelector('[data-inspector-row]:not([data-scrub-active])')
      const section = active?.closest('section')
      if (!(active instanceof HTMLElement) || inspector === null || compose === null || footer === null || inactiveRow === null || section === null) return null
      return {
        activeVisibility: getComputedStyle(active).visibility,
        activePointerEvents: getComputedStyle(active).pointerEvents,
        composeVisibility: getComputedStyle(compose).visibility,
        inspectorVisibility: getComputedStyle(inspector).visibility,
        footerVisibility: getComputedStyle(footer).visibility,
        inactiveRowVisibility: getComputedStyle(inactiveRow).visibility,
        sectionVisibility: getComputedStyle(section).visibility,
        editorBackground: getComputedStyle(element).backgroundColor,
        editorBorder: getComputedStyle(element).borderTopColor,
        editorShadow: getComputedStyle(element).boxShadow,
        editorTransition: getComputedStyle(element).transitionDuration,
      }
    })
    expect(scrubStyles).toEqual({
      activeVisibility: 'visible',
      activePointerEvents: 'auto',
      composeVisibility: 'hidden',
      inspectorVisibility: 'hidden',
      footerVisibility: 'hidden',
      inactiveRowVisibility: 'hidden',
      sectionVisibility: 'hidden',
      editorBackground: 'rgba(0, 0, 0, 0)',
      editorBorder: 'rgba(0, 0, 0, 0)',
      editorShadow: 'none',
      editorTransition: '0s',
    })
    await page.mouse.up()
    await expect.poll(async () => editor.getAttribute('data-scrubbing')).toBeNull()
    expect(await editor.evaluate((element) => ({
      composeVisibility: getComputedStyle(element.querySelector('.dsh-wv-comment-input')!.parentElement!).visibility,
      inspectorVisibility: getComputedStyle(element.querySelector('[data-webview-property-inspector]')!).visibility,
      editorBackground: getComputedStyle(element).backgroundColor,
      editorTransition: getComputedStyle(element).transitionDuration,
    }))).toEqual({
      composeVisibility: 'visible',
      inspectorVisibility: 'visible',
      editorBackground: 'rgb(255, 255, 255)',
      editorTransition: '0s',
    })
    const footer = editor.locator('[data-webview-editor-footer]')
    const inspector = editor.locator('[data-webview-property-inspector]')
    await inspector.evaluate(element => { element.scrollTop = element.scrollHeight })
    expect(await footer.evaluate((element) => {
      const footerRect = element.getBoundingClientRect()
      const editorRect = element.closest('[data-webview-annotation-editor]')!.getBoundingClientRect()
      return footerRect.bottom <= editorRect.bottom + 1 && footerRect.top >= editorRect.top
    })).toBe(true)
    expect(await footer.evaluate((element) => {
      const style = getComputedStyle(element)
      return style.paddingTop === style.paddingBottom
    })).toBe(true)
    expect(await page.locator('[data-webview-preview-body]').evaluate((element) => {
      const bodyStyle = getComputedStyle(element)
      const frameWrap = element.firstElementChild
      return frameWrap !== null
        && Number.parseFloat(bodyStyle.paddingBottom) >= 8
        && getComputedStyle(frameWrap).borderBottomStyle === 'solid'
    })).toBe(true)
    await editor.getByPlaceholder('Describe these changes…').fill('Use the reviewed heading treatment.')
    await editor.getByLabel('Text content').fill('Reviewed magic UI')
    await editor.getByLabel('Text color', { exact: true }).click()
    await page.getByLabel('Text color · Hex').fill('#613838')
    await fontSizeField.fill('24px')

    await expect.poll(async () => heading.evaluate(element => ({
      color: getComputedStyle(element).color,
      fontSize: getComputedStyle(element).fontSize,
      text: element.textContent,
    })), { timeout: 10_000 }).toEqual({
      color: 'rgb(97, 56, 56)',
      fontSize: '24px',
      text: 'Reviewed magic UI',
    })

    await editor.getByRole('button', { name: 'Temporarily hide editor' }).click()
    const showEditor = page.locator('button[aria-label="Show editor"]')
    await showEditor.waitFor({ state: 'visible' })
    expect(await editor.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s')
    expect(await showEditor.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s')
    expect(await showEditor.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return { width: Math.round(rect.width), height: Math.round(rect.height), pressed: element.getAttribute('aria-pressed') }
    })).toEqual({ width: 36, height: 36, pressed: 'true' })
    expect(await editor.evaluate(element => ({
      opacity: getComputedStyle(element).opacity,
      visibility: getComputedStyle(element).visibility,
    }))).toEqual({ opacity: '0', visibility: 'hidden' })
    expect(await heading.evaluate(element => getComputedStyle(element).fontSize)).toBe('24px')
    await showEditor.click()
    expect(await editor.evaluate(element => ({
      hidden: element.hasAttribute('data-editor-hidden'),
      opacity: getComputedStyle(element).opacity,
      visibility: getComputedStyle(element).visibility,
    }))).toEqual({ hidden: false, opacity: '1', visibility: 'visible' })
    expect(await editor.getByPlaceholder('Describe these changes…').inputValue()).toBe('Use the reviewed heading treatment.')
    expect(await fontSizeField.inputValue()).toBe('24px')
    await editor.getByRole('button', { name: 'Restore original value · Font size' }).click()
    await expect.poll(async () => heading.evaluate(element => getComputedStyle(element).fontSize))
      .toBe(original.fontSize)
    await editor.getByRole('button', { name: 'Confirm annotation' }).click()
    await editor.waitFor({ state: 'detached', timeout: 10_000 })
    await waitForAnnotationSync(page)

    await page.getByPlaceholder('Message the agent').fill('apply the reviewed visual changes')
    await page.getByRole('button', { name: 'Send 1' }).click()
    await expect.poll(async () => heading.evaluate(element => ({
      color: getComputedStyle(element).color,
      fontSize: getComputedStyle(element).fontSize,
      text: element.textContent,
    })), { timeout: 30_000, message: 'successful send should remove every temporary preview mutation' })
      .toEqual(original)

    await clickWhenStable(page, page.getByRole('tab', { name: 'Chat' }))
    const contextText = await (await openLastContext(page)).textContent()
    expect(contextText).toContain('Browser annotation:')
    expect(contextText).toContain('Visible viewport at edit time:')
    expect(contextText).toContain('- color: rgb(255, 255, 255) -> #613838')
    expect(contextText).toContain('- text: "魔法 UI 演示页" -> "Reviewed magic UI"')
    expect(contextText).not.toContain('- font-size:')
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
    const input = page.locator('[data-webview-annotation-editor] .dsh-wv-comment-input')
    await input.waitFor({ timeout: 10_000 })
    expect(await input.inputValue()).toBe('Increase the spacing.')
    await page.close()
  })

  it('injects browser comments on send, preserves user input and consumes the capsule', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'annotation-context-send'))
    await bootWithPanel(page, 'annotation-context-send')
    const frame = await loadDemoPage(page)
    await annotate(page, frame, 'button.btn-primary', 'Make the button color darker.')
    await waitForAnnotationSync(page)
    await sendViaComposer(page, 'apply')
    await expect.poll(
      async () => page.locator('[data-webview-annotations]').count(),
      { timeout: 30_000, message: 'accepted user prompt should consume the prepared annotation capsule' },
    ).toBe(0)
    await clickWhenStable(page, page.getByRole('tab', { name: 'Chat' }))

    const contextBody = await openLastContext(page)
    const contextText = await contextBody.textContent()
    expect(contextText).toContain('# Browser comments')
    expect(contextText).toContain('untrusted page evidence')
    expect(contextText).toContain('Comment (user-authored)')
    expect(contextText).toContain('Make the button color darker.')
    expect(await contextBody.locator('[data-context-fields] dt').allTextContents()).toContain('plugin')
    expect(await contextBody.locator('[data-context-fields] dd').allTextContents()).toContain('dsh-web-review')

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
    expect(ordered.contextIndex).toBeGreaterThan(ordered.userIndex)
    await page.close()
  })

  it('sends the composer draft with annotations through the stock input machine', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'annotation-dedicated-send'))
    await bootWithPanel(page, 'annotation-dedicated-send')
    const frame = await loadDemoPage(page)
    await annotate(page, frame, 'button.btn-primary', 'Make the button color darker.')
    await waitForAnnotationSync(page)

    const composer = page.getByPlaceholder('Message the agent')
    await composer.fill('apply this annotated draft')
    await page.getByRole('button', { name: 'Send 1' }).click()
    await expect.poll(
      async () => page.locator('[data-webview-annotation-toolbar]').count(),
      { timeout: 15_000, message: 'successful dedicated send should exit annotation mode' },
    ).toBe(0)
    expect(await composer.inputValue()).toBe('')

    await clickWhenStable(page, page.getByRole('tab', { name: 'Chat' }))
    const user = page.locator('[data-chat-flow-kind="user"]')
      .filter({ hasText: 'apply this annotated draft' }).last()
    await user.waitFor({ timeout: 30_000 })
    expect(await user.textContent()).toContain('apply this annotated draft')
    await page.close()
  })

  it('uses the fallback request when sending annotations without a draft', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'annotation-empty-draft-send'))
    await bootWithPanel(page, 'annotation-empty-draft-send')
    const frame = await loadDemoPage(page)
    await annotate(page, frame, 'button.btn-primary', 'Make the button color darker.')
    await waitForAnnotationSync(page)
    expect(await page.getByPlaceholder('Message the agent').inputValue()).toBe('')
    await page.getByRole('button', { name: 'Send 1' }).click()

    await clickWhenStable(page, page.getByRole('tab', { name: 'Chat' }))
    const user = page.locator('[data-chat-flow-kind="user"]')
      .filter({ hasText: 'Please apply the page comments to the frontend implementation.' }).last()
    await user.waitFor({ timeout: 30_000 })
    expect(await user.textContent()).toContain('Please apply the page comments to the frontend implementation.')
    await page.close()
  })

  it('clears pending comments before send without injecting a clearing context', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'annotation-clear-send'))
    await bootWithPanel(page, 'annotation-clear-send')
    const frame = await loadDemoPage(page)
    await annotate(page, frame, 'button.btn-primary', 'Make the button color darker.')
    await waitForAnnotationSync(page)

    await page.getByRole('button', { name: 'Clear all comments' }).click()
    await expect.poll(
      async () => page.locator('[data-webview-annotations]').count(),
      { timeout: 15_000, message: 'capsule hides only after pending state is cleared' },
    ).toBe(0)
    await sendViaComposer(page, 'apply')
    await clickWhenStable(page, page.getByRole('tab', { name: 'Chat' }))
    expect(await page.locator('[data-chat-flow-kind="user"]').filter({ hasText: 'apply' }).last().textContent())
      .not.toContain('# Browser comments')
    await page.close()
  })
})

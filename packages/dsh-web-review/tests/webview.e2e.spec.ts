/**
 * Real GUI + isolated preview bridge + picker + send-time context acceptance.
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
import { en } from '../src/client/locales.ts'

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
  await page.getByPlaceholder(en['panel.urlPlaceholder']).waitFor({ timeout: 15_000 })
}

async function loadDemoPage(page: Page): Promise<FrameLocator> {
  const input = page.getByPlaceholder(en['panel.urlPlaceholder'])
  await input.fill(services.demoUrl)
  await input.press('Enter')
  const frame = page.frameLocator('iframe[title="Web preview"]')
  await expect.poll(
    async () => frame.locator('h1').textContent(),
    { timeout: 20_000, message: 'isolated demo page should render' },
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
  const rows = page.locator('[data-chat-flow-kind="context"]').filter({ hasText: 'Page comments' })
  await expect.poll(async () => rows.count(), { timeout: 30_000 }).toBeGreaterThan(0)
  const row = rows.last()
  await row.getByText('Page comments', { exact: true }).click()
  const body = row.locator('[data-browser-comments-context]')
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
      row.dataset.chatFlowKind = 'assistant-step'
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
      { timeout: 20_000, message: 'assistant link target should render in Preview' },
    ).toBe('魔法 UI 演示页')
    await page.close()
  })

  it('renders Preview on a random Origin isolated from the DSH host', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'proxy-navigation'))
    await bootWithPanel(page, 'proxy-nav')
    await loadDemoPage(page)
    const frameUrl = new URL((await page.locator('iframe[title="Web preview"]').getAttribute('src')) ?? '')
    expect(frameUrl.hostname).toMatch(/^[a-f\d]{32}\.localhost$/u)
    expect(frameUrl.origin).not.toBe(new URL(services.webUrl).origin)
    expect(frameUrl.pathname).toContain('/.dsh-web-review/entry/http%3A//127.0.0.1%3A')
    await page.close()
  })

  it('rebuilds the bridge after a cross-target-Origin redirect', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'cross-origin-handoff'))
    await bootWithPanel(page, 'cross-origin-handoff')
    const input = page.getByPlaceholder(en['panel.urlPlaceholder'])
    await input.fill(`${services.demoUrl}/cross-origin-redirect`)
    await input.press('Enter')
    const frame = page.frameLocator('iframe[title="Web preview"]')
    await expect.poll(
      async () => frame.locator('h1').textContent(),
      { timeout: 20_000, message: 'cross-Origin handoff target should render' },
    ).toBe('魔法 UI 演示页')
    await expect.poll(async () => input.inputValue()).toBe(
      new URL(services.demoUrl.replace('127.0.0.1', 'localhost')).href,
    )
    await expect.poll(
      async () => page.getByRole('button', { name: 'Add page comments' }).isEnabled(),
      { timeout: 15_000 },
    ).toBe(true)
    await page.close()
  })

  it('opens the /skills popup and writes the chosen invocation into the composer', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'skills-slash-command'))
    await bootWithPanel(page, 'skills-slash-command')
    const composer = page.getByPlaceholder('Message the agent')
    await composer.fill('/skills')
    const slashMenu = page.getByRole('listbox', { name: 'Suggestions' })
    const skillsCommand = slashMenu.getByRole('option', { name: /skills/u })
    await skillsCommand.waitFor({ timeout: 10_000 })
    await skillsCommand.click()
    const skillList = page.getByRole('listbox', { name: '/skills matches' })
    await skillList.waitFor({ timeout: 10_000 })
    expect(await skillList.getByRole('option').count()).toBe(8)
    await skillList.getByRole('option', { name: /better-layout/u }).click()
    await expect.poll(async () => composer.inputValue()).toBe('/better-layout')
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

  it('navigates the DOM hierarchy from the selector, toolbar, and canvas shortcuts', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'element-hierarchy-selector'))
    await bootWithPanel(page, 'element-hierarchy-selector')
    const frame = await loadDemoPage(page)
    await page.getByRole('button', { name: 'Add page comments' }).click()
    const submit = frame.locator('button.btn-primary')
    await submit.click()
    const editor = page.locator('[data-webview-annotation-editor]')
    await editor.waitFor({ timeout: 10_000 })
    await editor.getByPlaceholder('Describe these changes…').fill('Re-anchor this review')

    await editor.getByRole('button', { name: 'Adjust' }).click()
    await editor.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('24px')
    await expect.poll(async () => submit.evaluate(element => (element as HTMLElement).style.fontSize)).toBe('24px')
    await frame.locator('body').evaluate((body) => {
      body.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', code: 'Backslash', bubbles: true, cancelable: true }))
    })
    await expect.poll(async () => submit.evaluate(element => (element as HTMLElement).style.fontSize)).toBe('')
    await expect.poll(async () => frame.locator('.card').first().getAttribute('data-dsh-wv-selected')).not.toBeNull()
    expect(await editor.getByPlaceholder('Describe these changes…').inputValue()).toBe('Re-anchor this review')

    await editor.getByRole('button', { name: 'Select', exact: true }).click()
    const selector = editor.locator('[data-webview-element-selector]')
    await selector.waitFor()
    expect(await selector.getByRole('button', { name: 'Enter child' }).textContent()).toContain('Child')
    expect(await selector.getByRole('button', { name: 'Select parent' }).textContent()).toContain('Parent')
    expect(await selector.getByRole('button', { name: 'Previous sibling' }).textContent()).toContain('Previous')
    expect(await selector.getByRole('button', { name: 'Next sibling' }).textContent()).toContain('Next')
    expect(await selector.locator('kbd').count()).toBe(4)
    expect(await selector.textContent()).not.toMatch(/个子元素|当前元素|进入下一级|回到父元素|下一兄弟/u)
    expect(await selector.locator('[aria-selected="true"]').textContent()).toContain('div')
    await selector.getByRole('button', { name: 'Next sibling' }).click()
    await expect.poll(async () => frame.locator('.card').nth(1).getAttribute('data-dsh-wv-selected')).not.toBeNull()
    await editor.getByRole('button', { name: 'Select parent' }).click()
    await expect.poll(async () => frame.locator('main').getAttribute('data-dsh-wv-selected')).not.toBeNull()
    await editor.getByRole('button', { name: 'Enter child' }).click()
    await expect.poll(async () => frame.locator('.card').first().getAttribute('data-dsh-wv-selected')).not.toBeNull()

    expect(await selector.locator('[aria-selected="true"]').textContent()).toContain('div')
    await selector.getByRole('button', { name: 'button “提交”' }).click()
    await expect.poll(async () => submit.getAttribute('data-dsh-wv-selected')).not.toBeNull()
    expect(await editor.getByPlaceholder('Describe these changes…').inputValue()).toBe('Re-anchor this review')

    await editor.getByRole('button', { name: 'Select', exact: true }).click()
    await editor.getByRole('button', { name: 'Confirm annotation' }).click()
    await waitForAnnotationSync(page)
    await page.locator('[data-webview-annotation-capsule]').hover()
    expect(await page.locator('[data-webview-annotation-details]').textContent()).toContain('button')
    await page.close()
  })

  it('scopes canvas shortcuts away from the page and keeps the tree pointer-only', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'element-keyboard-ownership'))
    await bootWithPanel(page, 'element-keyboard-ownership')
    const frame = await loadDemoPage(page)
    await frame.locator('body').evaluate(() => {
      const observed: string[] = []
      Object.defineProperty(window, '__reviewObservedKeys', { value: observed, configurable: true })
      window.addEventListener('keydown', event => { observed.push(event.key) }, true)
    })
    await page.getByRole('button', { name: 'Add page comments' }).click()
    await frame.locator('button.btn-primary').click()

    let editor = page.locator('[data-webview-annotation-editor]')
    await editor.waitFor({ timeout: 10_000 })
    await expect.poll(async () => editor.evaluate(element => element.ownerDocument.activeElement === element)).toBe(true)
    expect(await frame.locator('button.btn-primary').evaluate(element => element.ownerDocument.activeElement !== element)).toBe(true)
    const feedback = page.locator('[data-webview-navigation-feedback]')
    await feedback.waitFor()
    expect(await feedback.textContent()).toContain('Selected button')
    const selectionBox = frame.locator('.dsh-wv-selection-box')
    await selectionBox.waitFor()
    expect(await selectionBox.count()).toBe(1)
    expect(await selectionBox.getAttribute('data-visible')).toBe('')
    await expect.poll(async () => selectionBox.getAttribute('data-static')).toBeNull()
    const selectionStyle = await selectionBox.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderRadius: style.borderRadius,
        transitionDuration: style.transitionDuration,
      }
    })
    expect(selectionStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(selectionStyle.borderColor).toBe('rgb(103, 158, 254)')
    expect(selectionStyle.borderRadius).toBe('6px')
    expect(selectionStyle.transitionDuration).toContain('0.18s')
    const editorSurfaceStyle = await editor.evaluate((element) => {
      const style = getComputedStyle(element)
      return { boxShadow: style.boxShadow, clipPath: style.clipPath, overflow: style.overflow }
    })
    expect(editorSurfaceStyle.boxShadow).not.toBe('none')
    expect(editorSurfaceStyle.boxShadow.split(/,\s+(?=rgba?\()/u).length).toBeGreaterThanOrEqual(3)
    expect(editorSurfaceStyle.clipPath).toBe('none')
    expect(editorSurfaceStyle.overflow).toBe('hidden')
    expect(await frame.locator('button.btn-primary').evaluate(element => getComputedStyle(element).backgroundColor))
      .toBe('rgba(65, 118, 230, 0.1)')
    const buttonBox = await selectionBox.boundingBox()
    await editor.press('Backslash')
    await expect.poll(
      async () => selectionBox.evaluate(element => element.getAnimations().length),
      { timeout: 500, interval: 10 },
    ).toBeGreaterThan(0)
    await expect.poll(async () => frame.locator('.card').first().getAttribute('data-dsh-wv-selected')).not.toBeNull()
    expect(await feedback.getAttribute('data-action')).toBe('parent')
    expect(await feedback.textContent()).toContain('Selected div')
    await expect.poll(async () => (await selectionBox.boundingBox())?.height).not.toBe(buttonBox?.height)
    expect(await selectionBox.count()).toBe(1)
    expect(await frame.locator('body').evaluate(() => (window as unknown as { __reviewObservedKeys: string[] }).__reviewObservedKeys)).toEqual([])

    editor = page.locator('[data-webview-annotation-editor]')
    await editor.press('Tab')
    await expect.poll(async () => frame.locator('.card').nth(1).getAttribute('data-dsh-wv-selected')).not.toBeNull()
    expect(await editor.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none')
    await expect.poll(
      async () => page.locator('[data-webview-navigation-feedback]').getAttribute('data-action'),
    ).toBe('next-sibling')
    editor = page.locator('[data-webview-annotation-editor]')
    await editor.press('Shift+Tab')
    await expect.poll(async () => frame.locator('.card').first().getAttribute('data-dsh-wv-selected')).not.toBeNull()
    await expect.poll(
      async () => page.locator('[data-webview-navigation-feedback]').getAttribute('data-action'),
    ).toBe('previous-sibling')

    editor = page.locator('[data-webview-annotation-editor]')
    await editor.getByRole('button', { name: 'Select', exact: true }).click()
    const tree = editor.getByRole('tree', { name: 'Element tree' })
    const selected = tree.locator('[role="treeitem"][aria-selected="true"]')
    const firstCardTreeKey = await selected.getAttribute('data-tree-key')
    expect(await selected.getAttribute('tabindex')).toBe('-1')
    expect(await tree.locator('[role="treeitem"]:focus').count()).toBe(0)
    await editor.press('Tab')
    expect(await tree.locator('[role="treeitem"][aria-selected="true"]').count()).toBe(1)
    await expect.poll(async () => frame.locator('.card').nth(1).getAttribute('data-dsh-wv-selected')).not.toBeNull()
    expect(await editor.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none')
    expect(await page.locator('[data-webview-navigation-feedback]').count()).toBe(0)
    await editor.press('Shift+Tab')
    await expect.poll(async () => frame.locator('.card').first().getAttribute('data-dsh-wv-selected')).not.toBeNull()
    await expect.poll(
      async () => tree.locator('[role="treeitem"][aria-selected="true"]').getAttribute('data-tree-key'),
    ).toBe(firstCardTreeKey)

    await editor.press('ArrowRight')
    expect(await tree.locator('[role="treeitem"]:focus').count()).toBe(0)
    await editor.press('Enter')
    await expect.poll(async () => frame.locator('.card').first().locator('h3').getAttribute('data-dsh-wv-selected')).not.toBeNull()
    expect(await frame.locator('body').evaluate(() => (window as unknown as { __reviewObservedKeys: string[] }).__reviewObservedKeys)).toEqual([])
    await page.close()
  })

  it('uses the compact Skill disclosure and injects a missing Skill before Browser Comments', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'ui-skill-selection'))
    await bootWithPanel(page, 'ui-skill-selection')
    const frame = await loadDemoPage(page)

    const prepareSelectedAnnotation = async (comment: string): Promise<void> => {
      if (await page.locator('[data-webview-annotation-toolbar]').count() === 0) {
        await page.getByRole('button', { name: 'Add page comments' }).click()
      }
      await frame.locator('button.btn-primary').click()
      const editor = page.locator('[data-webview-annotation-editor]')
      await editor.waitFor({ timeout: 10_000 })
      await editor.getByRole('button', { name: 'Adjust' }).click()
      const skills = editor.locator('[data-webview-ui-skills]')
      const trigger = skills.getByRole('button', { name: 'Built-in Skills' })
      const triggerBox = await trigger.boundingBox()
      if (triggerBox === null) throw new Error('UI optimization Skill disclosure has no layout box')
      expect(triggerBox.height).toBeLessThanOrEqual(42)
      expect(await trigger.getAttribute('aria-expanded')).toBe('false')
      await trigger.click()
      const slashHint = skills.getByText('You can also enter /{Skill name} in the composer to invoke one Skill directly.')
      await slashHint.waitFor({ state: 'visible' })
      const skillField = skills.getByRole('button', { name: 'Choose Skills for this adjustment' })
      expect(await skillField.getAttribute('aria-expanded')).toBe('false')
      await skillField.click()
      const skillPopover = page.locator('[data-webview-ui-skill-popover]')
      expect(await skillPopover.getByRole('checkbox').count()).toBe(8)
      await skillPopover.getByRole('checkbox', { name: /better-writing/u }).check()
      await skillField.click()
      await editor.getByPlaceholder('Describe these changes…').fill(comment)
      await editor.getByRole('button', { name: 'Confirm annotation' }).click()
      await waitForAnnotationSync(page)
    }

    await prepareSelectedAnnotation('Apply the selected writing guidance.')
    await sendViaComposer(page, 'apply selected skill')
    await clickWhenStable(page, page.getByRole('tab', { name: 'Chat' }))
    const skillSources = page.locator('[data-context-source]:visible').filter({ hasText: 'better-writing' })
    await expect.poll(async () => skillSources.count(), { timeout: 30_000 }).toBeGreaterThan(0)
    const firstCommentsRow = page.locator('[data-chat-flow-kind="context"]').filter({ hasText: 'Page comments' }).first()
    await firstCommentsRow.getByText('Page comments', { exact: true }).click()
    expect(await firstCommentsRow.locator('[data-browser-comments-context]').textContent())
      .toContain('Apply the selected writing guidance.')
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
      width: getComputedStyle(element).width,
      inlineWidth: (element as HTMLElement).style.width,
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
    const editorMoveHandle = editor.getByRole('button', { name: 'Move editor' })
    // Regression: the first resize must commit while the editor is still in
    // automatic placement mode; a second gesture must build on that size.
    for (const delta of [-24, 24]) {
      const beforeInitialResize = await editor.boundingBox()
      const initialResizeHandle = await editor.locator('[data-resize-edge="se"]').boundingBox()
      if (beforeInitialResize === null || initialResizeHandle === null) {
        throw new Error('Initial resize surfaces must have layout boxes')
      }
      await page.mouse.move(
        initialResizeHandle.x + initialResizeHandle.width / 2,
        initialResizeHandle.y + initialResizeHandle.height / 2,
      )
      await page.mouse.down()
      await page.mouse.move(
        initialResizeHandle.x + initialResizeHandle.width / 2 + delta,
        initialResizeHandle.y + initialResizeHandle.height / 2 + delta,
        { steps: 3 },
      )
      await page.mouse.up()
      const afterInitialResize = await editor.boundingBox()
      if (afterInitialResize === null) throw new Error('Initially resized editor must retain a layout box')
      if (delta < 0) {
        expect(afterInitialResize.width).toBeLessThan(beforeInitialResize.width)
        expect(afterInitialResize.height).toBeLessThan(beforeInitialResize.height)
      } else {
        expect(afterInitialResize.width).toBeGreaterThan(beforeInitialResize.width)
        expect(afterInitialResize.height).toBeGreaterThan(beforeInitialResize.height)
      }
    }
    const editorBeforeMove = await editor.boundingBox()
    const editorMoveBox = await editorMoveHandle.boundingBox()
    const previewBox = await page.locator('[data-webview-preview-body]').boundingBox()
    if (editorBeforeMove === null || editorMoveBox === null || previewBox === null) {
      throw new Error('Expanded editor drag surfaces must have layout boxes')
    }
    const moveX = editorBeforeMove.x - previewBox.x > 80 ? -48 : 48
    const moveY = editorBeforeMove.y - previewBox.y > 80 ? -32 : 32
    await page.mouse.move(editorMoveBox.x + editorMoveBox.width / 2, editorMoveBox.y + editorMoveBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      editorMoveBox.x + editorMoveBox.width / 2 + moveX,
      editorMoveBox.y + editorMoveBox.height / 2 + moveY,
      { steps: 3 },
    )
    await expect.poll(async () => editor.getAttribute('data-editor-dragging')).not.toBeNull()
    await page.mouse.up()
    await expect.poll(async () => editor.getAttribute('data-editor-dragging')).toBeNull()
    const editorAfterMove = await editor.boundingBox()
    if (editorAfterMove === null) throw new Error('Moved editor must retain a layout box')
    expect({ x: Math.round(editorAfterMove.x), y: Math.round(editorAfterMove.y) })
      .not.toEqual({ x: Math.round(editorBeforeMove.x), y: Math.round(editorBeforeMove.y) })
    expect(editorAfterMove.x).toBeGreaterThanOrEqual(previewBox.x + 8)
    expect(editorAfterMove.y).toBeGreaterThanOrEqual(previewBox.y + 8)
    expect(editorAfterMove.x + editorAfterMove.width).toBeLessThanOrEqual(previewBox.x + previewBox.width - 8)
    expect(editorAfterMove.y + editorAfterMove.height).toBeLessThanOrEqual(previewBox.y + previewBox.height - 8)
    const southeastResize = editor.locator('[data-resize-edge="se"]')
    const resizeBox = await southeastResize.boundingBox()
    if (resizeBox === null) throw new Error('Expanded editor resize corner must have a layout box')
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(resizeBox.x + resizeBox.width / 2 - 40, resizeBox.y + resizeBox.height / 2 - 36, { steps: 3 })
    await expect.poll(async () => editor.getAttribute('data-editor-resizing')).not.toBeNull()
    await page.mouse.up()
    await expect.poll(async () => editor.getAttribute('data-editor-resizing')).toBeNull()
    const editorAfterResize = await editor.boundingBox()
    if (editorAfterResize === null) throw new Error('Resized editor must retain a layout box')
    expect(Math.round(editorAfterResize.width)).toBeLessThan(Math.round(editorAfterMove.width))
    expect(Math.round(editorAfterResize.height)).toBeLessThan(Math.round(editorAfterMove.height))
    expect(editorAfterResize.width).toBeGreaterThanOrEqual(320)
    expect(editorAfterResize.height).toBeGreaterThanOrEqual(300)
    expect(editorAfterResize.x + editorAfterResize.width).toBeLessThanOrEqual(previewBox.x + previewBox.width - 8)
    expect(editorAfterResize.y + editorAfterResize.height).toBeLessThanOrEqual(previewBox.y + previewBox.height - 8)
    const rememberedSize = await page.evaluate(() => {
      const raw = localStorage.getItem('dsh-web-review.editor-size.v1')
      return raw === null ? null : JSON.parse(raw) as { width: number; height: number }
    })
    expect(rememberedSize).toEqual({
      width: Math.round(editorAfterResize.width),
      height: Math.round(editorAfterResize.height),
    })
    const fontSizeField = editor.getByRole('spinbutton', { name: 'Font size', exact: true })
    expect(await fontSizeField.evaluate(element => element.getBoundingClientRect().width))
      .toBeGreaterThan(120)
    expect(await fontSizeField.evaluate((element) => {
      const editorRect = element.closest('[data-webview-annotation-editor]')!.getBoundingClientRect()
      const fieldRect = element.getBoundingClientRect()
      return fieldRect.left > editorRect.left + editorRect.width / 2
    })).toBe(true)
    const fontSizeHandle = editor.getByRole('button', { name: 'Font size · 拖动调整' })
    await fontSizeHandle.scrollIntoViewIfNeeded()
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
      if (!(active instanceof HTMLElement) || inspector === null || compose == null || footer === null || inactiveRow === null || section == null) return null
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
    await editor.getByRole('button', { name: 'Width · Choose preset', exact: true }).click()
    await page.getByRole('menuitem', { name: 'auto' }).click()

    await expect.poll(async () => heading.evaluate(element => ({
      color: getComputedStyle(element).color,
      fontSize: getComputedStyle(element).fontSize,
      inlineWidth: (element as HTMLElement).style.width,
      text: element.textContent,
    })), { timeout: 10_000 }).toEqual({
      color: 'rgb(97, 56, 56)',
      fontSize: '24px',
      inlineWidth: 'auto',
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
    const editorAfterRestore = await editor.boundingBox()
    expect(editorAfterRestore === null ? null : {
      x: Math.round(editorAfterRestore.x),
      y: Math.round(editorAfterRestore.y),
    }).toEqual({ x: Math.round(editorAfterMove.x), y: Math.round(editorAfterMove.y) })
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
      width: getComputedStyle(element).width,
      inlineWidth: (element as HTMLElement).style.width,
      text: element.textContent,
    })), { timeout: 30_000, message: 'successful send should remove every temporary preview mutation' })
      .toEqual(original)

    await clickWhenStable(page, page.getByRole('tab', { name: 'Chat' }))
    const contextText = await (await openLastContext(page)).textContent()
    expect(contextText).toContain('Use the reviewed heading treatment.')
    expect(contextText).toContain('colorrgb(255, 255, 255)→#613838')
    expect(contextText).toContain(`width${original.width}→auto`)
    expect(contextText).toContain('Text魔法 UI 演示页→Reviewed magic UI')
    expect(contextText).not.toContain('Visible viewport at edit time:')
    expect(contextText).not.toContain('font-size24px')
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
    expect(contextText).toContain('Make the button color darker.')
    expect(contextText).not.toContain('# Browser comments')
    expect(contextText).not.toContain('dsh-web-review')
    expect(contextText).not.toContain('sent')

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

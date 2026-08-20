/**
 * Better-sidebar integration, real composition: the rc.8-tested
 * dsh-better-sidebar is installed into the scratch profile, our tab is
 * registered into its + menu, and the shared engine drives the dock.
 * No fixed sleeps: readiness is asserted through the browser-visible
 * acknowledgement boundaries (sidebar mount marker, tab open, iframe load,
 * dock sync status).
 */
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { Browser, FrameLocator, Page } from 'playwright'
import { chromium, clickWhenStable, connectWorkspace, newPage, saveFailureShot, startServices, type E2EServices } from './e2e-scaffold.ts'
import { en } from '../src/client/locales.ts'

let services: E2EServices
let browser: Browser

beforeAll(async () => {
  services = await startServices({ installSidebar: true })
  browser = await chromium.launch()
}, 300_000)

afterAll(async () => {
  await browser?.close()
  await services?.stop()
}, 30_000)

async function openSidebarTab(page: Page): Promise<void> {
  // The sidebar mounts its own panel host; the panel starts collapsed and
  // the + (New tab) button lives in the tab bar.
  const panel = page.locator('[data-dsh-better-sidebar]')
  await expect.poll(async () => panel.count(), { timeout: 30_000, message: 'sidebar should mount' }).toBeGreaterThan(0)

  const expand = page.getByRole('button', { name: 'Expand sidebar' })
  if (await expand.count() > 0 && await expand.isVisible().catch(() => false)) {
    await clickWhenStable(page, expand)
  }
  const addButton = page.getByRole('button', { name: 'New tab' }).first()
  await clickWhenStable(page, addButton)
  // The tab-type menu lists registered types; pick ours by locale title.
  const previewItem = page.getByText(en['sidebar.tab'], { exact: true }).last()
  await previewItem.waitFor({ timeout: 10_000 })
  await clickWhenStable(page, previewItem)
}

describe('better-sidebar integration', () => {
  it('mounts the sidebar, opens the preview tab, and loads a page through the isolated transport', async () => {
    const page = await newPage(browser)
    await page.goto(services.webUrl)
    await connectWorkspace(page, services.workspaceRoot, 'sidebar-workspace', { expectPreviewTab: false })

    // Version pairing guard (plan Phase 4 item 4): the scratch profile must
    // resolve the rc.8-tested dsh-better-sidebar line.
    expect(services.sidebarVersion).toBe('0.14.0')
    // The conversation view contribution yields while engaged: the tablist
    // shows Chat only, never a Web Preview conversation tab.
    await expect.poll(
      async () => page.getByRole('tab', { name: 'Web Preview' }).count(),
      { timeout: 15_000, message: 'conversation view must yield while the sidebar is engaged' },
    ).toBe(0)

    await openSidebarTab(page)

    // Our preview surface renders inside the sidebar tab.
    const surface = page.locator('[data-webview-ui]')
    await surface.waitFor({ timeout: 15_000 })
    const input = surface.getByPlaceholder(en['panel.urlPlaceholder'])
    await input.waitFor({ timeout: 10_000 })

    // Navigate to the demo page through the plugin transport.
    await input.fill(services.demoUrl)
    await input.press('Enter')
    const frame: FrameLocator = page.frameLocator('iframe[title="Web preview"]')
    await expect.poll(
      async () => frame.locator('h1').textContent(),
      { timeout: 20_000, message: 'isolated demo page should render inside the sidebar tab' },
    ).toBe('魔法 UI 演示页')
  })

  it('shares one per-session engine with the dock: a pick in the sidebar tab echoes in the composer capsule', async () => {
    const page = await newPage(browser)
    await page.goto(services.webUrl)
    await connectWorkspace(page, services.workspaceRoot, 'sidebar-workspace-shared', { expectPreviewTab: false })

    await openSidebarTab(page)

    const surface = page.locator('[data-webview-ui]')
    const input = surface.getByPlaceholder(en['panel.urlPlaceholder'])
    await input.waitFor({ timeout: 15_000 })
    await input.fill(services.demoUrl)
    await input.press('Enter')
    const frame = page.frameLocator('iframe[title="Web preview"]')
    await expect.poll(
      async () => frame.locator('h1').textContent(),
      { timeout: 20_000 },
    ).toBe('魔法 UI 演示页')

    // Enter pick mode inside the sidebar tab and annotate a heading.
    const pick = page.getByRole('button', { name: 'Add page comments' })
    await expect.poll(async () => pick.isEnabled(), { timeout: 15_000 }).toBe(true)
    await pick.click()
    await frame.locator('h1').click()
    const editor = page.locator('[data-webview-annotation-editor] .dsh-wv-comment-input')
    await editor.waitFor({ timeout: 10_000 })
    await editor.fill('把标题改为「侧边栏批注演示」')
    await editor.press('Enter')
    await editor.waitFor({ state: 'detached', timeout: 10_000 })

    // The dock capsule (always mounted above the composer) observes the SAME
    // engine: one pick, acknowledged by the host.
    const capsule = page.locator('[data-webview-annotation-capsule]')
    await capsule.waitFor({ timeout: 10_000 })
    await expect.poll(
      async () => capsule.getAttribute('data-sync-status'),
      { timeout: 15_000, message: 'annotation context should be acknowledged by the host' },
    ).toBe('synced')
    await expect.poll(async () => capsule.textContent(), { timeout: 10_000 }).toContain('1')
  })

  it('routes an assistant link into the sidebar tab without activating a conversation view', async () => {
    const page = await newPage(browser)
    onTestFailed(() => saveFailureShot(page, 'sidebar-link-routing'))
    await page.goto(services.webUrl)
    await connectWorkspace(page, services.workspaceRoot, 'sidebar-link-routing', { expectPreviewTab: false })
    // Engaged: no Web Preview conversation tab exists anywhere in the run.
    await expect.poll(
      async () => page.getByRole('tab', { name: 'Web Preview' }).count(),
      { timeout: 15_000, message: 'conversation view must yield while the sidebar is engaged' },
    ).toBe(0)

    // Inject an assistant-authored link (the established e2e pattern) and
    // click it: the dock delegation must route it into the sidebar tab.
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

    // The link opens the SIDEBAR preview tab and the demo page renders
    // through the isolated transport inside it.
    const surface = page.locator('[data-webview-ui]')
    await surface.waitFor({ timeout: 15_000 })
    await expect.poll(
      async () => page.frameLocator('iframe[title="Web preview"]').locator('h1').textContent(),
      { timeout: 20_000, message: 'assistant link should render inside the sidebar tab' },
    ).toBe('魔法 UI 演示页')
    // single:true dedupe: exactly one preview surface, never a duplicate tab.
    expect(await surface.count()).toBe(1)

    // The conversation pane never activated Preview: Chat stays the active
    // conversation view tab and no Web Preview tab appears.
    await expect.poll(
      async () => page.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected'),
      { timeout: 10_000, message: 'assistant link must not activate a conversation view tab' },
    ).toBe('true')
    expect(await page.getByRole('tab', { name: 'Web Preview' }).count()).toBe(0)
    await page.close()
  })
})
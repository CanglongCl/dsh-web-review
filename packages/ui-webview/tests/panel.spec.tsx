// @vitest-environment jsdom
/** Component behavior for the preview tab and acknowledged annotation dock. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SnapshotSelectorHook, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { AnnotationDraft } from '../src/annotation-contract.ts'
import { DraftOverlayBar, type WebviewDockInjected } from '../src/client/DraftOverlayBar.tsx'
import { WebviewView } from '../src/client/WebviewView.tsx'
import type { PickItem } from '../src/client/contract.ts'
import { zh, type WebviewKey } from '../src/client/locales.ts'
import * as pickerModule from '../src/client/picker.ts'
import type { PickerSurface } from '../src/client/picker.ts'
import { createWebviewStore, type WebviewState, type WebviewStore } from '../src/client/stores.ts'

const t: Translate<WebviewKey> = (key, params) => {
  const template = zh[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => (params[name] as string | undefined) ?? match)
}

function hookFor(store: ReturnType<WebviewStore['create']>): SnapshotSelectorHook<WebviewState> {
  return (selector) => useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))
}

function pick(id = 'p1', comment = ''): PickItem {
  return {
    id,
    snapshot: {
      tagName: 'h1', id: '', className: 'hero-title', cssPath: 'h1.hero-title',
      fullPath: 'html > body > main > h1.hero-title',
      label: 'Example Domain', role: 'heading', stableClasses: ['hero-title'], anchor: null,
      outerHTML: '<h1 class="hero-title">Example Domain</h1>', textContent: 'Example Domain',
      rect: { x: 0, y: 0, width: 100, height: 50 },
      computed: {
        display: 'block', position: 'static', fontSize: '32px', color: '#000',
        backgroundColor: '#fff', margin: '0px', padding: '8px', width: '100px', height: '50px',
      },
    },
    comment,
  }
}

function mockPickerSurface(): PickerSurface {
  return {
    activate: vi.fn(),
    deactivate: vi.fn(),
    isActive: () => false,
    onPick: null,
    onCancel: null,
    onMarkClick: null,
    onCommentCommit: null,
    onCommentDismiss: null,
    commentPlaceholder: '',
    syncMarkers: vi.fn(),
    openComment: vi.fn(),
    closeComment: vi.fn(),
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: () => void } {
  let resolve!: () => void
  let reject!: () => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = () => { no(new Error('sync failed')) }
  })
  return { promise, resolve, reject }
}

/** Observe whether the plugin prevented a link while suppressing jsdom navigation afterward. */
function dispatchLink(link: HTMLAnchorElement, event: MouseEvent): boolean {
  let intercepted = false
  link.addEventListener('click', (candidate) => {
    intercepted = candidate.defaultPrevented
    candidate.preventDefault()
  }, { once: true })
  link.dispatchEvent(event)
  return intercepted
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function renderView() {
  const store = createWebviewStore().create()
  render(
    <WebviewView
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...({} as any)}
      useStore={hookFor(store)}
      actions={store.actions}
      t={t}
    />,
  )
  return store
}

function renderDock(
  sync: WebviewDockInjected['syncAnnotations'] = vi.fn(async () => {}),
) {
  const store = createWebviewStore().create()
  render(
    <DraftOverlayBar
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...({} as any)}
      useStore={hookFor(store)}
      actions={store.actions}
      syncAnnotations={sync}
      t={t}
    />,
  )
  return store
}

describe('WebviewView', () => {
  it('renders native preview controls and no plugin send UI', () => {
    renderView()
    expect(screen.getByPlaceholderText(zh['panel.urlPlaceholder'])).toBeTruthy()
    expect(screen.getByText(zh['panel.noUrl'])).toBeTruthy()
    expect(document.querySelector('iframe')).toBeNull()
    expect(document.querySelector('[data-webview-send]')).toBeNull()
  })

  it('navigates through the proxy, clears stale picks and resets the title', async () => {
    const store = renderView()
    act(() => {
      store.actions.setTitle('Old title')
      store.actions.addPick(pick())
    })
    const input = screen.getByPlaceholderText(zh['panel.urlPlaceholder'])
    fireEvent.change(input, { target: { value: 'http://localhost:5173/' } })
    expect(store.getSnapshot()).toMatchObject({
      url: '', urlDraft: 'http://localhost:5173/', title: 'Old title',
    })
    expect(store.getSnapshot().picks).toHaveLength(1)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.getSnapshot()).toMatchObject({ title: '', picks: [] })
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    expect(frame.src).toContain('webview-proxy/http%3A//localhost%3A5173/')
    expect(frame.title).toBe(zh['panel.frame'])
  })

  it('focuses a dock-selected pick through its selector', () => {
    const surface = mockPickerSurface()
    vi.spyOn(pickerModule, 'pickerOf').mockReturnValue(surface)
    const store = renderView()
    act(() => {
      store.actions.setUrl('http://localhost:5173/')
      store.actions.addPick(pick('p1', 'Make it smaller'))
    })
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    const doc = frame.contentDocument!
    doc.write('<!doctype html><html><body><h1 class="hero-title">Example Domain</h1></body></html>')
    doc.close()
    act(() => { store.actions.setFocusPickId('p1') })
    const call = surface.openComment.mock.calls[0] as [string, Element, string]
    expect(call[0]).toBe('p1')
    expect(call[1].className).toBe('hero-title')
    expect(call[2]).toBe('Make it smaller')
    expect(store.getSnapshot().focusPickId).toBeNull()
  })

  it('shows preview and context-sync failures in the error strip', () => {
    const store = renderView()
    act(() => { store.actions.setError('preview failed') })
    expect(screen.getByRole('alert').textContent).toContain('preview failed')
    act(() => { store.actions.setAnnotationSync('error', 'sync failed') })
    expect(screen.getByRole('alert').textContent).toContain('sync failed')
  })

  it('intercepts only unmodified external links outside plugin chrome', () => {
    const store = renderView()
    const link = document.createElement('a')
    link.href = 'http://external.example/page'
    document.body.appendChild(link)
    expect(dispatchLink(link, new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(true)
    expect(store.getSnapshot().url).toBe('http://external.example/page')

    const chrome = document.createElement('div')
    chrome.dataset.webviewUi = ''
    const inside = document.createElement('a')
    inside.href = 'http://external.example/ignored'
    chrome.appendChild(inside)
    document.body.appendChild(chrome)
    expect(dispatchLink(inside, new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(false)
    expect(dispatchLink(link, new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }))).toBe(false)
    link.remove()
    chrome.remove()
  })
})

describe('DraftOverlayBar', () => {
  it('renders nothing for an initial empty state', async () => {
    renderDock()
    await waitFor(() => expect(document.querySelector('[data-webview-annotations]')).toBeNull())
  })

  it('sends structured evidence and reports syncing only until host acknowledgement', async () => {
    const pending = deferred()
    const sync = vi.fn<(_draft: AnnotationDraft) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementation(() => pending.promise)
    const store = renderDock(sync)
    act(() => {
      store.actions.setUrl('https://example.com/')
      store.actions.setTitle('Example Domain')
      store.actions.addPick(pick('p1', 'Make it smaller'))
    })
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(2))
    const sent = sync.mock.calls[1]?.[0]
    expect(sent).toMatchObject({
      page: { url: 'https://example.com/', title: 'Example Domain' },
      comments: [{
        id: 'p1', comment: 'Make it smaller', role: 'heading', label: 'Example Domain',
        cssPath: 'h1.hero-title', fullPath: 'html > body > main > h1.hero-title',
      }],
    })
    expect(JSON.stringify(sent)).not.toContain('<annotation')
    expect(document.querySelector('[data-webview-annotation-capsule]')?.getAttribute('data-sync-status')).toBe('syncing')
    await act(async () => { pending.resolve(); await pending.promise })
    await waitFor(() => {
      expect(document.querySelector('[data-webview-annotation-capsule]')?.getAttribute('data-sync-status')).toBe('synced')
    })
  })

  it('opens a rich detail card on hover/focus and hands row clicks to the preview', async () => {
    const store = renderDock()
    act(() => {
      store.actions.setUrl('https://example.com/')
      store.actions.addPick(pick('p1', 'Make this heading smaller'))
    })
    const dock = await waitFor(() => document.querySelector('[data-webview-annotations]') as HTMLDivElement)
    fireEvent.mouseEnter(dock.firstElementChild as Element)
    const details = await waitFor(() => document.querySelector('[data-webview-annotation-details]') as HTMLDivElement)
    expect(details.textContent).toContain('heading')
    expect(details.textContent).toContain('Example Domain')
    expect(details.textContent).toContain('Make this heading smaller')
    expect(details.textContent).toContain('h1.hero-title')
    fireEvent.click(details.querySelector('[data-webview-annotation-row] button') as HTMLButtonElement)
    expect(store.getSnapshot().focusPickId).toBe('p1')
    expect(document.querySelector('[data-webview-annotation-details]')).toBeNull()

    const summary = document.querySelector('[data-webview-annotation-capsule] button') as HTMLButtonElement
    act(() => { summary.focus() })
    expect(document.querySelector('[data-webview-annotation-details]')).toBeTruthy()
    fireEvent.mouseLeave(dock.firstElementChild as Element)
    expect(document.querySelector('[data-webview-annotation-details]')).toBeTruthy()
    fireEvent.keyDown(dock.firstElementChild as Element, { key: 'Escape' })
    expect(document.querySelector('[data-webview-annotation-details]')).toBeNull()
  })

  it('supports per-item removal and keeps a clearing capsule until clear is acknowledged', async () => {
    const active = deferred()
    const changed = deferred()
    const clearing = deferred()
    const sync = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => active.promise)
      .mockImplementationOnce(() => changed.promise)
      .mockImplementationOnce(() => clearing.promise)
    const store = renderDock(sync)
    act(() => {
      store.actions.setUrl('https://example.com/')
      store.actions.addPick(pick('p1', 'one'))
      store.actions.addPick(pick('p2', 'two'))
    })
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(2))
    await act(async () => { active.resolve(); await active.promise })
    const dock = document.querySelector('[data-webview-annotations]') as HTMLDivElement
    fireEvent.mouseEnter(dock.firstElementChild as Element)
    const remove = await waitFor(() => document.querySelector('[data-webview-annotation-remove]') as HTMLButtonElement)
    fireEvent.click(remove)
    expect(store.getSnapshot().picks).toHaveLength(1)

    // The changed one-item snapshot is a separate commit; resolve it before clear.
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(3))
    await act(async () => { changed.resolve(); await changed.promise })
    const clear = screen.getByRole('button', { name: zh['dock.clear'] })
    fireEvent.click(clear)
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(4))
    expect(sync.mock.calls[3]?.[0]).toMatchObject({ comments: [] })
    expect(screen.getByText(zh['dock.clearing'])).toBeTruthy()
    await act(async () => { clearing.resolve(); await clearing.promise })
    await waitFor(() => expect(document.querySelector('[data-webview-annotations]')).toBeNull())
  })

  it('shows failures and retries the same snapshot on capsule click', async () => {
    const sync = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    const store = renderDock(sync)
    act(() => {
      store.actions.setUrl('https://example.com/')
      store.actions.addPick(pick('p1', 'one'))
    })
    await waitFor(() => expect(screen.getByText(zh['dock.sync.failed'])).toBeTruthy())
    expect(store.getSnapshot()).toMatchObject({ annotationSync: 'error', annotationSyncError: zh['dock.sync.error'] })
    fireEvent.click(document.querySelector('[data-webview-annotation-capsule] button') as HTMLButtonElement)
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(store.getSnapshot().annotationSync).toBe('synced'))
  })
})

// @vitest-environment jsdom
/** Component behavior for the preview tab and acknowledged annotation dock. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SnapshotSelectorHook, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { AnnotationDraft } from '../src/annotation-contract.ts'
import { DraftOverlayBar, type WebviewDockInjected } from '../src/client/DraftOverlayBar.tsx'
import { WebviewView } from '../src/client/WebviewView.tsx'
import type { PickItem } from '../src/client/contract.ts'
import { zh, type WebviewKey } from '../src/client/locales.ts'
import * as pickerModule from '../src/client/picker.ts'
import type { PickerSurface } from '../src/client/picker.ts'
import { activatePreviewTab } from '../src/client/preview-link.ts'
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

function sessionSource() {
  let snapshot = { nodes: [] } as unknown as ConversationSnapshot
  const listeners = new Set<() => void>()
  const useSession: SnapshotSelectorHook<ConversationSnapshot> = (selector) =>
    useSyncExternalStore(
      (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      () => selector(snapshot),
    )
  return {
    useSession,
    appendHuman(seq: number) {
      snapshot = {
        ...snapshot,
        nodes: [...snapshot.nodes, { kind: 'user', seq, time: 1, content: [], source: { kind: 'user' } }],
      }
      for (const listener of listeners) listener()
    },
  }
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
    syncMarkers: vi.fn(),
    select: vi.fn(),
    clearSelection: vi.fn(),
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

function renderView(
  sendAnnotationsWithoutDraft: () => Promise<void> = vi.fn(async () => {}),
  draft = '',
  submit = vi.fn(),
) {
  const store = createWebviewStore().create()
  const session = sessionSource()
  const input = {
    draft, draftRev: 0, phase: 'plain' as const, occurrences: [], queue: [],
  }
  render(
    <WebviewView
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...({} as any)}
      useStore={hookFor(store)}
      actions={store.actions}
      useSession={session.useSession}
      useInput={(selector) => selector(input)}
      inputActions={{ setDraft: vi.fn(), submit }}
      sendAnnotationsWithoutDraft={sendAnnotationsWithoutDraft}
      t={t}
    />,
  )
  return store
}

function renderDock(
  sync: WebviewDockInjected['syncAnnotations'] = vi.fn(async () => {}),
  useSession: SnapshotSelectorHook<ConversationSnapshot> = sessionSource().useSession,
  openPreview: WebviewDockInjected['openPreview'] = vi.fn(),
) {
  const store = createWebviewStore().create()
  render(
    <DraftOverlayBar
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...({} as any)}
      useStore={hookFor(store)}
      actions={store.actions}
      useSession={useSession}
      syncAnnotations={sync}
      openPreview={openPreview}
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
    expect(screen.queryByRole('button', { name: /^发送 / })).toBeNull()
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

  it('normalizes scheme-less public and local addresses before navigation', () => {
    const store = renderView()
    const input = screen.getByPlaceholderText(zh['panel.urlPlaceholder'])

    fireEvent.change(input, { target: { value: ' example.com ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.getSnapshot().url).toBe('https://example.com/')

    fireEvent.change(input, { target: { value: 'localhost:5173/demo' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.getSnapshot().url).toBe('http://localhost:5173/demo')
  })

  it('keeps invalid and non-http addresses out of the proxy', () => {
    const store = renderView()
    const input = screen.getByPlaceholderText(zh['panel.urlPlaceholder'])
    fireEvent.change(input, { target: { value: 'ftp://example.com/file' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.getSnapshot().url).toBe('')
    expect(screen.getByRole('alert').textContent).toContain(zh['panel.urlInvalid'])
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
    const call = surface.select.mock.calls[0] as [Element]
    expect(call[0].className).toBe('hero-title')
    expect((screen.getByPlaceholderText(zh['editor.comment']) as HTMLInputElement).value).toBe('Make it smaller')
    expect(store.getSnapshot().focusPickId).toBeNull()
  })

  it('keeps the shared annotation state unchanged while the editor is temporarily hidden', () => {
    const surface = mockPickerSurface()
    vi.spyOn(pickerModule, 'pickerOf').mockReturnValue(surface)
    const store = renderView()
    act(() => {
      store.actions.setUrl('http://localhost:5173/')
      store.actions.addPick(pick('p1', 'Keep this annotation'))
      store.actions.togglePickMode()
    })
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    const doc = frame.contentDocument!
    doc.write('<!doctype html><html><body><h1 class="hero-title">Example Domain</h1></body></html>')
    doc.close()
    act(() => { store.actions.setFocusPickId('p1') })

    fireEvent.click(screen.getByRole('button', { name: zh['editor.hide'] }))
    expect(store.getSnapshot().pickMode).toBe(true)
    expect(store.getSnapshot().picks).toHaveLength(1)
    expect(store.getSnapshot().picks[0]?.comment).toBe('Keep this annotation')
    fireEvent.click(screen.getByRole('button', { name: zh['editor.show'], hidden: true }))
    expect((screen.getByPlaceholderText(zh['editor.comment']) as HTMLInputElement).value).toBe('Keep this annotation')
  })

  it('shows preview and context-sync failures in the error strip', () => {
    const store = renderView()
    act(() => { store.actions.setError('preview failed') })
    expect(screen.getByRole('alert').textContent).toContain('preview failed')
    act(() => { store.actions.setAnnotationSync('error', 'sync failed') })
    expect(screen.getByRole('alert').textContent).toContain('sync failed')
  })

  it('uses the Codex-style annotation toolbar and sends only through its injected action', async () => {
    const sendAnnotationsWithoutDraft = vi.fn(async () => {})
    const store = renderView(sendAnnotationsWithoutDraft)
    act(() => {
      store.actions.setUrl('https://example.com/')
      store.actions.addPick(pick('p1', 'Tighten the spacing'))
      store.actions.setAnnotationSync('synced')
      store.actions.togglePickMode()
    })

    const toolbar = document.querySelector('[data-webview-annotation-toolbar]') as HTMLDivElement
    expect(toolbar.textContent).toContain('正在批注 · https://example.com/')
    expect(screen.getByRole('button', { name: '退出注释模式' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '清空注释' })).toBeTruthy()
    const send = screen.getByRole('button', { name: '发送 1' })
    await act(async () => { fireEvent.click(send) })
    expect(sendAnnotationsWithoutDraft).toHaveBeenCalledOnce()
    expect(store.getSnapshot().pickMode).toBe(false)
    expect(store.getSnapshot().picks).toHaveLength(1)
  })

  it('submits a non-empty composer draft through the stock input machine', () => {
    const fallback = vi.fn(async () => {})
    const submit = vi.fn()
    const store = renderView(fallback, 'ship this draft', submit)
    act(() => {
      store.actions.setUrl('https://example.com/')
      store.actions.addPick(pick('p1', 'Apply me'))
      store.actions.setAnnotationSync('synced')
      store.actions.togglePickMode()
    })
    fireEvent.click(screen.getByRole('button', { name: '发送 1' }))
    expect(submit).toHaveBeenCalledOnce()
    expect(fallback).not.toHaveBeenCalled()
    expect(store.getSnapshot().pickMode).toBe(true)
  })

  it('keeps annotation mode and comments when dedicated submission fails', async () => {
    const store = renderView(vi.fn(async () => { throw new Error('offline') }))
    act(() => {
      store.actions.setUrl('https://example.com/')
      store.actions.addPick(pick('p1', 'Keep me'))
      store.actions.setAnnotationSync('synced')
      store.actions.togglePickMode()
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送 1' })) })
    expect(store.getSnapshot()).toMatchObject({ pickMode: true, error: zh['panel.pick.sendError'] })
    expect(store.getSnapshot().picks).toHaveLength(1)
  })

  it('places external-open inside the address field and clears from annotation mode', () => {
    const store = renderView()
    act(() => { store.actions.setUrl('https://example.com/') })
    const external = screen.getByRole('link', { name: zh['panel.external'] })
    expect(external.parentElement?.className).toContain('urlField')
    act(() => {
      store.actions.addPick(pick())
      store.actions.togglePickMode()
    })
    fireEvent.click(screen.getByRole('button', { name: zh['panel.pick.clear'] }))
    expect(store.getSnapshot().picks).toEqual([])
    expect(store.getSnapshot().pickMode).toBe(true)
  })

  it('orders iframe history controls before refresh and the address field', () => {
    const store = renderView()
    act(() => { store.actions.setUrl('https://example.com/') })
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    frame.contentDocument!.write('<!doctype html><html><body></body></html>')
    frame.contentDocument!.close()
    Object.defineProperty(frame.contentWindow, 'navigation', {
      configurable: true,
      value: { canGoBack: true, canGoForward: true },
    })
    const back = vi.spyOn(frame.contentWindow!.history, 'back').mockImplementation(() => {})
    const forward = vi.spyOn(frame.contentWindow!.history, 'forward').mockImplementation(() => {})
    fireEvent.load(frame)

    const backButton = screen.getByRole('button', { name: zh['panel.back'] })
    const forwardButton = screen.getByRole('button', { name: zh['panel.forward'] })
    const refreshButton = screen.getByRole('button', { name: zh['panel.refresh'] })
    expect(backButton.compareDocumentPosition(forwardButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(forwardButton.compareDocumentPosition(refreshButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(backButton)
    fireEvent.click(forwardButton)
    expect(back).toHaveBeenCalledOnce()
    expect(forward).toHaveBeenCalledOnce()
  })

})

describe('DraftOverlayBar', () => {
  it('delegates assistant HTTP links to Preview and preserves other link gestures', () => {
    const openPreview = vi.fn()
    renderDock(undefined, undefined, openPreview)
    const assistant = document.createElement('div')
    assistant.dataset.chatFlowKind = 'assistant-step'
    const link = document.createElement('a')
    link.href = 'http://127.0.0.1:5173/review'
    assistant.appendChild(link)
    document.body.appendChild(assistant)

    expect(dispatchLink(link, new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(true)
    expect(openPreview).toHaveBeenCalledWith('http://127.0.0.1:5173/review')
    expect(dispatchLink(link, new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }))).toBe(false)

    const user = document.createElement('div')
    user.dataset.chatFlowKind = 'user'
    const userLink = link.cloneNode() as HTMLAnchorElement
    user.appendChild(userLink)
    document.body.appendChild(user)
    expect(dispatchLink(userLink, new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(false)
    expect(openPreview).toHaveBeenCalledTimes(1)
    assistant.remove()
    user.remove()
  })

  it('activates the Preview tab by its accessible label', () => {
    const chat = document.createElement('button')
    chat.setAttribute('role', 'tab')
    chat.textContent = '对话'
    const preview = document.createElement('button')
    preview.setAttribute('role', 'tab')
    preview.textContent = zh['view.tab']
    const clicked = vi.fn()
    preview.addEventListener('click', clicked)
    document.body.append(chat, preview)
    expect(activatePreviewTab(document, zh['view.tab'])).toBe(true)
    expect(clicked).toHaveBeenCalledOnce()
    chat.remove()
    preview.remove()
  })

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

  it('clears an acknowledged pending annotation after a human message is admitted', async () => {
    const session = sessionSource()
    const sync = vi.fn(async () => {})
    const store = renderDock(sync, session.useSession)
    act(() => {
      store.actions.setUrl('https://example.com/')
      store.actions.addPick(pick('p1', 'Apply this change'))
    })
    await waitFor(() => expect(store.getSnapshot().annotationSync).toBe('synced'))

    act(() => { session.appendHuman(8) })
    await waitFor(() => expect(store.getSnapshot().picks).toHaveLength(0))
    await waitFor(() => expect(document.querySelector('[data-webview-annotations]')).toBeNull())
    expect(sync.mock.calls.at(-1)?.[0].comments).toEqual([])
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

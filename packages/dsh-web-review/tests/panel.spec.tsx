// @vitest-environment jsdom
/** Component behavior for the preview tab and acknowledged annotation dock. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SnapshotSelectorHook, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import {
  AnnotationSnapshotId,
  type AnnotationDraft,
  type AnnotationSyncReceipt,
} from '../src/annotation-contract.ts'
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
    appendAnnotationContext(seq: number, snapshotId: string) {
      snapshot = {
        ...snapshot,
        nodes: [...snapshot.nodes, {
          kind: 'context', seq, time: 1, content: [{ type: 'text', text: '# Browser comments' }],
          source: { kind: 'plugin', plugin: 'dsh-web-review', snapshotId },
          provenance: { role: 'inject', label: 'dsh-web-review' }, form: null,
        }],
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
    changes: [], textChange: null, viewport: { width: 1280, height: 720 },
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

function receipt(id: string): AnnotationSyncReceipt {
  return { kind: 'ready', snapshotId: AnnotationSnapshotId(id) }
}

function successfulSync(): WebviewDockInjected['syncAnnotations'] {
  let sequence = 0
  return async (draft) => draft.comments.length === 0
    ? { kind: 'empty' }
    : receipt(`snapshot-${String(++sequence)}`)
}

function deferredReceipt(): {
  promise: Promise<AnnotationSyncReceipt>
  resolve: (receipt: AnnotationSyncReceipt) => void
  reject: () => void
} {
  let resolve!: (receipt: AnnotationSyncReceipt) => void
  let reject!: () => void
  const promise = new Promise<AnnotationSyncReceipt>((yes, no) => {
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

const storageValues = new Map<string, string>()
beforeEach(() => {
  storageValues.clear()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storageValues.get(key) ?? null,
      setItem: (key: string, value: string) => { storageValues.set(key, value) },
      removeItem: (key: string) => { storageValues.delete(key) },
      clear: () => { storageValues.clear() },
    },
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear() })

function renderView(
  sendAnnotationsWithoutDraft: () => Promise<void> = vi.fn(async () => {}),
  draft = '',
  submit = vi.fn(),
  phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting' = 'plain',
) {
  const store = createWebviewStore().create()
  const session = sessionSource()
  const input = {
    draft, draftRev: 0, phase, occurrences: [], queue: [], imageIds: [],
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
  sync: WebviewDockInjected['syncAnnotations'] = successfulSync(),
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

  it('normalizes scheme-less local addresses before navigation', () => {
    const store = renderView()
    const input = screen.getByPlaceholderText(zh['panel.urlPlaceholder'])

    fireEvent.change(input, { target: { value: ' localhost:5173 ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.getSnapshot().url).toBe('http://localhost:5173/')

    fireEvent.change(input, { target: { value: 'localhost:5173/demo' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.getSnapshot().url).toBe('http://localhost:5173/demo')
  })

  it('keeps invalid, remote and non-http addresses out of the proxy', () => {
    const store = renderView()
    const input = screen.getByPlaceholderText(zh['panel.urlPlaceholder'])
    fireEvent.change(input, { target: { value: 'ftp://example.com/file' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.getSnapshot().url).toBe('')
    expect(screen.getByRole('alert').textContent).toContain(zh['panel.urlInvalid'])
    fireEvent.change(input, { target: { value: 'https://example.com/' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.getSnapshot().url).toBe('')
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
    const call = vi.mocked(surface.select).mock.calls[0] as [Element]
    expect(call[0].className).toBe('hero-title')
    expect((screen.getByPlaceholderText(zh['editor.comment']) as HTMLInputElement).value).toBe('Make it smaller')
    expect(store.getSnapshot().focusPickId).toBeNull()
  })

  it('discards an active existing edit when that pick is removed', () => {
    const surface = mockPickerSurface()
    vi.spyOn(pickerModule, 'pickerOf').mockReturnValue(surface)
    const store = renderView()
    const existing = {
      ...pick('p1', 'Existing'),
      changes: [{ property: 'font-size' as const, before: '16px', after: '20px' }],
    }
    act(() => {
      store.actions.setUrl('http://localhost:5173/')
      store.actions.addPick(existing)
    })
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    frame.contentDocument!.write('<!doctype html><html><body><h1 class="hero-title" style="font-size: 16px">Example Domain</h1></body></html>')
    frame.contentDocument!.close()
    const heading = frame.contentDocument!.querySelector('h1') as HTMLElement
    act(() => { store.actions.setFocusPickId('p1') })
    expect(heading.style.fontSize).toBe('20px')
    fireEvent.click(screen.getByRole('button', { name: zh['editor.adjust'] }))
    fireEvent.change(screen.getByLabelText(zh['editor.property.fontSize']), { target: { value: '30px' } })
    expect(heading.style.fontSize).toBe('30px')

    act(() => { store.actions.removePick('p1') })
    expect(heading.style.fontSize).toBe('16px')
    expect(document.querySelector('[data-webview-annotation-editor]')).toBeNull()
  })

  it('discards an uncommitted editor on an explicit pick reset and on unmount', () => {
    const surface = mockPickerSurface()
    vi.spyOn(pickerModule, 'ensurePicker').mockReturnValue(surface)
    vi.spyOn(pickerModule, 'pickerOf').mockReturnValue(surface)
    const store = renderView()
    act(() => {
      store.actions.setUrl('http://localhost:5173/')
      store.actions.addPick(pick('existing', 'Keep'))
      store.actions.togglePickMode()
    })
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    frame.contentDocument!.write('<!doctype html><html><body><h1 class="hero-title">Example Domain</h1><button style="font-size: 16px">Submit</button></body></html>')
    frame.contentDocument!.close()
    fireEvent.load(frame)
    const button = frame.contentDocument!.querySelector('button') as HTMLElement
    act(() => { surface.onPick?.(button) })
    fireEvent.change(screen.getByPlaceholderText(zh['editor.comment']), { target: { value: 'Change it' } })
    fireEvent.click(screen.getByRole('button', { name: zh['editor.adjust'] }))
    fireEvent.change(screen.getByLabelText(zh['editor.property.fontSize']), { target: { value: '24px' } })
    expect(button.style.fontSize).toBe('24px')

    act(() => { store.actions.clearPicks() })
    expect(button.style.fontSize).toBe('16px')
    expect(document.querySelector('[data-webview-annotation-editor]')).toBeNull()

    act(() => { surface.onPick?.(button) })
    fireEvent.change(screen.getByPlaceholderText(zh['editor.comment']), { target: { value: 'Change it again' } })
    fireEvent.click(screen.getByRole('button', { name: zh['editor.adjust'] }))
    fireEvent.change(screen.getByLabelText(zh['editor.property.fontSize']), { target: { value: '28px' } })
    expect(button.style.fontSize).toBe('28px')
    cleanup()
    expect(button.style.fontSize).toBe('16px')
  })

  it('re-anchors an edit through hierarchy shortcuts without carrying old element diffs', () => {
    const surface = mockPickerSurface()
    vi.spyOn(pickerModule, 'ensurePicker').mockReturnValue(surface)
    vi.spyOn(pickerModule, 'pickerOf').mockReturnValue(surface)
    const store = renderView()
    act(() => {
      store.actions.setUrl('http://localhost:5173/')
      store.actions.togglePickMode()
    })
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    frame.contentDocument!.write('<!doctype html><html><body><main><div class="card"><h3>Title</h3><button style="font-size: 16px">Submit</button></div></main></body></html>')
    frame.contentDocument!.close()
    fireEvent.load(frame)
    const button = frame.contentDocument!.querySelector('button') as HTMLElement
    const card = frame.contentDocument!.querySelector('.card') as HTMLElement
    act(() => { surface.onPick?.(button) })

    const comment = screen.getByPlaceholderText(zh['editor.comment']) as HTMLInputElement
    fireEvent.change(comment, { target: { value: 'Move this annotation' } })
    fireEvent.click(screen.getByRole('button', { name: zh['editor.adjust'] }))
    fireEvent.change(screen.getByLabelText(zh['editor.property.fontSize']), { target: { value: '24px' } })
    expect(button.style.fontSize).toBe('24px')

    const moveHandle = screen.getByRole('button', { name: zh['editor.move'] }) as HTMLButtonElement
    moveHandle.setPointerCapture = vi.fn()
    moveHandle.releasePointerCapture = vi.fn()
    fireEvent.pointerDown(moveHandle, { pointerId: 11, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(moveHandle, { pointerId: 11, clientX: 132, clientY: 120 })
    fireEvent.pointerUp(moveHandle, { pointerId: 11, clientX: 132, clientY: 120 })
    const movedEditor = document.querySelector('[data-webview-annotation-editor]') as HTMLDivElement
    const movedPosition = { left: movedEditor.style.left, top: movedEditor.style.top }

    fireEvent.keyDown(frame.contentDocument!.body, { key: '\\', code: 'Backslash' })
    expect(button.style.fontSize).toBe('16px')
    expect(surface.select).toHaveBeenLastCalledWith(card)
    expect((screen.getByPlaceholderText(zh['editor.comment']) as HTMLInputElement).value).toBe('Move this annotation')
    expect(document.querySelector('[data-webview-property-inspector]')).toBeTruthy()
    const reanchoredEditor = document.querySelector('[data-webview-annotation-editor]') as HTMLDivElement
    expect({ left: reanchoredEditor.style.left, top: reanchoredEditor.style.top }).toEqual(movedPosition)

    fireEvent.click(screen.getByRole('button', { name: zh['editor.select'] }))
    expect(document.querySelector('[data-webview-element-selector] [aria-selected="true"]')?.textContent).toContain('div')
    fireEvent.click(screen.getByRole('button', { name: zh['editor.select'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['editor.confirm'] }))
    expect(store.getSnapshot().picks[0]).toMatchObject({
      comment: 'Move this annotation',
      snapshot: { tagName: 'div', className: 'card' },
      changes: [],
    })
  })

  it('remembers a committed editor size for the next opened element', () => {
    const surface = mockPickerSurface()
    vi.spyOn(pickerModule, 'ensurePicker').mockReturnValue(surface)
    vi.spyOn(pickerModule, 'pickerOf').mockReturnValue(surface)
    const store = renderView()
    act(() => {
      store.actions.setUrl('http://localhost:5173/')
      store.actions.togglePickMode()
    })
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    Object.defineProperties(frame, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
    })
    frame.contentDocument!.write('<!doctype html><html><body><button>One</button><button>Two</button></body></html>')
    frame.contentDocument!.close()
    fireEvent.load(frame)
    const [first, second] = [...frame.contentDocument!.querySelectorAll('button')]
    act(() => { surface.onPick?.(first!) })
    fireEvent.click(screen.getByRole('button', { name: zh['editor.adjust'] }))

    const handle = document.querySelector('[data-resize-edge="se"]') as HTMLDivElement
    handle.setPointerCapture = vi.fn()
    handle.hasPointerCapture = vi.fn(() => true)
    handle.releasePointerCapture = vi.fn()
    fireEvent(handle, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 500, clientY: 500 }))
    fireEvent(handle, new MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 460, clientY: 460 }))
    fireEvent(handle, new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 460, clientY: 460 }))
    expect(window.localStorage.getItem('dsh-web-review.editor-size.v1')).toBe('{"width":360,"height":520}')

    fireEvent.click(screen.getByRole('button', { name: zh['editor.cancel'] }))
    act(() => { surface.onPick?.(second!) })
    fireEvent.click(screen.getByRole('button', { name: zh['editor.adjust'] }))
    const reopened = document.querySelector('[data-webview-annotation-editor]') as HTMLDivElement
    expect(reopened.style.width).toBe('360px')
    expect(reopened.style.height).toBe('520px')
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
    act(() => { store.actions.setAnnotationSync({ status: 'error', message: 'sync failed' }) })
    expect(screen.getByRole('alert').textContent).toContain('sync failed')
  })

  it('uses the Codex-style annotation toolbar and sends only through its injected action', async () => {
    const sendAnnotationsWithoutDraft = vi.fn(async () => {})
    const store = renderView(sendAnnotationsWithoutDraft)
    act(() => {
      store.actions.setUrl('http://localhost:5173/')
      store.actions.addPick(pick('p1', 'Tighten the spacing'))
      store.actions.setAnnotationSync({ status: 'ready', snapshotId: AnnotationSnapshotId('manual-1') })
      store.actions.togglePickMode()
    })

    const toolbar = document.querySelector('[data-webview-annotation-toolbar]') as HTMLDivElement
    expect(toolbar.textContent).toContain('正在批注 · http://localhost:5173/')
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
      store.actions.setUrl('http://localhost:5173/')
      store.actions.addPick(pick('p1', 'Apply me'))
      store.actions.setAnnotationSync({ status: 'ready', snapshotId: AnnotationSnapshotId('manual-2') })
      store.actions.togglePickMode()
    })
    fireEvent.click(screen.getByRole('button', { name: '发送 1' }))
    expect(submit).toHaveBeenCalledOnce()
    expect(fallback).not.toHaveBeenCalled()
    expect(store.getSnapshot().pickMode).toBe(true)
  })

  it('settles a draft send only when the matching dock acknowledgement clears the picks', () => {
    const submit = vi.fn()
    const store = renderView(vi.fn(async () => {}), 'ship this draft', submit)
    act(() => {
      store.actions.addPick(pick('p1', 'Apply me'))
      store.actions.setAnnotationSync({ status: 'ready', snapshotId: AnnotationSnapshotId('send-1') })
      store.actions.togglePickMode()
    })
    fireEvent.click(screen.getByRole('button', { name: '发送 1' }))
    const sending = screen.getByRole('button', { name: '发送 1' }) as HTMLButtonElement
    expect(sending.disabled).toBe(true)
    expect(sending.textContent).toContain(zh['panel.pick.sending'])
    act(() => { store.actions.clearPicks() })
    expect(store.getSnapshot().pickMode).toBe(false)
  })

  it('does not enter sending for busy input phases or slash-command drafts', () => {
    const busySubmit = vi.fn()
    const busy = renderView(vi.fn(async () => {}), 'ordinary draft', busySubmit, 'submitting')
    act(() => {
      busy.actions.addPick(pick('busy', 'Apply me'))
      busy.actions.setAnnotationSync({ status: 'ready', snapshotId: AnnotationSnapshotId('busy-1') })
      busy.actions.togglePickMode()
    })
    expect((screen.getByRole('button', { name: '发送 1' }) as HTMLButtonElement).disabled).toBe(true)
    expect(busySubmit).not.toHaveBeenCalled()
    cleanup()

    const slashSubmit = vi.fn()
    const slash = renderView(vi.fn(async () => {}), '/help', slashSubmit)
    act(() => {
      slash.actions.addPick(pick('slash', 'Apply me'))
      slash.actions.setAnnotationSync({ status: 'ready', snapshotId: AnnotationSnapshotId('slash-1') })
      slash.actions.togglePickMode()
    })
    fireEvent.click(screen.getByRole('button', { name: '发送 1' }))
    expect(slashSubmit).not.toHaveBeenCalled()
    expect(slash.getSnapshot().error).toBe(zh['panel.pick.slashDraft'])
  })

  it('keeps annotation mode and comments when dedicated submission fails', async () => {
    const store = renderView(vi.fn(async () => { throw new Error('offline') }))
    act(() => {
      store.actions.setUrl('http://localhost:5173/')
      store.actions.addPick(pick('p1', 'Keep me'))
      store.actions.setAnnotationSync({ status: 'ready', snapshotId: AnnotationSnapshotId('manual-3') })
      store.actions.togglePickMode()
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送 1' })) })
    expect(store.getSnapshot()).toMatchObject({ pickMode: true, error: zh['panel.pick.sendError'] })
    expect(store.getSnapshot().picks).toHaveLength(1)
  })

  it('places external-open inside the address field and clears from annotation mode', () => {
    const store = renderView()
    act(() => { store.actions.setUrl('http://localhost:5173/') })
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
    act(() => { store.actions.setUrl('http://localhost:5173/') })
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

    const remoteLink = document.createElement('a')
    remoteLink.href = 'https://example.com/review'
    assistant.appendChild(remoteLink)
    expect(dispatchLink(remoteLink, new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(false)
    expect(openPreview).toHaveBeenCalledTimes(1)

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
    const pending = deferredReceipt()
    const sync = vi.fn<(_draft: AnnotationDraft) => Promise<AnnotationSyncReceipt>>()
      .mockResolvedValueOnce({ kind: 'empty' })
      .mockImplementation(() => pending.promise)
    const store = renderDock(sync)
    act(() => {
      store.actions.setUrl('http://localhost:5173/')
      store.actions.setTitle('Example Domain')
      store.actions.addPick(pick('p1', 'Make it smaller'))
    })
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(2))
    const sent = sync.mock.calls[1]?.[0]
    expect(sent).toMatchObject({
      page: { url: 'http://localhost:5173/', title: 'Example Domain' },
      comments: [{
        id: 'p1', comment: 'Make it smaller', role: 'heading', label: 'Example Domain',
        cssPath: 'h1.hero-title', fullPath: 'html > body > main > h1.hero-title',
      }],
    })
    expect(JSON.stringify(sent)).not.toContain('<annotation')
    expect(document.querySelector('[data-webview-annotation-capsule]')?.getAttribute('data-sync-status')).toBe('syncing')
    await act(async () => { pending.resolve(receipt('snapshot-evidence')); await pending.promise })
    await waitFor(() => {
      expect(document.querySelector('[data-webview-annotation-capsule]')?.getAttribute('data-sync-status')).toBe('synced')
    })
  })

  it('ignores unrelated human messages and clears only the matching durable annotation context', async () => {
    const session = sessionSource()
    const sync = vi.fn<(_draft: AnnotationDraft) => Promise<AnnotationSyncReceipt>>(successfulSync())
    const store = renderDock(sync, session.useSession)
    act(() => {
      store.actions.setUrl('http://localhost:5173/')
      store.actions.addPick(pick('p1', 'Apply this change'))
    })
    await waitFor(() => expect(store.getSnapshot().annotationSync).toMatchObject({ status: 'ready' }))
    const current = store.getSnapshot().annotationSync
    if (current.status !== 'ready') throw new Error('annotation snapshot was not ready')

    act(() => { session.appendHuman(8) })
    expect(store.getSnapshot().picks).toHaveLength(1)
    act(() => { session.appendAnnotationContext(9, current.snapshotId) })
    await waitFor(() => expect(store.getSnapshot().picks).toHaveLength(0))
    await waitFor(() => expect(document.querySelector('[data-webview-annotations]')).toBeNull())
    expect(sync.mock.calls.at(-1)?.[0].comments).toEqual([])
  })

  it('does not let an older A acknowledgement clear a newer ready B snapshot', async () => {
    const session = sessionSource()
    const sync = vi.fn<(_draft: AnnotationDraft) => Promise<AnnotationSyncReceipt>>(async (draft) => {
      const comment = draft.comments[0]?.comment
      if (comment === undefined) return { kind: 'empty' }
      return receipt(comment === 'A' ? 'snapshot-a' : 'snapshot-b')
    })
    const store = renderDock(sync, session.useSession)
    act(() => {
      store.actions.setUrl('http://localhost:5173/')
      store.actions.addPick(pick('p1', 'A'))
    })
    await waitFor(() => expect(store.getSnapshot().annotationSync).toMatchObject({
      status: 'ready', snapshotId: 'snapshot-a',
    }))
    act(() => { store.actions.updateComment('p1', 'B') })
    await waitFor(() => expect(store.getSnapshot().annotationSync).toMatchObject({
      status: 'ready', snapshotId: 'snapshot-b',
    }))

    act(() => { session.appendAnnotationContext(10, 'snapshot-a') })
    expect(store.getSnapshot().picks[0]?.comment).toBe('B')
    act(() => { session.appendAnnotationContext(11, 'snapshot-b') })
    await waitFor(() => expect(store.getSnapshot().picks).toHaveLength(0))
  })

  it('opens a rich detail card on hover/focus and hands row clicks to the preview', async () => {
    const store = renderDock()
    act(() => {
      store.actions.setUrl('http://localhost:5173/')
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
    const active = deferredReceipt()
    const changed = deferredReceipt()
    const clearing = deferredReceipt()
    const sync = vi.fn<(_draft: AnnotationDraft) => Promise<AnnotationSyncReceipt>>()
      .mockResolvedValueOnce({ kind: 'empty' })
      .mockImplementationOnce(() => active.promise)
      .mockImplementationOnce(() => changed.promise)
      .mockImplementationOnce(() => clearing.promise)
    const store = renderDock(sync)
    act(() => {
      store.actions.setUrl('http://localhost:5173/')
      store.actions.addPick(pick('p1', 'one'))
      store.actions.addPick(pick('p2', 'two'))
    })
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(2))
    await act(async () => { active.resolve(receipt('snapshot-active')); await active.promise })
    const dock = document.querySelector('[data-webview-annotations]') as HTMLDivElement
    fireEvent.mouseEnter(dock.firstElementChild as Element)
    const remove = await waitFor(() => document.querySelector('[data-webview-annotation-remove]') as HTMLButtonElement)
    fireEvent.click(remove)
    expect(store.getSnapshot().picks).toHaveLength(1)

    // The changed one-item snapshot is a separate commit; resolve it before clear.
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(3))
    await act(async () => { changed.resolve(receipt('snapshot-changed')); await changed.promise })
    const clear = screen.getByRole('button', { name: zh['dock.clear'] })
    fireEvent.click(clear)
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(4))
    expect(sync.mock.calls[3]?.[0]).toMatchObject({ comments: [] })
    expect(screen.getByText(zh['dock.clearing'])).toBeTruthy()
    await act(async () => { clearing.resolve({ kind: 'empty' }); await clearing.promise })
    await waitFor(() => expect(document.querySelector('[data-webview-annotations]')).toBeNull())
  })

  it('shows failures and retries the same snapshot on capsule click', async () => {
    const sync = vi.fn<(_draft: AnnotationDraft) => Promise<AnnotationSyncReceipt>>()
      .mockResolvedValueOnce({ kind: 'empty' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(receipt('snapshot-retry'))
    const store = renderDock(sync)
    act(() => {
      store.actions.setUrl('http://localhost:5173/')
      store.actions.addPick(pick('p1', 'one'))
    })
    await waitFor(() => expect(screen.getByText(zh['dock.sync.failed'])).toBeTruthy())
    expect(store.getSnapshot()).toMatchObject({
      annotationSync: { status: 'error', message: zh['dock.sync.error'] },
    })
    fireEvent.click(document.querySelector('[data-webview-annotation-capsule] button') as HTMLButtonElement)
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(store.getSnapshot().annotationSync).toMatchObject({ status: 'ready' }))
  })
})

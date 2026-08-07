// @vitest-environment jsdom
/**
 * Component spec for the webview preview tab (WebviewView) and the annotation
 * dock (DraftOverlayBar): user-visible behavior driven with realistic props
 * (real store engine, stubbed inject face and locale) — per the upstream
 * component-spec discipline.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as pickerModule from '../src/client/picker.ts'
import type { PickerSurface } from '../src/client/picker.ts'
import { createWebviewStore, type WebviewState, type WebviewStore } from '../src/client/stores.ts'
import { DraftOverlayBar } from '../src/client/DraftOverlayBar.tsx'
import { WebviewView, type WebviewInjected } from '../src/client/WebviewView.tsx'
import { zh, type WebviewKey } from '../src/client/locales.ts'
import type { SnapshotSelectorHook, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { PickItem } from '../src/client/contract.ts'

const t: Translate<WebviewKey> = (key, params) => {
  const template = zh[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => (params[name] as string | undefined) ?? match)
}

/** Real subscription hook over the store instance (the framework's useStore shape). */
function hookFor(store: ReturnType<WebviewStore['create']>): SnapshotSelectorHook<WebviewState> {
  return (selector) => useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))
}

function pick(id = 'p1', comment = ''): PickItem {
  return {
    id,
    snapshot: {
      tagName: 'div', id: '', className: 'card', cssPath: 'div.card',
      fullPath: 'html > body > main > div.card:nth-of-type(1)',
      label: 'x', role: '', stableClasses: ['card'], anchor: null,
      outerHTML: '<div class="card">x</div>', textContent: 'x',
      rect: { x: 0, y: 0, width: 100, height: 50 },
      computed: {
        display: 'block', position: 'static', fontSize: '14px', color: '#000',
        backgroundColor: '#fff', margin: '0px', padding: '8px', width: '100px', height: '50px',
      },
    },
    comment,
  }
}

/** A full picker surface stub (the component only drives it, never reads it). */
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

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function renderView(sync: ReturnType<typeof vi.fn> = vi.fn()) {
  const store = createWebviewStore().create()
  render(
    <WebviewView
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...({} as any)}
      useStore={hookFor(store)}
      actions={store.actions}
      syncAnnotations={sync as WebviewInjected['syncAnnotations']}
      t={t}
    />,
  )
  return { store, sync }
}

function renderDock() {
  const store = createWebviewStore().create()
  render(
    <DraftOverlayBar
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...({} as any)}
      useStore={hookFor(store)}
      actions={store.actions}
      syncAnnotations={vi.fn()}
      t={t}
    />,
  )
  return store
}

describe('WebviewView (preview tab)', () => {
  it('renders the URL row and the empty state without a URL', () => {
    renderView()
    expect(screen.getByPlaceholderText(zh['panel.urlPlaceholder'])).toBeTruthy()
    expect(screen.getByText(zh['panel.noUrl'])).toBeTruthy()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('navigates to the proxy URL on Enter and clears stale picks', async () => {
    const { store } = renderView()
    act(() => { store.actions.addPick(pick()) })
    const input = screen.getByPlaceholderText(zh['panel.urlPlaceholder'])
    fireEvent.change(input, { target: { value: 'http://localhost:5173/' } })
    await waitFor(() => expect(store.getSnapshot().url).toBe('http://localhost:5173/'))
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.getSnapshot().picks).toEqual([])
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    expect(frame?.src).toContain('webview-proxy/http%3A//localhost%3A5173/')
  })

  it('renders no send button or floating-panel chrome (sending rides the stock composer)', () => {
    renderView()
    expect(document.querySelector('.wv-send')).toBeNull()
    expect(document.querySelector('.wv-footer')).toBeNull()
    expect(document.querySelector('.wv-toggle')).toBeNull()
    expect(document.querySelector('.wv-resize')).toBeNull()
  })

  it('syncs the annotation XML after commits and updates', async () => {
    const { store, sync } = renderView()
    act(() => {
      store.actions.setUrl('http://localhost:5173/')
      store.actions.addPick(pick('p1', ''))
    })
    // The assembled XML is location-oriented: hint on the open tag, text
    // identity + classes + full path (the sync carries the formatAnnotation
    // output verbatim).
    await waitFor(() => {
      const last = sync.mock.calls.at(-1)?.[0] as string
      expect(last).toContain('<annotation hint="')
      expect(last).toContain('text="div &quot;x&quot;"')
      expect(last).toContain('classes="card"')
      expect(last).toContain('html > body > main > div.card:nth-of-type(1)')
    })
    act(() => { store.actions.updateComment('p1', '按钮颜色太暗') })
    await waitFor(() => {
      const last = sync.mock.calls.at(-1)?.[0] as string
      expect(last).toContain('按钮颜色太暗')
    })
  })

  it('syncs an empty string when the last pick is removed (clear passes through)', async () => {
    const { store, sync } = renderView()
    act(() => {
      store.actions.setUrl('http://localhost:5173/')
      store.actions.addPick(pick())
    })
    await waitFor(() => expect(sync.mock.calls.at(-1)?.[0]).toContain('<annotation'))
    act(() => { store.actions.removePick('p1') })
    await waitFor(() => expect(sync.mock.calls.at(-1)?.[0]).toBe(''))
  })

  it('focuses the pick when focusPickId changes (openComment on the located element)', () => {
    const surface = mockPickerSurface()
    vi.spyOn(pickerModule, 'pickerOf').mockReturnValue(surface)
    const { store } = renderView()
    act(() => {
      store.actions.setUrl('http://localhost:5173/')
      store.actions.addPick(pick('p1', '按钮颜色太暗'))
    })
    // Seed the frame document so the cssPath re-query locates the element.
    // A src'd jsdom iframe keeps an unparsed document (navigation is not
    // implemented) — document.write() forces the parse.
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    const doc = frame.contentDocument!
    doc.write('<!doctype html><html><body><div class="card">x</div></body></html>')
    doc.close()
    act(() => { store.actions.setFocusPickId('p1') })
    // The located element is the seeded frame node (realm-safe identity
    // checks — expect.any(Element) would use cross-realm instanceof).
    const call = surface.openComment.mock.calls[0] as [string, Element, string]
    expect(call[0]).toBe('p1')
    expect(call[1].className).toBe('card')
    expect(call[2]).toBe('按钮颜色太暗')
    // The signal is one-shot: consumed by the tab.
    expect(store.getSnapshot().focusPickId).toBeNull()
  })

  it('renders the error strip when the store has an error', () => {
    const { store } = renderView()
    act(() => { store.actions.setError('boom') })
    expect(screen.getByRole('alert').textContent).toContain('boom')
  })

  it('intercepts unmodified http(s) link clicks while mounted and navigates the tab', () => {
    const { store } = renderView()
    act(() => { store.actions.addPick(pick()) })
    const link = document.createElement('a')
    link.href = 'http://external.example/page'
    link.textContent = 'go'
    document.body.appendChild(link)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    expect(link.dispatchEvent(event)).toBe(false) // preventDefault ran
    expect(store.getSnapshot().url).toBe('http://external.example/page')
    expect(store.getSnapshot().picks).toEqual([])
    link.remove()
  })

  it('does not intercept clicks inside [data-webview-ui], modifier clicks, or non-http links', () => {
    renderView()
    const chrome = document.createElement('div')
    chrome.dataset.webviewUi = ''
    const inside = document.createElement('a')
    inside.href = 'http://external.example/page'
    chrome.appendChild(inside)
    document.body.appendChild(chrome)
    expect(inside.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(true)
    const link = document.createElement('a')
    link.href = 'http://external.example/page'
    document.body.appendChild(link)
    const mod = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
    expect(link.dispatchEvent(mod)).toBe(true)
    const other = document.createElement('a')
    other.href = '/internal'
    document.body.appendChild(other)
    expect(other.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(true)
    chrome.remove()
    link.remove()
    other.remove()
  })
})

describe('DraftOverlayBar (annotation dock)', () => {
  it('renders nothing without picks', () => {
    renderDock()
    expect(document.querySelector('.wv-annotations-bar')).toBeNull()
  })

  it('renders a chip per pick; chip click writes the focus signal, remove deletes', () => {
    const store = renderDock()
    act(() => { store.actions.addPick(pick('p1', '按钮颜色太暗')) })
    const bar = document.querySelector('.wv-annotations-bar') as HTMLDivElement
    expect(bar).toBeTruthy()
    expect(bar.querySelectorAll('.wv-chip')).toHaveLength(1)
    expect(bar.textContent).toContain('1')
    expect(bar.textContent).toContain('div.card')
    expect(bar.textContent).toContain('按钮颜色太暗')
    // Chip click → the preview tab's focus signal.
    fireEvent.click(bar.querySelector('.wv-chip') as HTMLDivElement)
    expect(store.getSnapshot().focusPickId).toBe('p1')
    // Hover-remove deletes the pick.
    fireEvent.click(bar.querySelector('.wv-chip-remove') as HTMLButtonElement)
    expect(store.getSnapshot().picks).toEqual([])
    expect(store.getSnapshot().focusPickId).toBe('p1') // untouched by removal
  })
})

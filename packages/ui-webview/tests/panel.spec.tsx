// @vitest-environment jsdom
/**
 * Component spec for the webview header action + floating panel: user-visible
 * behavior driven with realistic props (real store engine, stubbed inject
 * face and locale) — per the upstream component-spec discipline.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebviewStore, type WebviewState, type WebviewStore } from '../src/client/stores.ts'
import { WebviewHeaderAction, type WebviewInjected } from '../src/client/WebviewPanel.tsx'
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

function pick(): PickItem {
  return {
    id: 'p1',
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
    comment: '',
  }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function renderPanel(sendText: WebviewInjected['sendText'] = vi.fn(async () => {})) {
  const store = createWebviewStore().create()
  render(
    <WebviewHeaderAction
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...({} as any)}
      useStore={hookFor(store)}
      actions={store.actions}
      sendText={sendText}
      t={t}
    />,
  )
  return store
}

describe('WebviewHeaderAction', () => {
  it('opens the floating panel from the header toggle', () => {
    renderPanel()
    expect(screen.queryByPlaceholderText(zh['panel.urlPlaceholder'])).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['header.action'] }))
    expect(screen.getByPlaceholderText(zh['panel.urlPlaceholder'])).toBeTruthy()
  })

  it('navigates to the proxy URL on Enter and clears stale picks', async () => {
    const store = renderPanel()
    act(() => { store.actions.open('http://old/'); store.actions.addPick(pick()) })
    const input = screen.getByPlaceholderText(zh['panel.urlPlaceholder'])
    fireEvent.change(input, { target: { value: 'http://localhost:5173/' } })
    await waitFor(() => expect(store.getSnapshot().url).toBe('http://localhost:5173/'))
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.getSnapshot().url).toBe('http://localhost:5173/')
    expect(store.getSnapshot().picks).toEqual([])
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    expect(frame?.src).toContain('webview-proxy/http%3A//localhost%3A5173/')
  })

  it('closes via the close button', () => {
    const store = renderPanel()
    act(() => { store.actions.open() })
    fireEvent.click(screen.getByTitle(zh['panel.close']))
    expect(store.getSnapshot().open).toBe(false)
    expect(screen.queryByPlaceholderText(zh['panel.urlPlaceholder'])).toBeNull()
  })

  it('sends the formatted annotation and clears picks on success', async () => {
    const sendText = vi.fn(async () => {})
    const store = renderPanel(sendText)
    act(() => { store.actions.open('http://localhost:5173/'); store.actions.addPick(pick()) })
    fireEvent.click(screen.getByRole('button', { name: zh['panel.send'] }))
    await waitFor(() => expect(sendText).toHaveBeenCalledTimes(1))
    const message = sendText.mock.calls[0]?.[0] as string
    // Location-oriented XML: text identity + classes + full path (no anchor in the fixture).
    expect(message).toContain(zh['annotation.open'])
    expect(message).toContain('text="div &quot;x&quot;"')
    expect(message).toContain('classes="card"')
    expect(message).toContain('html > body > main > div.card:nth-of-type(1)')
    expect(store.getSnapshot().picks).toEqual([])
  })

  it('preserves picks and surfaces the error when sending fails', async () => {
    const sendText = vi.fn(async () => { throw new Error('network down') })
    const store = renderPanel(sendText)
    act(() => { store.actions.open('http://localhost:5173/'); store.actions.addPick(pick()) })
    fireEvent.click(screen.getByRole('button', { name: zh['panel.send'] }))
    await waitFor(() => expect(store.getSnapshot().error).not.toBeNull())
    expect(store.getSnapshot().error).toContain('network down')
    expect(store.getSnapshot().picks).toHaveLength(1)
    expect(store.getSnapshot().sending).toBe(false)
  })

  it('disables send without picks', () => {
    const store = renderPanel()
    act(() => { store.actions.open() })
    expect((screen.getByRole('button', { name: zh['panel.send'] }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('drags the splitter to resize the preview/annotations split', () => {
    // jsdom lacks PointerEvent and pointer capture/layout: stub the capture
    // surface and dispatch real MouseEvents (clientY is a MouseEvent member).
    const proto = Element.prototype as unknown as Record<string, unknown>
    const prevCapture = proto.setPointerCapture
    const prevHas = proto.hasPointerCapture
    const prevRelease = proto.releasePointerCapture
    proto.setPointerCapture = () => {}
    proto.hasPointerCapture = () => true
    proto.releasePointerCapture = () => {}
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 500 } as DOMRect)
    try {
      const store = renderPanel()
      act(() => { store.actions.open('http://localhost:5173/') })
      const separator = screen.getByRole('separator')
      expect(Number(separator.getAttribute('aria-valuenow'))).toBe(60)
      fireEvent(separator, new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientY: 100 }))
      fireEvent(separator, new MouseEvent('pointermove', { bubbles: true, cancelable: true, clientY: 150 }))
      // +50px over a 500px body moves the split by 0.1.
      expect(store.getSnapshot().split).toBeCloseTo(0.7, 5)
      fireEvent(separator, new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientY: 150 }))
    } finally {
      proto.setPointerCapture = prevCapture
      proto.hasPointerCapture = prevHas
      proto.releasePointerCapture = prevRelease
    }
  })

  it('intercepts unmodified http(s) link clicks while open and opens them in the panel', () => {
    const store = renderPanel()
    act(() => { store.actions.open() })
    const link = document.createElement('a')
    link.href = 'http://external.example/page'
    link.textContent = 'go'
    document.body.appendChild(link)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    const dispatched = link.dispatchEvent(event)
    expect(dispatched).toBe(false) // preventDefault ran
    expect(store.getSnapshot().url).toBe('http://external.example/page')
    link.remove()
  })

  it('does not intercept clicks when the panel is closed', () => {
    renderPanel()
    const link = document.createElement('a')
    link.href = 'http://external.example/page'
    document.body.appendChild(link)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    expect(link.dispatchEvent(event)).toBe(true)
    link.remove()
  })

  it('does not intercept modifier clicks or non-http links', () => {
    const store = renderPanel()
    act(() => { store.actions.open() })
    const link = document.createElement('a')
    link.href = 'http://external.example/page'
    document.body.appendChild(link)
    const mod = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
    expect(link.dispatchEvent(mod)).toBe(true)
    const other = document.createElement('a')
    other.href = '/internal'
    document.body.appendChild(other)
    expect(other.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(true)
    link.remove()
    other.remove()
  })
})

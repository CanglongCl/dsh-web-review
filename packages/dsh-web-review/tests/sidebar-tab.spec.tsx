// @vitest-environment jsdom
/**
 * Sidebar tab registration + the foreign-render wrapper: descriptor
 * contract, urlTarget claiming, and the shared-engine rendering path.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SnapshotSelectorHook, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { BetterSidebarService, TabDescriptor } from 'dsh-better-sidebar/client/service'
import { AnnotationSnapshotId, type AnnotationDraft } from '../src/annotation-contract.ts'
import { PREVIEW_ENTRY_PREFIX, type PreviewSessionDescriptor, type PreviewSessionId } from '../src/preview-contract.ts'
import { encodeTarget } from '../src/proxy-url.ts'
import { DraftOverlayBar } from '../src/client/DraftOverlayBar.tsx'
import type { PickItem } from '../src/client/contract.ts'
import { createWebviewStore } from '../src/client/stores.ts'
import { createWebviewStoreRegistry } from '../src/client/webview-session-store.ts'
import { isPreviewLink, registerSidebarPreviewTab } from '../src/client/sidebar/tab.tsx'
import { SidebarPreviewTab, type SidebarTabDeps } from '../src/client/sidebar/SidebarPreviewTab.tsx'
import { zh, type WebviewKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const t: Translate<WebviewKey> = (key, params) => {
  const template = zh[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => (params[name] as string | undefined) ?? match)
}

function fakeService(record: { descriptors: TabDescriptor[] }): BetterSidebarService {
  return {
    registerTab: vi.fn((descriptor: TabDescriptor) => {
      record.descriptors.push(descriptor)
      return () => {
        const index = record.descriptors.indexOf(descriptor)
        if (index !== -1) record.descriptors.splice(index, 1)
      }
    }),
    registerFileViewer: vi.fn(() => () => {}),
    getTabs: vi.fn(() => record.descriptors),
    getFileViewers: vi.fn(() => []),
    getTab: vi.fn((id: string) => record.descriptors.find(d => d.id === id)),
    isTabEnabled: vi.fn(() => true),
    isViewerEnabled: vi.fn(() => true),
    matchFileViewer: vi.fn(() => undefined),
    openTab: vi.fn(),
    version: '0.14.0',
    features: ['urlTarget'],
  } as unknown as BetterSidebarService
}

function engagement(service: BetterSidebarService, hasUrlTarget = true) {
  return { service, version: '0.14.0', features: ['urlTarget'], hasUrlTarget }
}

/** A session face fake: the observable half + projections used by the wrapper. */
function sessionFaceFake() {
  let snapshot = { nodes: [] } as never
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    projections: {
      faceOf: vi.fn(() => ({
        getSnapshot: () => undefined,
        subscribe: () => () => {},
      })),
    },
  } as never
}

function inputFake() {
  let state = { draft: '', phase: 'plain', draftRev: 0, occurrences: [], queue: [], imageIds: [] } as never
  const listeners = new Set<() => void>()
  return {
    state: {
      getSnapshot: () => state,
      subscribe: (fn: () => void) => {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      },
    },
    setDraft: vi.fn(),
    addImages: vi.fn(() => true),
    removeImage: vi.fn(),
    pruneImages: vi.fn(),
    submit: vi.fn(),
  } as never
}

function fakeCtx(sessionId: string, face: ReturnType<typeof sessionFaceFake>, input: ReturnType<typeof inputFake>) {
  const sessions = {
    scope: vi.fn(() => ({})),
    sessionOf: vi.fn(() => face),
    binding: vi.fn(() => ({ session: face })),
  }
  const conversation = {
    input: { for: vi.fn(() => input) },
  }
  return {
    // The wrapper reads services through ctx.get (the sidebar framework's
    // context carries no inject declarations).
    get: vi.fn((name: string) => {
      if (name === 'sessions') return sessions
      if (name === 'conversation') return conversation
      return undefined
    }),
    _sessionId: sessionId,
  } as never
}

function deps() {
  const webviewStores = createWebviewStoreRegistry(createWebviewStore())
  return {
    t,
    webviewStores,
    buildViewFace: vi.fn(() => ({
      sendAnnotationsWithoutDraft: vi.fn(async () => {}),
      returnToChat: vi.fn(),
      createPreviewSession: (target: string): Promise<PreviewSessionDescriptor> => {
        const sessionId = ('0'.repeat(31) + '1') as never
        const frameOrigin = `http://${sessionId as string}.localhost:43123`
        return Promise.resolve({
          sessionId,
          channel: sessionId,
          frameOrigin,
          frameUrl: `${frameOrigin}${PREVIEW_ENTRY_PREFIX}${encodeTarget(target)}`,
          targetOrigin: new URL(target).origin,
          snapshotsEnabled: true,
        } as unknown as PreviewSessionDescriptor)
      },
      releasePreviewSessions: vi.fn(async () => {}),
      uploadPageSnapshot: vi.fn(async () => ({ kind: 'saved' as const, snapshotId: 'snap-1' as never, dir: '/tmp/x' })),
    })),
  } as unknown as SidebarTabDeps
}

describe('isPreviewLink', () => {
  it('claims credential-free absolute HTTP(S) URLs only', () => {
    expect(isPreviewLink(new URL('https://example.com/'))).toBe(true)
    expect(isPreviewLink(new URL('http://localhost:5173/'))).toBe(true)
    expect(isPreviewLink(new URL('ftp://example.com/'))).toBe(false)
    expect(isPreviewLink(new URL('javascript:void(0)'))).toBe(false)
    expect(isPreviewLink(new URL('https://user:pass@example.com/'))).toBe(false)
  })

  it('covers the address-space edges the transport accepts', () => {
    // Plain localhost without a port, explicit ports, query/hash tails.
    expect(isPreviewLink(new URL('http://localhost'))).toBe(true)
    expect(isPreviewLink(new URL('http://localhost:8080/path?q=1#h'))).toBe(true)
    expect(isPreviewLink(new URL('https://example.com:8443/a'))).toBe(true)
    expect(isPreviewLink(new URL('http://example.com:80/a?b=c#d'))).toBe(true)
    // URL parsing normalizes an uppercase scheme; the claim must still hold.
    expect(isPreviewLink(new URL('HTTPS://EXAMPLE.COM/'))).toBe(true)
    // A username alone is still credentials and must be rejected.
    expect(isPreviewLink(new URL('https://user@example.com/'))).toBe(false)
    // Every non-HTTP(S) scheme is out, not just ftp/javascript.
    expect(isPreviewLink(new URL('mailto:dev@example.com'))).toBe(false)
    expect(isPreviewLink(new URL('data:text/html,hi'))).toBe(false)
    expect(isPreviewLink(new URL('file:///etc/passwd'))).toBe(false)
    expect(isPreviewLink(new URL('ws://example.com/'))).toBe(false)
    expect(isPreviewLink(new URL('wss://example.com/'))).toBe(false)
  })
})

describe('registerSidebarPreviewTab', () => {
  it('registers the preview tab descriptor with the planned shape', () => {
    const record = { descriptors: [] as TabDescriptor[] }
    const service = fakeService(record)
    // cordis ctx.effect runs the factory immediately and collects its disposer.
    const ctx = { effect: (factory: () => () => void) => factory() } as never
    const dispose = registerSidebarPreviewTab(ctx, engagement(service), deps())
    expect(record.descriptors).toHaveLength(1)
    expect(service.registerTab).toHaveBeenCalledTimes(1)
    const descriptor = record.descriptors[0]!
    expect(descriptor.id).toBe('dsh-web-review:preview')
    expect(descriptor.order).toBe(60)
    expect(descriptor.single).toBe(true)
    expect(descriptor.title).toBeTypeOf('function')
    // The title is a locale thunk, not a frozen string.
    expect((descriptor.title as () => string)()).toBe(zh['sidebar.tab'])
    expect(descriptor.icon).not.toBeNull()
    // The registered predicate mirrors isPreviewLink for both claims and
    // rejections — a positive-only check would pass with an always-true fn.
    expect(descriptor.urlTarget).toBeTypeOf('function')
    expect(descriptor.urlTarget!(new URL('https://example.com/'))).toBe(true)
    expect(descriptor.urlTarget!(new URL('http://localhost:5173/'))).toBe(true)
    expect(descriptor.urlTarget!(new URL('ftp://example.com/'))).toBe(false)
    expect(descriptor.urlTarget!(new URL('https://user:pass@example.com/'))).toBe(false)
    dispose()
    expect(record.descriptors).toHaveLength(0)
  })

  it('omits urlTarget when the service lacks the capability', () => {
    const record = { descriptors: [] as TabDescriptor[] }
    const service = fakeService(record)
    // cordis ctx.effect runs the factory immediately and collects its disposer.
    const ctx = { effect: (factory: () => () => void) => factory() } as never
    registerSidebarPreviewTab(ctx, engagement(service, false), deps())
    expect(record.descriptors[0]!.urlTarget).toBeUndefined()
    expect(service.registerTab).toHaveBeenCalledTimes(1)
  })
})

describe('SidebarPreviewTab', () => {
  it('renders the preview surface through the shared per-session engine', async () => {
    const d = deps()
    const sessionId = 'session-1'
    const face = sessionFaceFake()
    const input = inputFake()
    const ctx = fakeCtx(sessionId, face, input)

    // Pre-write the SHARED engine: the wrapper must render that URL because
    // the dock/view/sidebar all resolve the same per-session instance.
    const sharedEngine = d.webviewStores.instanceFor(sessionId as never)
    sharedEngine.actions.setUrl('https://example.com/')

    render(
      <SidebarPreviewTab
        ctx={ctx}
        scope={{ sessionId } as never}
        store={undefined as never}
        tab={{ id: 'dsh-web-review:preview', type: 'dsh-web-review:preview', title: '网页预览' } as never}
        visible={true}
        deps={d}
      />,
    )
    expect(screen.getByPlaceholderText(zh['panel.urlPlaceholder'])).toBeTruthy()
    // The iframe loaded the URL from the shared engine.
    await waitFor(() => {
      const frame = document.querySelector('iframe') as HTMLIFrameElement | null
      expect(frame).not.toBeNull()
      expect(frame!.src).toContain(encodeTarget('https://example.com/'))
    })
    // The wrapper resolved the SAME engine instance the dock would use.
    expect(sharedEngine.getSnapshot().url).toBe('https://example.com/')
  })

  it('navigates from the address bar through the plugin transport', async () => {
    const d = deps()
    const sessionId = 'session-2'
    const ctx = fakeCtx(sessionId, sessionFaceFake(), inputFake())
    render(
      <SidebarPreviewTab
        ctx={ctx}
        scope={{ sessionId } as never}
        store={undefined as never}
        tab={{} as never}
        visible={true}
        deps={d}
      />,
    )
    const bar = screen.getByPlaceholderText(zh['panel.urlPlaceholder'])
    await act(async () => {
      fireEvent.change(bar, { target: { value: 'https://demo.example/' } })
      fireEvent.keyDown(bar, { key: 'Enter' })
    })
    await waitFor(() => {
      const frame = document.querySelector('iframe') as HTMLIFrameElement | null
      expect(frame).not.toBeNull()
      expect(frame!.src).toContain(encodeTarget('https://demo.example/'))
    })
  })

  it('does not render while the session scope is unavailable', () => {
    const d = deps()
    const ctx = {
      get: vi.fn(() => undefined),
    } as never
    const { container } = render(
      <SidebarPreviewTab
        ctx={ctx}
        scope={{ sessionId: 'ghost' } as never}
        store={undefined as never}
        tab={{} as never}
        visible={true}
        deps={d}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('keeps the surface mounted while the tab is inactive (visible is a render gate only)', () => {
    // The plan contracts that `visible === false` never unmounts the surface:
    // state (URL, picks) and the iframe must survive tab switches.
    const d = deps()
    const sessionId = 'session-inactive'
    const ctx = fakeCtx(sessionId, sessionFaceFake(), inputFake())
    const engine = d.webviewStores.instanceFor(sessionId as never)
    engine.actions.setUrl('https://example.com/')
    const { container } = render(
      <SidebarPreviewTab
        ctx={ctx}
        scope={{ sessionId } as never}
        store={undefined as never}
        tab={{} as never}
        visible={false}
        deps={d}
      />,
    )
    expect(container.querySelector('[data-webview-ui]')).not.toBeNull()
    expect(screen.getByPlaceholderText(zh['panel.urlPlaceholder'])).toBeTruthy()
  })

  it('yields the surface when the session scope disappears and restores it on return', () => {
    const d = deps()
    const sessionId = 'session-flicker'
    const face = sessionFaceFake()
    const input = inputFake()
    let scopeAvailable = true
    const sessions = {
      scope: vi.fn(() => (scopeAvailable ? {} : undefined)),
      sessionOf: vi.fn(() => face),
      binding: vi.fn(() => (scopeAvailable ? { session: face } : undefined)),
      list: { subscribe: vi.fn(), getSnapshot: vi.fn() },
    }
    const ctx = {
      get: vi.fn((name: string) => {
        if (name === 'sessions') return sessions
        if (name === 'conversation') return { input: { for: vi.fn(() => input) } }
        return undefined
      }),
    } as never
    const props = {
      ctx,
      scope: { sessionId } as never,
      store: undefined as never,
      tab: {} as never,
      deps: d,
    }
    const { rerender } = render(<SidebarPreviewTab {...props} visible={true} />)
    expect(screen.getByPlaceholderText(zh['panel.urlPlaceholder'])).toBeTruthy()

    // The session leaves the live list (service disappears mid-use).
    scopeAvailable = false
    rerender(<SidebarPreviewTab {...props} visible={false} />)
    expect(document.querySelector('[data-webview-ui]')).toBeNull()

    // The session returns: the surface must come back.
    scopeAvailable = true
    rerender(<SidebarPreviewTab {...props} visible={true} />)
    expect(screen.getByPlaceholderText(zh['panel.urlPlaceholder'])).toBeTruthy()
  })

  it('shares one engine between the dock capsule and the sidebar surface', async () => {
    const d = deps()
    const sessionId = 'session-shared'
    const face = sessionFaceFake()
    const input = inputFake()
    const ctx = fakeCtx(sessionId, face, input)
    const engine = d.webviewStores.instanceFor(sessionId as never)
    const syncAnnotations = vi.fn(async (draft: AnnotationDraft) => (
      draft.comments.length === 0
        ? { kind: 'empty' as const }
        : { kind: 'ready' as const, snapshotId: AnnotationSnapshotId('snap-shared') }
    ))
    const openPreview = vi.fn()
    render(
      <>
        <DraftOverlayBar
          {...({} as any)}
          useWebviewStore={hookForSource(engine)}
          actions={engine.actions}
          useSession={hookForSource(face)}
          syncAnnotations={syncAnnotations}
          openPreview={openPreview}
          t={t}
        />
        <SidebarPreviewTab
          ctx={ctx}
          scope={{ sessionId } as never}
          store={undefined as never}
          tab={{} as never}
          visible={true}
          deps={d}
        />
      </>,
    )
    // One engine drives both surfaces: a pick written through the registry
    // engine appears in the dock capsule AND the sidebar iframe.
    act(() => {
      engine.actions.setUrl('https://example.com/')
      engine.actions.addPick(pickItem('p1', 'Tighten this heading'))
    })
    await waitFor(() => {
      expect(document.querySelector('[data-webview-annotation-capsule]')).not.toBeNull()
    })
    expect(document.querySelector('[data-webview-annotation-capsule]')?.getAttribute('data-sync-status')).toBe('synced')
    expect(document.querySelector('[data-webview-annotation-capsule]')?.textContent).toContain('1')
    // The sidebar iframe renders the same URL from the same engine.
    await waitFor(() => {
      const frame = document.querySelector('iframe') as HTMLIFrameElement | null
      expect(frame).not.toBeNull()
      expect(frame!.src).toContain(encodeTarget('https://example.com/'))
    })
  })

  // KNOWN PRODUCTION BUG (see report): SidebarPreviewTab builds the injected
  // face during render (SidebarPreviewTab.tsx:81), so any sidebar-framework
  // re-render (tab activation toggles `visible`, panel toggles, session
  // switches) rebuilds the face; WebviewView's bridge effect depends on the
  // releasePreviewSessions identity (WebviewView.tsx:377) and then disposes
  // the live bridge and revokes the isolated preview session (iframe reload).
  // The fix is to memoize the face per sessionId (useMemo on buildViewFace);
  // this test flips to a plain `it` and must pass after that fix.
  it('keeps the injected face stable across sidebar re-renders so the preview session survives', async () => {
    // The sidebar framework re-renders tab components on tab activation /
    // panel toggles / session switches. The wrapper must NOT rebuild the
    // injected face per render: WebviewView's bridge effect depends on
    // releasePreviewSessions identity, so a fresh face per render disposes
    // the live bridge and revokes the isolated preview session (iframe
    // reload). This pins the wrapper's face memoization contract.
    const d = deps()
    // Production buildViewFace returns NEW function closures per call, so
    // every face rebuild changes releasePreviewSessions identity. Mirror that:
    // the face ships a fresh wrapper that funnels into one shared spy.
    const sharedRelease = vi.fn(async (_ids: readonly PreviewSessionId[]) => {})
    d.buildViewFace = vi.fn(() => ({
      sendAnnotationsWithoutDraft: vi.fn(async () => {}),
      returnToChat: vi.fn(),
      createPreviewSession: (target: string): Promise<PreviewSessionDescriptor> => {
        const sessionId = ('0'.repeat(31) + '1') as never
        const frameOrigin = 'http://' + String(sessionId) + '.localhost:43123'
        return Promise.resolve({
          sessionId,
          channel: sessionId,
          frameOrigin,
          frameUrl: frameOrigin + PREVIEW_ENTRY_PREFIX + encodeTarget(target),
          targetOrigin: new URL(target).origin,
          snapshotsEnabled: true,
        } as unknown as PreviewSessionDescriptor)
      },
      releasePreviewSessions: (sessionIds: readonly PreviewSessionId[]) => {
        sharedRelease(sessionIds)
        return Promise.resolve()
      },
      uploadPageSnapshot: vi.fn(async () => ({ kind: 'saved' as const, snapshotId: 'snap-1' as never, dir: '/tmp/x' })),
    }))
    const sessionId = 'session-stable'
    const ctx = fakeCtx(sessionId, sessionFaceFake(), inputFake())
    const engine = d.webviewStores.instanceFor(sessionId as never)
    const props = {
      ctx,
      scope: { sessionId } as never,
      store: undefined as never,
      tab: {} as never,
      deps: d,
    }
    const { rerender } = render(<SidebarPreviewTab {...props} visible={true} />)
    act(() => { engine.actions.setUrl('https://example.com/') })
    await waitFor(() => {
      expect(document.querySelector('iframe')).not.toBeNull()
    })

    // A sidebar framework re-render (tab activation toggles `visible`).
    rerender(<SidebarPreviewTab {...props} visible={false} />)
    // The face must be built once per session; rebuilding it tears the bridge
    // down (sharedRelease would be called with the live session ids).
    expect(sharedRelease).not.toHaveBeenCalled()
    expect(d.buildViewFace).toHaveBeenCalledTimes(1)
  })
})

/** Bind one selector hook over a bare observable source (renderer parity). */
function hookForSource<T>(source: { getSnapshot(): T; subscribe(listener: () => void): () => void }): SnapshotSelectorHook<T> {
  return (selector) => useSyncExternalStore(source.subscribe, () => selector(source.getSnapshot()))
}

function pickItem(id: string, comment: string): PickItem {
  return {
    id,
    snapshot: {
      tagName: 'h1', id: '', className: 'hero-title', cssPath: 'h1.hero-title',
      fullPath: 'html > body > main > h1.hero-title',
      label: 'Example Domain', role: 'heading', stableClasses: ['hero-title'], anchor: null,
      inToolChrome: false,
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
// @vitest-environment jsdom
/**
 * Apply-level integration for the better-sidebar seam: the full boot wiring
 * in src/client/index.ts. Pins the boot-coupling rule (never a cordis inject
 * on betterSidebar), the view-tab yield/restore swap, the dock/view inject
 * factories sharing ONE per-session engine, the openPreview routing to
 * betterSidebar.openTab, and the live-session pruning subscription.
 */
import { describe, expect, it, vi } from 'vitest'
import type { BetterSidebarService, TabDescriptor } from 'dsh-better-sidebar/client/service'
import { apply } from '../src/client/index.ts'
import { zh, type WebviewKey } from '../src/client/locales.ts'
import { PREVIEW_TAB_ID } from '../src/client/sidebar/tab.tsx'
import type { WebviewDockInjected } from '../src/client/DraftOverlayBar.tsx'
import type { WebviewViewInjected } from '../src/client/WebviewView.tsx'

const t: (key: WebviewKey, params?: Record<string, string>) => string = (key, params) => {
  const template = zh[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
}

function fakeSidebarService(): BetterSidebarService & {
  descriptors: TabDescriptor[]
  registerTab: ReturnType<typeof vi.fn>
  openTab: ReturnType<typeof vi.fn>
} {
  const descriptors: TabDescriptor[] = []
  const openTab = vi.fn()
  return {
    descriptors,
    openTab,
    registerTab: vi.fn((descriptor: TabDescriptor) => {
      descriptors.push(descriptor)
      return () => {
        const index = descriptors.indexOf(descriptor)
        if (index !== -1) descriptors.splice(index, 1)
      }
    }),
    version: '0.14.0',
    features: ['urlTarget'],
    getTabs: vi.fn(() => descriptors),
    getTab: vi.fn((id: string) => descriptors.find(d => d.id === id)),
    isTabEnabled: vi.fn(() => true),
    registerFileViewer: vi.fn(() => () => {}),
    getFileViewers: vi.fn(() => []),
    isViewerEnabled: vi.fn(() => true),
    matchFileViewer: vi.fn(() => undefined),
  } as unknown as BetterSidebarService & {
    descriptors: TabDescriptor[]
    registerTab: ReturnType<typeof vi.fn>
    openTab: ReturnType<typeof vi.fn>
  }
}

interface FakeApplyHarness {
  ctx: never
  /** Emit internal/status on the fake context (fiber status transitions). */
  emitStatus(): void
  /** Provide a service; returns the unprovide disposer. */
  provide(name: string, value: unknown): () => void
  /** Registrations recorded by the fake slot runtime. */
  registrations: Array<{ slot: string; count: number; dispose: () => void; opts?: Record<string, unknown> }>
  /** cordis inject declarations the plugin made (fiber topology). */
  injected: string[][]
  /** Effects the fake ctx.effect ran; the last is the sidebar watch disposer. */
  effects: Array<() => void>
  closeDetails: ReturnType<typeof vi.fn>
  /** Change the live session list and notify the pruning subscription. */
  setLiveIds(ids: string[]): void
  /** Registrations of one slot that are still live. */
  liveRegistrations(slot: string): Array<{ slot: string; count: number; dispose: () => void; opts?: Record<string, unknown> }>
}

function fakeApplyContext(options: { service?: BetterSidebarService; sessionIds?: string[] } = {}): FakeApplyHarness {
  const services = new Map<string, unknown>(
    options.service === undefined ? [] : [['betterSidebar', options.service] as const],
  )
  const statusListeners = new Set<() => void>()
  let liveIds = options.sessionIds ?? []
  let listListener: (() => void) | null = null
  const registrations: Array<{ slot: string; count: number; dispose: () => void; opts?: Record<string, unknown> }> = []
  const effects: Array<() => void> = []
  const injected: string[][] = []
  const closeDetails = vi.fn()
  const commandUi = { register: vi.fn() }

  const ctx = {
    get: (name: string): unknown => services.get(name),
    provide: (name: string, value: unknown): (() => void) => {
      services.set(name, value)
      return () => { services.delete(name) }
    },
    on: (name: string, listener: () => void): (() => void) => {
      if (name === 'internal/status') {
        statusListeners.add(listener)
        return () => { statusListeners.delete(listener) }
      }
      return () => {}
    },
    emit: (name: string): void => {
      if (name === 'internal/status') for (const listener of statusListeners) listener()
    },
    effect: (factory: () => (() => void) | void): (() => void) | void => {
      const disposer = factory()
      effects.push(disposer ?? (() => {}))
      return disposer
    },
    inject: (deps: string[], callback: (scope: unknown) => void): (() => void) => {
      injected.push([...deps])
      callback(ctx)
      return () => {}
    },
    slots: {
      // The runtime's inject runs the callback per declaration lifetime and
      // uses the register disposer as its own; mirror that so one slot gets
      // exactly one live record.
      inject: (_slot: string, callback: () => () => void): (() => void) => callback(),
      register: (opts: Record<string, unknown>, _component: unknown): (() => void) => {
        const slot = String(opts.name)
        const record = { slot, count: 1, dispose: (): void => { record.count -= 1 }, opts }
        registrations.push(record)
        return () => { record.count -= 1 }
      },
    },
    locale: {
      register: vi.fn(),
      bind: () => t,
    },
    sessions: {
      list: {
        getSnapshot: () => ({ ids: [...liveIds] }),
        subscribe: vi.fn((listener: () => void) => {
          listListener = listener
          return () => { listListener = null }
        }),
      },
      scope: vi.fn(() => ({
        get: (name: string) => (name === 'conversation' ? { send: vi.fn() } : undefined),
      })),
      sessionOf: vi.fn(() => undefined),
    },
    conversation: { input: { for: vi.fn(() => undefined) } },
    layout: { closeDetails },
    commandUi,
  }

  return {
    ctx: ctx as never,
    emitStatus: (): void => { ctx.emit('internal/status') },
    provide: (name: string, value: unknown): (() => void) => ctx.provide(name, value),
    registrations,
    injected,
    effects,
    closeDetails,
    setLiveIds: (ids: string[]): void => {
      liveIds = ids
      listListener?.()
    },
    liveRegistrations: (slot: string) => registrations.filter(r => r.slot === slot && r.count > 0),
  }
}

type DockInject = (sessionId: unknown) => WebviewDockInjected & { hooks: { webviewStore: unknown }; actions: unknown }
type ViewInject = (sessionId: unknown) => WebviewViewInjected & { hooks: { webviewStore: unknown }; actions: unknown }

function dockInjectOf(h: FakeApplyHarness): DockInject {
  const registration = h.liveRegistrations('conversation.input.dock')[0]
  if (registration === undefined || registration.opts === undefined) throw new Error('dock registration missing')
  return registration.opts.inject as DockInject
}

function viewInjectOf(h: FakeApplyHarness): ViewInject {
  const registration = h.liveRegistrations('conversation.view')[0]
  if (registration === undefined || registration.opts === undefined) throw new Error('view registration missing')
  return registration.opts.inject as ViewInject
}

function renderConversationTab(label: string): { clicked: ReturnType<typeof vi.fn>; remove: () => void } {
  const tab = document.createElement('button')
  tab.setAttribute('role', 'tab')
  tab.textContent = label
  const clicked = vi.fn()
  tab.addEventListener('click', clicked)
  document.body.appendChild(tab)
  return { clicked, remove: () => { tab.remove() } }
}

describe('apply: better-sidebar wiring', () => {
  it('never injects betterSidebar into the fiber topology', () => {
    const h = fakeApplyContext()
    apply(h.ctx)
    // The only cordis inject is the declared commandUi; a betterSidebar
    // inject would PENDING the fiber when the sidebar is absent and fail
    // the whole web boot sweep.
    expect(h.injected.map(deps => deps[0])).toEqual(['commandUi'])
    expect(h.injected.flat()).not.toContain('betterSidebar')
  })

  it('registers the dock and the conversation view when the sidebar is absent', () => {
    const h = fakeApplyContext()
    apply(h.ctx)
    expect(h.liveRegistrations('conversation.input.dock')).toHaveLength(1)
    expect(h.liveRegistrations('conversation.view')).toHaveLength(1)
    // rc.8 removed the conversation.chat.contextview chain slot; the
    // browser-comments fold renders through the harness ContextInjectionRow.
    expect(h.closeDetails).not.toHaveBeenCalled()
  })

  it('yields the conversation view while engaged and restores it on disengagement', () => {
    const h = fakeApplyContext()
    apply(h.ctx)
    expect(h.liveRegistrations('conversation.view')).toHaveLength(1)
    const service = fakeSidebarService()
    const unprovide = h.provide('betterSidebar', service)
    h.emitStatus()
    // Engaged: the view contribution is disposed (yield) and the tab is registered.
    expect(h.liveRegistrations('conversation.view')).toHaveLength(0)
    expect(service.registerTab).toHaveBeenCalledTimes(1)
    expect(service.descriptors).toHaveLength(1)
    // Disengaged: the tab is unregistered and the view contribution restored.
    unprovide()
    h.emitStatus()
    expect(service.descriptors).toHaveLength(0)
    expect(h.liveRegistrations('conversation.view')).toHaveLength(1)
  })

  it('shares one engine between the dock and view inject factories per session', () => {
    const h = fakeApplyContext()
    apply(h.ctx)
    const dockInject = dockInjectOf(h)
    const viewInject = viewInjectOf(h)
    const dockA = dockInject('session-a')
    const dockA2 = dockInject('session-a')
    const viewA = viewInject('session-a')
    const dockB = dockInject('session-b')
    // The dock inject factory returns the plugin-owned registry engine
    // (observable through the hooks compartment) and its baked actions.
    expect(dockA.hooks.webviewStore).toBe(dockA2.hooks.webviewStore)
    expect(dockA.actions).toBe((dockA.hooks.webviewStore as { actions: unknown }).actions)
    // The conversation-view factory resolves the SAME engine for the session.
    expect(viewA.hooks.webviewStore).toBe(dockA.hooks.webviewStore)
    // Per-session separation holds.
    expect(dockB.hooks.webviewStore).not.toBe(dockA.hooks.webviewStore)
  })

  it('routes openPreview into openTab while engaged and to the conversation tab otherwise', () => {
    const h = fakeApplyContext()
    apply(h.ctx)
    const dockInject = dockInjectOf(h)
    const openPreview = dockInject('session-a').openPreview
    const chat = renderConversationTab(zh['view.tab'])

    // Absent sidebar: the fallback activates the conversation view tab and
    // writes the normalized URL into the shared engine.
    openPreview('https://example.com/')
    expect(chat.clicked).toHaveBeenCalledTimes(1)
    expect(h.closeDetails).toHaveBeenCalledTimes(1)
    expect((dockInject('session-a').hooks.webviewStore as { getSnapshot(): { url: string } }).getSnapshot().url)
      .toBe('https://example.com/')

    // Engaged sidebar: the same gesture routes to openTab with the preview
    // tab id and never touches the conversation tab.
    const service = fakeSidebarService()
    h.provide('betterSidebar', service)
    h.emitStatus()
    openPreview('http://localhost:5173/demo')
    expect(service.openTab).toHaveBeenCalledTimes(1)
    expect(service.openTab).toHaveBeenCalledWith({ type: PREVIEW_TAB_ID, url: 'http://localhost:5173/demo' })
    expect(chat.clicked).toHaveBeenCalledTimes(1)

    // An invalid URL routes nowhere: no store write, no tab activation.
    const opensBefore = service.openTab.mock.calls.length
    openPreview('ftp://example.com/file')
    expect(service.openTab.mock.calls.length).toBe(opensBefore)
    expect(chat.clicked).toHaveBeenCalledTimes(1)
    chat.remove()
  })

  it('reverts to the conversation tab when the service disappears again', () => {
    const h = fakeApplyContext()
    apply(h.ctx)
    const dockInject = dockInjectOf(h)
    const openPreview = dockInject('session-a').openPreview
    const chat = renderConversationTab(zh['view.tab'])
    const service = fakeSidebarService()
    const unprovide = h.provide('betterSidebar', service)
    h.emitStatus()
    openPreview('https://example.com/')
    expect(service.openTab).toHaveBeenCalledTimes(1)
    expect(chat.clicked).not.toHaveBeenCalled()
    // The sidebar goes away: routing falls back to the conversation tab.
    unprovide()
    h.emitStatus()
    openPreview('https://example.com/two')
    expect(service.openTab).toHaveBeenCalledTimes(1)
    expect(chat.clicked).toHaveBeenCalledTimes(1)
    chat.remove()
  })

  it('prunes per-session engines when the live session list shrinks', () => {
    const h = fakeApplyContext({ sessionIds: ['session-a', 'session-b'] })
    apply(h.ctx)
    const dockInject = dockInjectOf(h)
    const engineA = dockInject('session-a').hooks.webviewStore
    const engineB = dockInject('session-b').hooks.webviewStore
    // The session list shrinks: the pruning subscription must drop engine A.
    h.setLiveIds(['session-b'])
    expect(dockInject('session-a').hooks.webviewStore).not.toBe(engineA)
    // The surviving session keeps its engine identity.
    expect(dockInject('session-b').hooks.webviewStore).toBe(engineB)
  })

  it('stops watching once the fiber effect disposer runs', () => {
    const h = fakeApplyContext()
    apply(h.ctx)
    expect(h.liveRegistrations('conversation.view')).toHaveLength(1)
    // Fiber unload: the sidebar-watch effect disposer (watch.dispose) runs.
    const watchDispose = h.effects.at(-1)
    expect(typeof watchDispose).toBe('function')
    watchDispose?.()
    const service = fakeSidebarService()
    h.provide('betterSidebar', service)
    h.emitStatus()
    // No re-registration during unload; the view contribution stays.
    expect(service.registerTab).not.toHaveBeenCalled()
    expect(h.liveRegistrations('conversation.view')).toHaveLength(1)
  })
})

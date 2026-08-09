/**
 * ui-webview browser half: the "预览" conversation view tab (proxied iframe +
 * in-iframe element picker + annotation echo layer) and the "注释" dock above
 * the composer, sharing one webview store instance. Structured annotation
 * snapshots commit immediately to the node half's `/webview-annotations`
 * route, where they become separately logged plugin context.
 *
 * Composition: two registrations into ui-conversation slots — the
 * 'conversation.view' tab (id 'webview', order 20) and the
 * 'conversation.input.dock' annotation strip (id 'webview-annotations',
 * order 15) — both declaring the SAME apply-constructed store handle, so the
 * framework resolves one instance per session: the tab and the dock share one
 * pick list (ui-conversation's chatStore multi-registration pattern). The
 * dock immediately commits each full structured snapshot to the node face;
 * the acknowledged node face records it through `agent.inject` as a separate
 * context message. The 'conversation' service edge is the load-order seam: both slots are declared
 * by ui-conversation's apply, so waiting on the service orders this apply
 * after the declaring one (upstream checklist rule for cross-package slot
 * registration). The inject face stays thin: one serialized, acknowledged
 * per-session annotation snapshot sync.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge (the view/dock entries).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en, zh, type WebviewKey } from './locales.ts'
import { createWebviewStore } from './stores.ts'
import { WebviewView } from './WebviewView.tsx'
import { DraftOverlayBar, type WebviewDockInjected } from './DraftOverlayBar.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The webview preview tab and annotation dock copy. */
    webview: WebviewKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'webview' as const

/** Required services (cordis fiber inject — activation waits on them). */
export const inject = ['slots', 'conversation', 'locale']

/**
 * Build one per-session annotation sync. Requests are queued in change order,
 * identical queued/acknowledged snapshots are deduplicated, and the returned
 * promise settles only after the host has committed `agent.inject`.
 */
export function makeSyncAnnotations(sessionId: SessionId): WebviewDockInjected['syncAnnotations'] {
  let tail: Promise<void> = Promise.resolve()
  let lastAcknowledged: string | undefined
  let lastScheduledBody: string | undefined
  let lastScheduledTask: Promise<void> | undefined
  return (draft) => {
    const body = JSON.stringify({ sessionId, ...draft })
    if (lastScheduledTask === undefined && body === lastAcknowledged) return Promise.resolve()
    if (body === lastScheduledBody && lastScheduledTask !== undefined) return lastScheduledTask
    const task = tail.catch(() => undefined).then(async () => {
      if (body === lastAcknowledged) return
      const response = await fetch('/webview-annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (!response.ok) throw new Error(`annotation context sync failed (${response.status})`)
      lastAcknowledged = body
    })
    tail = task.catch(() => undefined)
    lastScheduledBody = body
    lastScheduledTask = task
    task.then(
      () => {
        if (lastScheduledTask === task) {
          lastScheduledBody = undefined
          lastScheduledTask = undefined
        }
      },
      () => {
        if (lastScheduledTask === task) {
          lastScheduledBody = undefined
          lastScheduledTask = undefined
        }
      },
    )
    return task
  }
}

/** The plugin body: dictionaries and the two shared-store registrations. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-webview: dictionaries')

  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration; components read the standard `t` seat instead.
  const t = ctx.locale.bind(NS)

  // Apply-time construction keeps store identity bound to this fiber; both
  // registrations declare the same handle (one instance per session — the
  // preview tab and the annotation dock share one pick list).
  const webviewStore = createWebviewStore()

  ctx.effect(() => ctx.slots.register({
    name: 'conversation.view',
    id: 'webview',
    order: 20,
    label: () => t('view.tab'),
    locale: NS,
    store: webviewStore,
  }, WebviewView), 'ui-webview: preview tab')
  ctx.effect(() => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'webview-annotations',
    order: 15,
    locale: NS,
    store: webviewStore,
    inject: (sessionId: SessionId): WebviewDockInjected => ({
      syncAnnotations: makeSyncAnnotations(sessionId),
    }),
  }, DraftOverlayBar), 'ui-webview: annotations dock')
}

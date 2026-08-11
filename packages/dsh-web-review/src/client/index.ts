/**
 * dsh-web-review browser half: the "网页预览" conversation view tab (proxied iframe +
 * in-iframe element picker + annotation echo layer) and the "注释" dock above
 * the composer, sharing one webview store instance. Structured annotation
 * snapshots commit immediately to the node half's `/webview-annotations`
 * route as pending state, then become separately logged plugin context only
 * when the stock composer prompt is admitted.
 *
 * Composition: two registrations into ui-conversation slots — the
 * 'conversation.view' tab (id 'webview', order 20) and the
 * 'conversation.input.dock' annotation strip (id 'webview-annotations',
 * order 15) — both declaring the SAME apply-constructed store handle, so the
 * framework resolves one instance per session: the tab and the dock share one
 * pick list (ui-conversation's chatStore multi-registration pattern). The
 * dock immediately prepares each full structured snapshot on the node face;
 * pre-step admission later appends it to the accepted message batch. Slot
 * declaration order is independent, so each contribution uses `slots.inject`
 * and follows the declaring ui-conversation entry across reloads. The inject
 * face stays thin: one serialized, acknowledged per-session annotation sync.
 */
import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge (the view/dock entries).
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import {
  annotationSyncReceiptOf,
  type AnnotationSyncReceipt,
} from '../annotation-contract.ts'
import { en, zh, type WebviewKey } from './locales.ts'
import { createWebviewStore } from './stores.ts'
import { WebviewView, type WebviewViewInjected } from './WebviewView.tsx'
import { DraftOverlayBar, type WebviewDockInjected } from './DraftOverlayBar.tsx'
import { normalizePreviewUrl } from './navigation-url.ts'
import { activatePreviewTab } from './preview-link.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The webview preview tab and annotation dock copy. */
    webview: WebviewKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'webview' as const

/** Required services (cordis fiber inject — activation waits on them). */
export const inject = ['slots', 'conversation', 'layout', 'locale', 'sessions']

function isClientSessions(value: unknown): value is ISessions {
  if (typeof value !== 'object' || value === null) return false
  try {
    return typeof Reflect.get(value, 'scope') === 'function'
  } catch {
    return false
  }
}

/** Resolve the public conversation face through one session scope. */
function scopedConversation(ctx: ClientContext, sessionId: SessionId): IConversation {
  // Harness declares a host SessionStore under the same Cordis service key;
  // verify the browser service shape before narrowing the merged type.
  const sessions: unknown = ctx.sessions
  if (!isClientSessions(sessions)) throw new Error('dsh-web-review: client sessions service unavailable')
  const scope = sessions.scope(sessionId)
  if (scope === undefined) throw new Error(`dsh-web-review: session "${sessionId}" resolved no scope`)
  const conversation = scope.get('conversation')
  if (conversation === undefined) throw new Error('dsh-web-review: conversation service unavailable through session scope')
  return conversation
}

/**
 * Build one per-session annotation sync. Requests are queued in change order,
 * identical queued/acknowledged snapshots are deduplicated, and the returned
 * promise settles after the host has stored the pending snapshot.
 */
export function makeSyncAnnotations(sessionId: SessionId): WebviewDockInjected['syncAnnotations'] {
  let tail: Promise<void> = Promise.resolve()
  let lastAcknowledged: { body: string; receipt: AnnotationSyncReceipt } | undefined
  let lastScheduledBody: string | undefined
  let lastScheduledTask: Promise<AnnotationSyncReceipt> | undefined
  return (draft) => {
    const body = JSON.stringify({ sessionId, ...draft })
    const clearing = draft.comments.length === 0
    if (lastScheduledTask === undefined && body === lastAcknowledged?.body) {
      return Promise.resolve(lastAcknowledged.receipt)
    }
    if (body === lastScheduledBody && lastScheduledTask !== undefined) return lastScheduledTask
    const task = tail.catch(() => undefined).then(async () => {
      if (body === lastAcknowledged?.body) return lastAcknowledged.receipt
      const response = await fetch('/webview-annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (!response.ok) {
        // Clearing an absent live agent is already satisfied. The host keeps
        // returning 404 so this route cannot be used as a session-state oracle;
        // non-empty snapshots still surface the unavailable-agent failure.
        if (!(clearing && response.status === 404)) {
          throw new Error(`annotation context sync failed (${response.status})`)
        }
        const receipt = { kind: 'empty' as const }
        lastAcknowledged = { body, receipt }
        return receipt
      }
      const value: unknown = await response.json()
      const receipt = annotationSyncReceiptOf(value)
      if (receipt === undefined) throw new Error('annotation context sync returned an invalid receipt')
      lastAcknowledged = { body, receipt }
      return receipt
    })
    tail = task.then(() => undefined, () => undefined)
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
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-web-review: dictionaries')

  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration; components read the standard `t` seat instead.
  const t = ctx.locale.bind(NS)

  // Apply-time construction keeps store identity bound to this fiber; both
  // registrations declare the same handle (one instance per session — the
  // preview tab and the annotation dock share one pick list).
  const webviewStore = createWebviewStore()

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'webview',
    order: 20,
    label: () => t('view.tab'),
    locale: NS,
    store: webviewStore,
    inject: (sessionId: SessionId): WebviewViewInjected => ({
      sendAnnotationsWithoutDraft: () => scopedConversation(ctx, sessionId).send(t('panel.pick.defaultPrompt')),
    }),
  }, WebviewView))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'webview-annotations',
    order: 15,
    locale: NS,
    store: webviewStore,
    inject: (sessionId: SessionId, actions: BoundActions<typeof webviewStore>): WebviewDockInjected => ({
      syncAnnotations: makeSyncAnnotations(sessionId),
      openPreview: (url) => {
        const normalized = normalizePreviewUrl(url)
        if (normalized === undefined) return
        actions.setError(null)
        actions.setUrl(normalized)
        actions.setTitle('')
        actions.clearPicks()
        ctx.layout.closeDetails()
        activatePreviewTab(document, t('view.tab'))
      },
    }),
  }, DraftOverlayBar))
}

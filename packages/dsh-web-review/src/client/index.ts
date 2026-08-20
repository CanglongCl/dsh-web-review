/**
 * dsh-web-review browser half: the "网页预览" conversation view tab (isolated
 * Preview frame + message bridge) and the "注释" dock above
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
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { BakedActions } from '@deepseek-ai/dsh-client-ui-slots'
import {
  annotationSyncReceiptOf,
  type AnnotationSyncReceipt,
} from '../annotation-contract.ts'
import {
  PREVIEW_CLIENT_HEADER,
  PREVIEW_CLIENT_HEADER_VALUE,
  PREVIEW_SESSIONS_PATH,
  previewSessionDescriptorOf,
  type PreviewSessionDescriptor,
  type PreviewSessionId,
} from '../preview-contract.ts'
import { en, zh, type WebviewKey } from './locales.ts'
import { createWebviewStore } from './stores.ts'
import type { WebviewActions, WebviewState } from './stores.ts'
import { createWebviewStoreRegistry } from './webview-session-store.ts'
import { WebviewView, type WebviewViewInjected, type WebviewStoreShare } from './WebviewView.tsx'
import { DraftOverlayBar, type WebviewDockInjected, type WebviewDockStoreShare } from './DraftOverlayBar.tsx'
import { normalizePreviewUrl } from './navigation-url.ts'
import { activateConversationTab } from './preview-link.ts'
import { createSidebarIntegrationState, type SidebarIntegrationState } from './sidebar/integration.ts'
import { watchBetterSidebar } from './sidebar/detect.ts'
import { PREVIEW_TAB_ID, registerSidebarPreviewTab } from './sidebar/tab.tsx'
import type { SidebarTabDeps } from './sidebar/SidebarPreviewTab.tsx'
import { isUiSkillName, UI_SKILLS, type UiSkillName } from '../ui-skills.ts'
import { makeUploadSnapshot } from './snapshot-sync.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The webview preview tab and annotation dock copy. */
    webview: WebviewKey
  }
  interface SlotMap {
    // rc.8 removed the conversation.chat.contextview chain slot; the
    // browser-comments fold now renders through the harness's own
    // ContextInjectionRow (opaque body). Keep the namespace declaration.
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'webview' as const

/** Required services (cordis fiber inject — activation waits on them). */
export const inject = ['slots', 'conversation', 'layout', 'locale', 'sessions', 'commandUi']

const SKILL_DESCRIPTION_KEYS: Record<UiSkillName, WebviewKey> = {
  'better-ui': 'editor.skills.betterUi',
  'better-typography': 'editor.skills.betterTypography',
  'better-layout': 'editor.skills.betterLayout',
  'better-writing': 'editor.skills.betterWriting',
  'better-accessibility': 'editor.skills.betterAccessibility',
  'better-colors': 'editor.skills.betterColors',
  'better-interface': 'editor.skills.betterInterface',
  'interface-review': 'editor.skills.interfaceReview',
}

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

/** Replace the active composer draft with one explicit Skill invocation. */
export function setUiSkillDraft(ctx: Pick<ClientContext, 'sessions'>, sessionId: SessionId, name: string): void {
  if (!isUiSkillName(name)) throw new Error(`unknown UI optimization Skill "${name}"`)
  const sessions = ctx.sessions as unknown as ISessions
  const sessionScope = sessions.scope(sessionId)
  if (sessionScope === undefined) throw new Error(`dsh-web-review: session "${sessionId}" resolved no scope`)
  const conversation = sessionScope.get('conversation')
  if (conversation === undefined) throw new Error('dsh-web-review: conversation service unavailable through session scope')
  conversation.input.for(sessionScope).setDraft(`/${name}`)
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

/** Create one node-owned isolated Origin for a requested page. */
export async function createPreviewSession(target: string): Promise<PreviewSessionDescriptor> {
  const response = await fetch(PREVIEW_SESSIONS_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [PREVIEW_CLIENT_HEADER]: PREVIEW_CLIENT_HEADER_VALUE,
    },
    body: JSON.stringify({ target }),
  })
  if (!response.ok) throw new Error(`preview session creation failed (${String(response.status)})`)
  const descriptor = previewSessionDescriptorOf(await response.json() as unknown)
  if (descriptor === undefined) throw new Error('preview session creation returned an invalid descriptor')
  return descriptor
}

/** Release every Origin minted during one iframe's navigation chain. */
export async function releasePreviewSessions(sessionIds: readonly PreviewSessionId[]): Promise<void> {
  if (sessionIds.length === 0) return
  const response = await fetch(PREVIEW_SESSIONS_PATH, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      [PREVIEW_CLIENT_HEADER]: PREVIEW_CLIENT_HEADER_VALUE,
    },
    body: JSON.stringify({ sessionIds }),
    keepalive: true,
  })
  if (!response.ok) throw new Error(`preview session release failed (${String(response.status)})`)
}

/**
 * Open one normalized preview URL through the active surface: the sidebar
 * tab when the better-sidebar integration is engaged, otherwise the
 * conversation-pane view tab. Shared by the dock's openPreview and the
 * assistant-link delegation (which routes through the dock callback).
 */
function openPreviewUrl(
  ctx: ClientContext,
  t: (key: WebviewKey) => string,
  actions: BakedActions<WebviewState, WebviewActions>,
  integration: SidebarIntegrationState,
  url: string,
): void {
  const normalized = normalizePreviewUrl(url)
  if (normalized === undefined) return
  actions.setError(null)
  actions.setUrl(normalized)
  actions.setTitle('')
  actions.clearPicks()
  ctx.layout.closeDetails()
  const service = integration.service
  if (service !== null && service.isTabEnabled(PREVIEW_TAB_ID)) {
    service.openTab({ type: PREVIEW_TAB_ID, url: normalized })
    return
  }
  // The sidebar tab may be disabled in its settings (openTab no-ops) — never
  // let the link die after the dock preventDefaulted it.
  activateConversationTab(document, t('view.tab'))
}

/**
 * The plugin body: dictionaries, the plugin-owned per-session engine axis,
 * and the three surfaces (dock, conversation view, optional sidebar tab).
 *
 * The webview store travels through the inject face instead of the store
 * seat: the slot framework caches engines privately per handle x scope and
 * foreign render contexts (the sidebar tab) cannot reach them, so the
 * plugin owns one per-session engine registry shared by the dock, the
 * conversation view, and the sidebar tab. Better-sidebar is a runtime
 * capability probe (ctx.get + internal/status), never a cordis inject — an
 * unsatisfied inject would PENDING the fiber and fail the whole web boot.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-web-review: dictionaries')

  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration; components read the standard `t` seat instead.
  const t = ctx.locale.bind(NS)

  // Apply-time construction keeps store identity bound to this fiber; the
  // registry gives every surface (dock / view / sidebar tab) ONE engine per
  // session — the pick list, URL, and sync state are shared by construction.
  const webviewStore = createWebviewStore()
  const webviewStores = createWebviewStoreRegistry(webviewStore)

  // Sidebar engagement state read by the openPreview routing.
  const integration = createSidebarIntegrationState()

  // Prune per-session engines when their session leaves the live list.
  // The host SessionStore and the client runtime share the `sessions`
  // service key; narrow through the runtime face like scopedConversation.
  const sessions = ctx.sessions as unknown as ISessions
  ctx.effect(() => sessions.list.subscribe(() => {
    webviewStores.pruneAbsent(sessions.list.getSnapshot().ids)
  }), 'dsh-web-review: webview engine pruning')

  /** Session-bound injected face shared by the view and the sidebar tab. */
  const buildViewFace = (sessionId: SessionId): WebviewViewInjected => ({
    sendAnnotationsWithoutDraft: () => scopedConversation(ctx, sessionId).send(t('panel.pick.defaultPrompt')),
    returnToChat: () => { activateConversationTab(document, t('view.chat')) },
    createPreviewSession,
    releasePreviewSessions,
    uploadPageSnapshot: makeUploadSnapshot(sessionId),
  })

  ctx.inject(['commandUi'], (scope: ClientContext) => {
    scope.effect(() => scope.commandUi.register({
      name: 'skills',
      description: t('command.skills.description'),
      available: () => true,
      ui: {
        kind: 'popupSelect',
        options: () => Promise.resolve(UI_SKILLS.map(skill => ({
          id: skill.name,
          label: skill.name,
          detail: t(SKILL_DESCRIPTION_KEYS[skill.name]),
        }))),
        onSelect: (option, session) => {
          setUiSkillDraft(scope, session.sessionId, option.id)
        },
      },
    }), 'dsh-web-review: /skills contribution')
  })

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'webview-annotations',
    order: 15,
    locale: NS,
    inject: (sessionId: SessionId): WebviewDockInjected & WebviewDockStoreShare => {
      const engine = webviewStores.instanceFor(sessionId)
      return {
        hooks: { webviewStore: engine },
        actions: engine.actions,
        syncAnnotations: makeSyncAnnotations(sessionId),
        openPreview: (url) => openPreviewUrl(ctx, t, engine.actions, integration, url),
      }
    },
  }, DraftOverlayBar))

  /**
   * Re-registrable conversation-view contribution: while the sidebar
   * integration is engaged it yields (exactly one preview surface per
   * session), and it is restored when the service disappears.
   */
  const registerViewContribution = (): (() => void) =>
    ctx.slots.inject('conversation.view', () => ctx.slots.register({
      name: 'conversation.view',
      id: 'webview',
      order: 20,
      label: () => t('view.tab'),
      locale: NS,
      inject: (sessionId: SessionId): WebviewViewInjected & WebviewStoreShare => {
        const engine = webviewStores.instanceFor(sessionId)
        return { hooks: { webviewStore: engine }, actions: engine.actions, ...buildViewFace(sessionId) }
      },
    }, WebviewView))

  let viewDispose: (() => void) = registerViewContribution()
  let sidebarDispose: (() => void) | null = null

  const sidebarDeps: SidebarTabDeps = { t, webviewStores, buildViewFace }
  ctx.effect(() => watchBetterSidebar(ctx, (engagement) => {
    integration.engage(engagement.service)
    viewDispose()
    sidebarDispose = registerSidebarPreviewTab(ctx, engagement, sidebarDeps)
  }, () => {
    integration.disengage()
    sidebarDispose?.()
    sidebarDispose = null
    viewDispose = registerViewContribution()
  }).dispose, 'dsh-web-review: sidebar watch')
}
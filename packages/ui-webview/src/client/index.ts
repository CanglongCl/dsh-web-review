/**
 * ui-webview browser half: the "预览" conversation view tab (proxied iframe +
 * in-iframe element picker + annotation echo layer) and the "注释" dock above
 * the composer, sharing one webview store instance. The annotation XML syncs
 * to the node half's /webview-annotations route (trailing-throttled); the
 * node half prefixes it onto the next user message at send time.
 *
 * Composition: two registrations into ui-conversation slots — the
 * 'conversation.view' tab (id 'webview', order 20) and the
 * 'conversation.input.dock' annotation strip (id 'webview-annotations',
 * order 15) — both declaring the SAME apply-constructed store handle, so the
 * framework resolves one instance per session: the tab and the dock share one
 * pick list (ui-conversation's chatStore multi-registration pattern). The
 * 'conversation' service edge is the load-order seam: both slots are declared
 * by ui-conversation's apply, so waiting on the service orders this apply
 * after the declaring one (upstream checklist rule for cross-package slot
 * registration). The inject face stays thin: the per-session, throttled
 * annotation XML sync.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge (the view/dock entries).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en, zh, type WebviewKey } from './locales.ts'
import { createWebviewStore, type WebviewStore } from './stores.ts'
import { WebviewView, type WebviewInjected } from './WebviewView.tsx'
import { DraftOverlayBar } from './DraftOverlayBar.tsx'
import { injectWebviewCss } from './styles.ts'

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
 * Build the per-session annotation sync: a trailing-throttled same-origin
 * POST of the current XML to the node half's /webview-annotations route.
 * Rapid annotation changes coalesce into one POST 200ms after the last one;
 * an empty xml clears the session's server-side annotation state, so a send
 * with no annotations passes through untouched.
 */
function makeSyncAnnotations(sessionId: SessionId): WebviewInjected['syncAnnotations'] {
  let timer: number | undefined
  let latest = ''
  return (xml: string) => {
    latest = xml
    if (timer !== undefined) return
    timer = window.setTimeout(() => {
      timer = undefined
      void fetch('/webview-annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, xml: latest }),
      })
    }, 200)
  }
}

/** The plugin body: dictionaries, stylesheet, and the two shared-store registrations. */
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

  ctx.effect(() => {
    const disposeCss = injectWebviewCss('ui-webview')
    const disposeView = ctx.slots.register({
      name: 'conversation.view',
      id: 'webview',
      order: 20,
      label: () => t('view.tab'),
      locale: NS,
      store: webviewStore,
      inject: (sessionId: SessionId, _actions: BoundActions<WebviewStore>): WebviewInjected => ({
        syncAnnotations: makeSyncAnnotations(sessionId),
      }),
    }, WebviewView)
    const disposeDock = ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'webview-annotations',
      order: 15,
      locale: NS,
      store: webviewStore,
      inject: (sessionId: SessionId, _actions: BoundActions<WebviewStore>): WebviewInjected => ({
        syncAnnotations: makeSyncAnnotations(sessionId),
      }),
    }, DraftOverlayBar)
    return () => {
      disposeView()
      disposeDock()
      disposeCss()
    }
  }, 'ui-webview: preview tab + annotations dock')
}

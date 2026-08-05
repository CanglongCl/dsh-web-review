/**
 * ui-webview browser half: the header action entry + floating panel, the
 * in-iframe element picker, and the annotation send path.
 *
 * Composition: one register into ui-conversation's
 * `conversation.session.header.actions` list slot (session scope, exclusive
 * store). The 'conversation' service edge is the load-order seam: the
 * service is mounted only after the conversation entries registered, so the
 * header slot declaration is guaranteed on the ledger when this apply runs
 * (upstream checklist rule for cross-package slot registration). The inject
 * face stays thin — the component orchestrates send gestures.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en, zh, type WebviewKey } from './locales.ts'
import { createWebviewStore, type WebviewStore } from './stores.ts'
import { WebviewHeaderAction, type WebviewInjected } from './WebviewPanel.tsx'
import { injectWebviewCss } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The webview panel and annotation copy. */
    webview: WebviewKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'webview' as const

/** Required services (cordis fiber inject — activation waits on them). */
export const inject = ['slots', 'sessions', 'conversation', 'locale']

/** The plugin body: dictionaries, stylesheet, and the header-action registration. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-webview: dictionaries')
  ctx.effect(() => {
    const disposeCss = injectWebviewCss('ui-webview')
    const dispose = ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'ui-webview',
      locale: NS,
      store: createWebviewStore,
      inject: (sessionId: SessionId, _actions: BoundActions<WebviewStore>): WebviewInjected => ({
        // Scope-addressed send: the conversation service is scope-addressed —
        // never a bare ctx.conversation.send from a scope-less closure.
        sendText: async (text: string) => {
          const scoped = ctx.sessions.scope(sessionId)
          if (scoped === undefined) throw new Error('webview: session scope unavailable')
          await scoped.conversation.send(text)
        },
      }),
    }, WebviewHeaderAction)
    return () => {
      dispose()
      disposeCss()
    }
  }, 'ui-webview: header action + stylesheet')
}

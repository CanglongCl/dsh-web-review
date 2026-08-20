/**
 * Sidebar tab wrapper (the foreign-render seam).
 *
 * Rendered by the better-sidebar framework, not the harness slot system, so
 * it receives none of the slot runtime shares. It synthesizes the preview
 * surface's props from public services and the plugin-owned engine axis:
 *
 * - useWebviewStore / actions: the per-session webview engine from the
 *   registry (the SAME engine the dock and the conversation-view
 *   registration use — one pick list, one URL per session);
 * - useSession: the session face snapshot (ctx.sessions.sessionOf);
 * - useInput / inputActions: the per-session input facade
 *   (conversation.input.for);
 * - the injected face: the same session-bound callbacks the view
 *   registration builds (buildViewFace).
 *
 * This wrapper is the only component allowed to touch the registry and
 * services; the underlying surface components stay pure props components.
 */
import { useMemo, type ReactNode } from 'react'
import type { ClientContext, ConversationSnapshot, ISessions, IWorkspaces, SessionId, UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { TabComponentProps } from 'dsh-better-sidebar/client/service'
import { WebviewView, type WebviewSlotProps, type WebviewViewInjected } from '../WebviewView.tsx'
import type { WebviewStoreRegistry } from '../webview-session-store.ts'
import { makeSelectorHook } from './runtime-share.ts'
import css from './SidebarPreviewTab.module.css'

/** Apply-scope dependencies shared with the dock/view registrations. */
export interface SidebarTabDeps {
  /** Locale binder for the `webview` namespace. */
  t: TranslateNS<'webview'>
  /** The plugin-owned per-session engine axis. */
  webviewStores: WebviewStoreRegistry
  /** Session-bound injected face shared with the conversation-view registration. */
  buildViewFace: (sessionId: SessionId) => WebviewViewInjected
}

export interface SidebarPreviewTabProps extends TabComponentProps {
  deps: SidebarTabDeps
}

/**
 * The better-sidebar scope carries a plain string session id; the runtime
 * brands it. The session comes from the live list, so the branded cast is
 * the sanctioned boundary.
 */
function brandedSessionId(sessionId: string): SessionId {
  return sessionId as SessionId
}

export function SidebarPreviewTab({ ctx: tabCtx, scope, deps }: SidebarPreviewTabProps): ReactNode {
  // The better-sidebar declaration graph types ctx through the bare cordis
  // Context, which does not carry the DSH runtime members (their
  // context-types.ts mirrors them structurally and reads cross-plugin
  // services lazily). At runtime the tab receives the same client cordis
  // context, so the seam narrows it to the typed ClientContext.
  const ctx = tabCtx as unknown as ClientContext
  const sessionId = brandedSessionId(scope.sessionId)
  const engine = deps.webviewStores.instanceFor(sessionId)

  // Stabilize the synthesized selector hooks per source identity.
  const useWebviewStore = useMemo(() => makeSelectorHook(engine), [engine])

  // The host SessionStore and the client runtime share the `sessions`
  // service key; narrow through the runtime face like scopedConversation.
  const sessions = ctx.sessions as unknown as ISessions
  const sessionCtx = sessions.scope(sessionId)
  const sessionFace = sessionCtx === undefined ? undefined : sessions.sessionOf(sessionCtx)
  const useSession = useMemo(
    () => (sessionFace === undefined ? undefined : makeSelectorHook(sessionFace)),
    [sessionFace],
  )
  const input = sessionCtx === undefined ? undefined : ctx.conversation.input.for(sessionCtx)
  const useInput = useMemo(
    () => (input === undefined ? undefined : makeSelectorHook(input.state)),
    [input],
  )

  // The injected face must be identity-stable per session: WebviewView's
  // bridge effect depends on releasePreviewSessions identity, so rebuilding
  // the face on every render would dispose the live bridge and revoke the
  // isolated Origin (iframe reload) on any re-render.
  const face = useMemo(() => deps.buildViewFace(sessionId), [deps, sessionId])

  // The standard kit's useProjection is never invoked by the preview surface
  // itself; provide a working implementation over the session projections
  // face so the synthesized props satisfy the runtime share type.
  // The global standard kit's useSessions/useWorkspaces are never invoked
  // by the preview surface; provide real selector hooks over the live
  // services so the synthesized props satisfy the runtime share type.
  const useSessions = useMemo(() => makeSelectorHook(sessions.list), [sessions])
  const workspaces = ctx.get('workspaces') as IWorkspaces | undefined
  const useWorkspaces = useMemo(
    () => (workspaces === undefined ? undefined : makeSelectorHook(workspaces.list)),
    [workspaces],
  )

  const useProjection = useMemo(() => {
    if (sessionFace === undefined) return undefined
    return ((key: string, selector?: (value: unknown) => unknown, eq?: (a: unknown, b: unknown) => boolean) => {
      const hook = makeSelectorHook(sessionFace.projections.faceOf(key))
      return selector === undefined ? hook((value) => value) : hook(selector as never, eq as never)
    }) as unknown as UseProjection
  }, [sessionFace])

  // The guarded sources are stable per session; the memos above are
  // therefore defined whenever the guard passes.
  if (sessionFace === undefined || input === undefined) return null

  return (
    <div className={css.tab} data-webview-ui>
      <WebviewView
        useWebviewStore={useWebviewStore}
        actions={engine.actions}
        sessionId={sessionId}
        useSession={useSession as SnapshotSelectorHook<ConversationSnapshot>}
        useInput={useInput as WebviewSlotProps['useInput']}
        inputActions={input}
        useProjection={useProjection!}
        useSessions={useSessions}
        useWorkspaces={useWorkspaces as WebviewSlotProps['useWorkspaces']}
        {...face}
        t={deps.t}
      />
    </div>
  )
}
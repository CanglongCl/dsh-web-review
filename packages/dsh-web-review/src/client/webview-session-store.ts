/**
 * Plugin-owned per-session webview engine axis.
 *
 * The slot framework caches exactly one engine instance per store handle x
 * scope key inside SlotRegistry's private store axis and never exposes it to
 * foreign render contexts. The sidebar tab is rendered by another plugin's
 * framework, so it cannot reach the framework instance, and calling
 * create() again would yield a second, divergent engine (the handle
 * deliberately does not dedupe). This registry is therefore the single
 * per-session axis: the dock/view inject factories and the sidebar tab
 * wrapper all resolve the same engine here. The slot registrations do NOT
 * declare the store seat; the engine travels through the inject face
 * instead (hooks compartment for reads, baked actions for writes).
 *
 * Instances are pruned when their session leaves the live session list
 * (subscribe ctx.sessions.list) or on explicit prune.
 */
import type { EngineStoreInstance, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { WebviewActions, WebviewState, WebviewStore } from './stores.ts'

export type WebviewEngine = EngineStoreInstance<WebviewState, WebviewActions>

/** The per-session engine axis (apply-scoped; never module-level). */
export interface WebviewStoreRegistry {
  /** Resolve (create or reuse) the engine for one session. */
  instanceFor(sessionId: SessionId): WebviewEngine
  /** Drop one session's engine; its persisted state goes with it. */
  prune(sessionId: SessionId): void
  /** Prune engines whose session is no longer in the live list. */
  pruneAbsent(liveIds: readonly SessionId[]): void
}

/** Construct the axis over one apply-time handle. */
export function createWebviewStoreRegistry(handle: WebviewStore): WebviewStoreRegistry {
  const instances = new Map<SessionId, WebviewEngine>()
  const prune = (sessionId: SessionId): void => {
    const engine = instances.get(sessionId)
    if (engine === undefined) return
    instances.delete(sessionId)
    engine.clearPersisted()
  }
  return {
    instanceFor(sessionId: SessionId): WebviewEngine {
      let engine = instances.get(sessionId)
      if (engine === undefined) {
        engine = handle.create(sessionId)
        instances.set(sessionId, engine)
      }
      return engine
    },
    prune,
    pruneAbsent(liveIds: readonly SessionId[]): void {
      const live = new Set(liveIds)
      for (const id of [...instances.keys()]) {
        if (!live.has(id)) prune(id)
      }
    },
  }
}

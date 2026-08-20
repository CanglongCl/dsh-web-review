/**
 * Foreign-render runtime shares for the sidebar tab.
 *
 * The sidebar tab is not a slot component: it never receives the framework's
 * useSession/useInput/useStore standard kit. This module synthesizes the
 * selector hooks the preview surface needs from public services — the
 * session face (ctx.sessions.sessionOf), the per-session input facade
 * (conversation.input.for), and the webview engine (the plugin-owned
 * registry). makeSelectorHook mirrors the renderer's per-source uSES
 * binding: cached getSnapshot so unchanged sources keep stable selected
 * values.
 */
import { useCallback, useRef, useSyncExternalStore } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'

/** Bind one selector hook over a bare observable snapshot source. */
export function makeSelectorHook<T>(source: ObservableSnapshot<T>): SnapshotSelectorHook<T> {
  return function hook<S>(selector: (state: T) => S, eq?: (a: S, b: S) => boolean): S {
    const cache = useRef<{ snapshot: T; value: S } | null>(null)
    const getSnapshot = useCallback((): S => {
      const snapshot = source.getSnapshot()
      const cached = cache.current
      if (cached !== null && Object.is(cached.snapshot, snapshot)) return cached.value
      let value = selector(snapshot)
      if (eq !== undefined && cached !== null && !Object.is(cached.snapshot, snapshot) && eq(cached.value, value)) {
        value = cached.value
      }
      cache.current = { snapshot, value }
      return value
    }, [source, selector, eq])
    return useSyncExternalStore(source.subscribe, getSnapshot, getSnapshot)
  }
}

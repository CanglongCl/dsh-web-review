// @vitest-environment jsdom
/**
 * The plugin-owned per-session engine axis: one engine per session shared
 * by the dock, the conversation view, and the sidebar tab; prune semantics
 * keyed to the live session list.
 */
import { describe, expect, it, vi } from 'vitest'
import { createWebviewStore } from '../src/client/stores.ts'
import { createWebviewStoreRegistry } from '../src/client/webview-session-store.ts'
import { PREVIEW_TAB_ID } from '../src/client/sidebar/tab.tsx'

describe('createWebviewStoreRegistry', () => {
  it('resolves one engine per session (shared identity)', () => {
    const handle = createWebviewStore()
    const registry = createWebviewStoreRegistry(handle)
    const sid = 'session-1' as never
    const first = registry.instanceFor(sid)
    const second = registry.instanceFor(sid)
    expect(first).toBe(second)
    // The dock and the sidebar tab write through the same actions object.
    first.actions.setUrl('https://example.com/')
    expect(second.getSnapshot().url).toBe('https://example.com/')
    expect(handle).toBeDefined()
    expect(PREVIEW_TAB_ID).toBe('dsh-web-review:preview')
  })

  it('keeps sessions independent', () => {
    const registry = createWebviewStoreRegistry(createWebviewStore())
    const a = registry.instanceFor('a' as never)
    const b = registry.instanceFor('b' as never)
    a.actions.setUrl('https://a.example/')
    expect(b.getSnapshot().url).toBe('')
    expect(a.getSnapshot().url).toBe('https://a.example/')
  })

  it('prune drops one session and clears its persisted state exactly once', () => {
    const registry = createWebviewStoreRegistry(createWebviewStore())
    const a = registry.instanceFor('a' as never)
    const b = registry.instanceFor('b' as never)
    const clearA = vi.fn()
    const clearB = vi.fn()
    ;(a as unknown as { clearPersisted: unknown }).clearPersisted = clearA
    ;(b as unknown as { clearPersisted: unknown }).clearPersisted = clearB
    registry.prune('a' as never)
    expect(clearA).toHaveBeenCalledTimes(1)
    expect(clearB).not.toHaveBeenCalled()
    // A pruned session gets a FRESH engine on next touch.
    expect(registry.instanceFor('a' as never)).not.toBe(a)
    // The untouched session keeps its engine identity.
    expect(registry.instanceFor('b' as never)).toBe(b)
  })

  it('pruneAbsent drops the absent engine and keeps live sessions identical', () => {
    const registry = createWebviewStoreRegistry(createWebviewStore())
    const a = registry.instanceFor('a' as never)
    const b = registry.instanceFor('b' as never)
    const clearA = vi.fn()
    ;(a as unknown as { clearPersisted: unknown }).clearPersisted = clearA
    registry.pruneAbsent(['b' as never])
    expect(clearA).toHaveBeenCalledTimes(1)
    // The dropped session is gone: the next touch mints a fresh engine.
    expect(registry.instanceFor('a' as never)).not.toBe(a)
    // The live session keeps its engine (and is not cleared).
    expect(registry.instanceFor('b' as never)).toBe(b)
  })

  it('pruneAbsent with an empty live list drops every engine', () => {
    const registry = createWebviewStoreRegistry(createWebviewStore())
    const a = registry.instanceFor('a' as never)
    const b = registry.instanceFor('b' as never)
    registry.pruneAbsent([])
    expect(registry.instanceFor('a' as never)).not.toBe(a)
    expect(registry.instanceFor('b' as never)).not.toBe(b)
  })

  it('pruneAbsent with the full live list prunes nothing', () => {
    const registry = createWebviewStoreRegistry(createWebviewStore())
    const a = registry.instanceFor('a' as never)
    const b = registry.instanceFor('b' as never)
    registry.pruneAbsent(['a' as never, 'b' as never])
    expect(registry.instanceFor('a' as never)).toBe(a)
    expect(registry.instanceFor('b' as never)).toBe(b)
  })

  it('prune of an unknown session is a strict no-op', () => {
    const registry = createWebviewStoreRegistry(createWebviewStore())
    const a = registry.instanceFor('a' as never)
    registry.prune('ghost' as never)
    expect(registry.instanceFor('a' as never)).toBe(a)
  })
})
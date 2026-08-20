// @vitest-environment jsdom
/**
 * Detection watcher: ctx.get probing + internal/status re-probing, with
 * zero cordis inject coupling. The shell boot sweep fails the whole page
 * when an entry's fiber stays PENDING on an unsatisfied inject, so the
 * watcher must never be part of the inject topology.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { watchBetterSidebar } from '../src/client/sidebar/detect.ts'
import type { BetterSidebarService } from 'dsh-better-sidebar/client/service'

function fakeService(overrides: Partial<BetterSidebarService> = {}): BetterSidebarService {
  return {
    registerTab: vi.fn(() => () => {}),
    registerFileViewer: vi.fn(() => () => {}),
    getTabs: vi.fn(() => []),
    getFileViewers: vi.fn(() => []),
    getTab: vi.fn(() => undefined),
    isTabEnabled: vi.fn(() => true),
    isViewerEnabled: vi.fn(() => true),
    matchFileViewer: vi.fn(() => undefined),
    openTab: vi.fn(),
    version: '0.14.0',
    features: ['urlTarget'],
    ...overrides,
  } as BetterSidebarService
}

function liveFiber(): unknown {
  return { uid: 1, state: 'active' }
}

/** Emit a fiber-status transition through the untyped event surface. */
function emitStatus(ctx: Context): void {
  ;(ctx as unknown as { emit(name: string, ...args: unknown[]): void }).emit('internal/status', liveFiber(), 'loading')
}

describe('watchBetterSidebar', () => {
  it('engages immediately when the service is already provided', () => {
    const ctx = new Context()
    const service = fakeService()
    ctx.provide('betterSidebar', service)
    const engage = vi.fn()
    const disengage = vi.fn()
    const watch = watchBetterSidebar(ctx as never, engage, disengage)
    expect(watch.engaged).toBe(true)
    expect(engage).toHaveBeenCalledTimes(1)
    expect(engage.mock.calls[0]![0]).toMatchObject({ service, version: '0.14.0' })
    expect(disengage).not.toHaveBeenCalled()
    watch.dispose()
  })

  it('does not engage when the service is absent and never blocks activation', () => {
    const ctx = new Context()
    const engage = vi.fn()
    const disengage = vi.fn()
    const watch = watchBetterSidebar(ctx as never, engage, disengage)
    expect(watch.engaged).toBe(false)
    expect(engage).not.toHaveBeenCalled()
    // Absence is permanent: later status events change nothing.
    emitStatus(ctx)
    expect(engage).not.toHaveBeenCalled()
    watch.dispose()
  })

  it('engages when the service is provided after apply (late activation order)', () => {
    const ctx = new Context()
    const engage = vi.fn()
    const watch = watchBetterSidebar(ctx as never, engage, vi.fn())
    expect(watch.engaged).toBe(false)
    ctx.provide('betterSidebar', fakeService())
    emitStatus(ctx)
    expect(watch.engaged).toBe(true)
    expect(engage).toHaveBeenCalledTimes(1)
    watch.dispose()
  })

  it('disengages when the service disappears and re-engages on reappearance', () => {
    const ctx = new Context()
    const engage = vi.fn()
    const disengage = vi.fn()
    const watch = watchBetterSidebar(ctx as never, engage, disengage)
    const provide = ctx.provide('betterSidebar', fakeService())
    emitStatus(ctx)
    expect(watch.engaged).toBe(true)
    provide()
    emitStatus(ctx)
    expect(watch.engaged).toBe(false)
    expect(disengage).toHaveBeenCalledTimes(1)
    ctx.provide('betterSidebar', fakeService())
    emitStatus(ctx)
    expect(watch.engaged).toBe(true)
    expect(engage).toHaveBeenCalledTimes(2)
    watch.dispose()
  })

  it('tolerates a service without version/features and reports no urlTarget', () => {
    // Older service instances may not expose version/features at all.
    const ctx = new Context()
    const engage = vi.fn()
    ctx.provide('betterSidebar', fakeService({
      version: undefined,
      features: undefined,
    } as unknown as Partial<BetterSidebarService>))
    const watch = watchBetterSidebar(ctx as never, engage, vi.fn())
    expect(engage.mock.calls[0]![0]).toMatchObject({ version: undefined, hasUrlTarget: false })
    expect(engage.mock.calls[0]![0].features).toEqual([])
    watch.dispose()
  })

  it('filters junk feature entries and derives hasUrlTarget from the string feature only', () => {
    const ctx = new Context()
    const engage = vi.fn()
    ctx.provide('betterSidebar', fakeService({
      // 42 and null are not string features and must be dropped; an empty
      // string IS a string entry, so the defensive filter keeps it.
      features: ['urlTarget', 'badge', 42, null, ''],
    } as unknown as Partial<BetterSidebarService>))
    const watch = watchBetterSidebar(ctx as never, engage, vi.fn())
    expect(engage.mock.calls[0]![0]).toMatchObject({
      hasUrlTarget: true,
      features: ['urlTarget', 'badge', ''],
    })
    watch.dispose()
  })

  it('never re-engages while still engaged, no matter how many status events arrive', () => {
    const ctx = new Context()
    ctx.provide('betterSidebar', fakeService())
    const engage = vi.fn()
    const watch = watchBetterSidebar(ctx as never, engage, vi.fn())
    expect(engage).toHaveBeenCalledTimes(1)
    emitStatus(ctx)
    emitStatus(ctx)
    emitStatus(ctx)
    expect(engage).toHaveBeenCalledTimes(1)
    expect(watch.engaged).toBe(true)
    watch.dispose()
  })

  it('fires onDisengage exactly once per disappearance, not per status event', () => {
    const ctx = new Context()
    const disengage = vi.fn()
    const watch = watchBetterSidebar(ctx as never, vi.fn(), disengage)
    const provide = ctx.provide('betterSidebar', fakeService())
    emitStatus(ctx)
    expect(watch.engaged).toBe(true)
    provide()
    emitStatus(ctx)
    emitStatus(ctx)
    expect(disengage).toHaveBeenCalledTimes(1)
    expect(watch.engaged).toBe(false)
    watch.dispose()
  })

  it('re-engagement hands the NEW service instance to onEngage', () => {
    const ctx = new Context()
    const engage = vi.fn()
    const watch = watchBetterSidebar(ctx as never, engage, vi.fn())
    const first = fakeService()
    const unprovide = ctx.provide('betterSidebar', first)
    emitStatus(ctx)
    unprovide()
    emitStatus(ctx)
    const second = fakeService()
    ctx.provide('betterSidebar', second)
    emitStatus(ctx)
    expect(engage).toHaveBeenCalledTimes(2)
    expect(engage.mock.calls[1]![0]).toMatchObject({ service: second })
    expect(engage.mock.calls[1]![0]).not.toMatchObject({ service: first })
    watch.dispose()
  })

  it('still engages when the service appears long after repeated absent probes', () => {
    const ctx = new Context()
    const engage = vi.fn()
    const watch = watchBetterSidebar(ctx as never, engage, vi.fn())
    emitStatus(ctx)
    emitStatus(ctx)
    emitStatus(ctx)
    expect(watch.engaged).toBe(false)
    ctx.provide('betterSidebar', fakeService())
    emitStatus(ctx)
    expect(watch.engaged).toBe(true)
    expect(engage).toHaveBeenCalledTimes(1)
    watch.dispose()
  })

  it('dispose stops future probes', () => {
    const ctx = new Context()
    const engage = vi.fn()
    const watch = watchBetterSidebar(ctx as never, engage, vi.fn())
    watch.dispose()
    ctx.provide('betterSidebar', fakeService())
    emitStatus(ctx)
    expect(watch.engaged).toBe(false)
    expect(engage).not.toHaveBeenCalled()
  })
})
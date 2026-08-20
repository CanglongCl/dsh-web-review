/**
 * Better-sidebar detection and engagement watcher.
 *
 * The `betterSidebar` service MUST NOT be added to this plugin's cordis
 * inject list: a fiber whose injected service is never provided stays PENDING
 * forever, and the 0812/rc.8 shell boot sweep turns that into a whole-page
 * boot failure ("web boot: N entries did not activate ... waiting for
 * service"). Presence is therefore probed at apply time via ctx.get()
 * (cordis reflection reads a provided service without the inject
 * requirement) and re-probed on every fiber status transition
 * (internal/status), which covers both activation orders and detects the
 * service disappearing when its providing fiber unloads.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { BetterSidebarService } from 'dsh-better-sidebar/client/service'

/** A live better-sidebar engagement snapshot (capability-probed). */
export interface SidebarEngagement {
  readonly service: BetterSidebarService
  /** Service version string ('0.14.0'); undefined when the probe is missing. */
  readonly version: string | undefined
  /** Capability flags (urlTarget is v0.13.0+). */
  readonly features: readonly string[]
  /** Whether link claiming through urlTarget is available. */
  readonly hasUrlTarget: boolean
}

/** The watcher handle; dispose stops probing (fiber unload uses this). */
export interface SidebarWatch {
  readonly engaged: boolean
  dispose(): void
}

function engagementOf(service: BetterSidebarService): SidebarEngagement {
  const probe = service as BetterSidebarService & { version?: unknown; features?: unknown }
  const version = typeof probe.version === 'string' ? probe.version : undefined
  const features = Array.isArray(probe.features)
    ? probe.features.filter((feature): feature is string => typeof feature === 'string')
    : []
  return { service, version, features, hasUrlTarget: features.includes('urlTarget') }
}

/**
 * Watch for the better-sidebar client service. onEngage fires at most once
 * per engagement (including an immediate probe result); onDisengage fires
 * when the service disappears again. dispose only stops the watcher — fiber
 * unload owns the full teardown, so no re-registration happens during
 * unload.
 */
export function watchBetterSidebar(
  ctx: ClientContext,
  onEngage: (engagement: SidebarEngagement) => void,
  onDisengage: () => void,
): SidebarWatch {
  let current: SidebarEngagement | null = null
  let disposed = false
  const probe = (): void => {
    if (disposed) return
    const service = ctx.get('betterSidebar') as BetterSidebarService | undefined
    if (service !== undefined) {
      if (current === null) {
        current = engagementOf(service)
        onEngage(current)
      }
    } else if (current !== null) {
      current = null
      onDisengage()
    }
  }
  probe()
  const listener = (): void => probe()
  ctx.on('internal/status', listener)
  return {
    get engaged(): boolean {
      return current !== null
    },
    dispose(): void {
      // Listeners registered through ctx.on are owned by this fiber and are
      // removed with it; dispose only stops future probes.
      disposed = true
      current = null
    },
  }
}
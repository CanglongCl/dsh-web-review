/**
 * Apply-scoped sidebar integration state: which better-sidebar service (if
 * any) the plugin is currently engaged with. The dock's openPreview and the
 * assistant-link delegation read this to route links into the sidebar tab
 * instead of the conversation pane. Apply-scoped only — never module-level.
 */
import type { BetterSidebarService } from 'dsh-better-sidebar/client/service'

export interface SidebarIntegrationState {
  /** The engaged service, or null when the sidebar is absent/disabled. */
  readonly service: BetterSidebarService | null
  engage(service: BetterSidebarService): void
  disengage(): void
}

export function createSidebarIntegrationState(): SidebarIntegrationState {
  let service: BetterSidebarService | null = null
  return {
    get service(): BetterSidebarService | null {
      return service
    },
    engage(next: BetterSidebarService): void {
      service = next
    },
    disengage(): void {
      service = null
    },
  }
}

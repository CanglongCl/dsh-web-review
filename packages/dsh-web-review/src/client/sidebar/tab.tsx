/**
 * Sidebar tab registration for the preview surface.
 *
 * Registered only while the better-sidebar service is engaged. The tab is
 * single-instance (`single: true`), claims credential-free HTTP(S) links
 * through `urlTarget` when the service supports it (v0.13.0+), and renders
 * the SidebarPreviewTab foreign seam, which reuses the exact preview surface
 * components through the plugin-owned engine axis.
 */
import type { ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { TabComponentProps, TabDescriptor } from 'dsh-better-sidebar/client/service'
import type { SidebarEngagement } from './detect.ts'
import { SidebarPreviewTab } from './SidebarPreviewTab.tsx'
import type { SidebarTabDeps } from './SidebarPreviewTab.tsx'

/** The registered tab type id (must be prefixed; never a built-in id). */
export const PREVIEW_TAB_ID = 'dsh-web-review:preview'

/** Match the delegation rule: credential-free absolute HTTP(S) URLs. */
export function isPreviewLink(url: URL): boolean {
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === ''
}

/** Register the sidebar tab; returns the disposer (wire through ctx.effect). */
export function registerSidebarPreviewTab(
  ctx: ClientContext,
  engagement: SidebarEngagement,
  deps: SidebarTabDeps,
): () => void {
  return ctx.effect(() => {
    const descriptor: TabDescriptor = {
      id: PREVIEW_TAB_ID,
      title: () => deps.t('sidebar.tab'),
      icon: <PreviewTabIcon />,
      order: 60,
      single: true,
      component: (props: TabComponentProps) => <SidebarPreviewTab {...props} deps={deps} />,
    }
    if (engagement.hasUrlTarget) {
      descriptor.urlTarget = (url: URL) => isPreviewLink(url)
    }
    const dispose = engagement.service.registerTab(descriptor)
    return dispose
  })
}

/** Small inline globe glyph; the client bundle carries no icon dependency. */
function PreviewTabIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.5 8h13M8 1.5c2 1.9 3 4 3 6.5s-1 4.6-3 6.5c-2-1.9-3-4-3-6.5s1-4.6 3-6.5Z" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}
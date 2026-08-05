/**
 * Internal contract types for the webview panel (browser half). Exact keys
 * shared with format.ts — snapshot field names are contract.
 */

/** One picked element's snapshot (caps enforced at capture in picker-core). */
export interface ElementSnapshot {
  tagName: string
  id: string
  className: string
  cssPath: string
  /** Truncated to OUTER_HTML_CAP chars. */
  outerHTML: string
  /** Truncated to TEXT_CAP chars. */
  textContent: string
  rect: { x: number; y: number; width: number; height: number }
  computed: {
    display: string
    position: string
    fontSize: string
    color: string
    backgroundColor: string
    margin: string
    padding: string
    width: string
    height: string
  }
}

/** One annotation entry: a picked element plus the user's comment. */
export interface PickItem {
  /** Stable id for React keys (generated at pick time). */
  id: string
  snapshot: ElementSnapshot
  comment: string
}

/** Iframe loading mode: proxied (same-origin, picker enabled) or direct (cross-origin). */
export type WebviewMode = 'proxy' | 'direct'

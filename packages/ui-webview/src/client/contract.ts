/**
 * Internal contract types for the webview panel (browser half). Exact keys
 * shared with format.ts — snapshot field names are contract.
 */

/** One picked element's snapshot (caps enforced at capture in picker-core). */
export interface ElementSnapshot {
  tagName: string
  id: string
  className: string
  /** Shortest unique CSS selector (re-queryable). */
  cssPath: string
  /** Full DOM path: the complete ancestor chain with nth-of-type indices. */
  fullPath: string
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

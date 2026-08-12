/**
 * Internal contract types for the webview panel (browser half). Exact keys
 * mapped into annotation-contract.ts by annotation-snapshot.ts.
 */

/** One picked element's snapshot (caps enforced at capture in picker-core). */
export interface ElementSnapshot {
  tagName: string
  id: string
  className: string
  /** Shortest unique CSS selector (runtime anchor for marker rebuilds). */
  cssPath: string
  /** Full DOM path: the complete ancestor chain with nth-of-type indices. */
  fullPath: string
  /** Accessible label (aria-label/title/placeholder/alt, else visible text). */
  label: string
  /** Explicit or implicit ARIA role (button, link, heading, …). */
  role: string
  /** Semantic class names in document order. Utility/variant tokens and
   * fully opaque hashes are filtered; `<hash>_<name>` CSS-module classes are
   * kept because their semantic suffix is a searchable source anchor. */
  stableClasses: string[]
  /** Framework source anchor (file/line/component) or null. */
  anchor: import('./source-anchor.ts').SourceAnchor | null
  /** True when the element lives inside this plugin's own chrome (a nested
   * `[data-webview-ui]` root, e.g. dogfooding a DSH Web GUI in Preview). */
  inToolChrome: boolean
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
  /** User-requested visual edits. */
  changes: import('../annotation-contract.ts').AnnotationStyleChange[]
  /** Safe direct-text-node edit, or null when no text edit was made. */
  textChange: import('../annotation-contract.ts').AnnotationTextChange | null
  /** Iframe viewport at edit time. */
  viewport: import('../annotation-contract.ts').AnnotationViewport
}

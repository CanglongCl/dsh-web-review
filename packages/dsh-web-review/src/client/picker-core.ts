import { getCssSelector } from 'css-selector-generator'
import { PREVIEW_ELEMENT_LIMITS } from '../preview-contract.ts'
import { sourceAnchorOf } from './source-anchor.ts'

/**
 * Picker core: snapshot capture helpers for picked elements (browser half).
 *
 * The CSS-selector path is delegated to `css-selector-generator` (id →
 * class → tag → nth-of-type priority, shortest unique selector); everything
 * else here is a thin wrapper over native DOM APIs. These helpers are bundled
 * into the isolated-frame bridge and unit-tested directly.
 *
 * The page DOM is untrusted data, read-only — these helpers never write
 * into the page.
 *
 * Unit tests import this module directly (jsdom).
 */

/** Cap for the outerHTML snapshot (exact limit — truncation lands at cap). */
export const OUTER_HTML_CAP = PREVIEW_ELEMENT_LIMITS.outerHTML
/** Cap for the textContent snapshot. */
export const TEXT_CAP = PREVIEW_ELEMENT_LIMITS.textContent
/** Cap for the accessible label. */
export const LABEL_CAP = 48

/** Truncate to `cap` characters (ellipsis included in the cap). */
export function truncate(value: string, cap: number): string {
  if (value.length <= cap) return value
  const head = Math.max(0, cap - 1)
  return `${value.slice(0, head)}…`
}

/**
 * Accessible label of an element: aria-label/title/placeholder/alt first,
 * else the visible text — the human-readable identity that also exists as a
 * string literal in source code (and is therefore searchable by the AI).
 */
export function accessibleLabel(el: Element): string {
  const direct = el.getAttribute('aria-label')
    ?? el.getAttribute('title')
    ?? el.getAttribute('placeholder')
    ?? el.getAttribute('alt')
  if (direct !== null && direct.trim() !== '') return truncate(direct.trim(), LABEL_CAP)
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  return truncate(text, LABEL_CAP)
}

/** Explicit or implicit ARIA role of an element ('' when none applies). */
export function roleOf(el: Element): string {
  const explicit = el.getAttribute('role')
  if (explicit !== null) return truncate(
    explicit.split(/\s+/)[0] ?? '',
    PREVIEW_ELEMENT_LIMITS.role,
  )
  const tag = el.tagName.toLowerCase()
  if (tag === 'button') return 'button'
  if (tag === 'a' && el.getAttribute('href') !== null) return 'link'
  if (tag === 'input') return 'textbox'
  if (tag === 'select') return 'combobox'
  if (tag === 'textarea') return 'textbox'
  if (/^h[1-6]$/.test(tag)) return 'heading'
  if (tag === 'img') return 'img'
  return ''
}

/**
 * Semantic class names: filter out utility classes (layout/spacing/type
 * tokens that are assembled at build time and don't exist verbatim in
 * source), state variants (`hover:`/`focus:`), and hashed/opaque tokens
 * (css-*, CSS-module hashes, UUIDs) that are meaningless to search.
 */
export function stableClassesOf(el: Element): string[] {
  return Array.from(el.classList)
    .filter(cls => cls.length <= PREVIEW_ELEMENT_LIMITS.stableClass && isStableClass(cls))
    .slice(0, PREVIEW_ELEMENT_LIMITS.stableClasses)
}

const UTILITY_CLASS =
  /^(?:m[trblxy]?|p[trblxy]?|w|h|min-w|max-w|min-h|max-h|inset|top|right|bottom|left|translate|scale|rotate|text|bg|border|rounded|shadow|ring|opacity|z|flex|grid|gap|space|items|justify|content|self|place|font|leading|tracking)-(?:.+)$/

/** Bare utility tokens that never exist verbatim in source (assembled at build time). */
const BARE_UTILITY = new Set([
  'flex', 'grid', 'block', 'inline', 'inline-flex', 'inline-block', 'hidden',
  'relative', 'absolute', 'fixed', 'sticky', 'static', 'container',
])

function isStableClass(cls: string): boolean {
  if (cls.includes(':')) return false
  if (/^(sm|md|lg|xl|2xl|hover|focus|active|disabled)$/.test(cls)) return false
  if (cls.startsWith('css-') || /^_?[a-f0-9]{6,}$/i.test(cls)) return false
  if (/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}/i.test(cls)) return false
  if (/^dsh-wv-/.test(cls)) return false
  if (UTILITY_CLASS.test(cls) || BARE_UTILITY.has(cls)) return false
  return true
}

/** Selector-type priority: id → class → tag → nth-of-type (order = priority). */
type SelectorPriority = 'id' | 'class' | 'tag' | 'nthoftype'
const SELECTOR_OPTIONS: { selectors: SelectorPriority[] } = { selectors: ['id', 'class', 'tag', 'nthoftype'] }

/**
 * Build a stable, re-runnable CSS selector for an element: shortest unique
 * selector under the id → class → tag → nth-of-type priority; falls back to
 * the bare tag when the library yields nothing.
 */
export function cssPath(el: Element): string {
  const fallback = truncate(el.tagName.toLowerCase(), PREVIEW_ELEMENT_LIMITS.tagName)
  try {
    const selector = getCssSelector(el, SELECTOR_OPTIONS)
    return selector !== null && selector.length <= PREVIEW_ELEMENT_LIMITS.cssPath
      ? selector
      : fallback
  } catch {
    return fallback
  }
}

/**
 * Full DOM path for an element: the complete ancestor chain as
 * `tag#id.class1.class2:nth-of-type(n)` segments joined by ` > `, with
 * nth-of-type indices only where same-tag siblings compete (ids are unique
 * and never indexed). The plugin's own chrome classes (`dsh-wv-*`, e.g. the
 * pick-mode crosshair marker on `<html>`) are excluded — they are tool
 * state, not page structure. This is the unambiguous page-hierarchy
 * location handed to the AI — the shortest cssPath is optimized for
 * re-querying, not for describing where an element sits.
 */
export function fullPathOf(el: Element): string {
  const parts: string[] = []
  let node: Element | null = el
  while (node !== null && node.nodeType === 1) {
    const tag = node.tagName.toLowerCase()
    const id = node.id !== '' ? `#${node.id}` : ''
    // An id uniquely identifies the level — classes add nothing on top of it.
    const classes = id === ''
      ? Array.from(node.classList).filter((name) => !name.startsWith('dsh-wv-')).join('.')
      : ''
    let segment = `${tag}${id}${classes !== '' ? `.${classes}` : ''}`
    if (node.id === '') {
      const parent: Element | null = node.parentElement
      if (parent !== null) {
        let nth = 0
        const siblings: Element[] = Array.from(parent.children)
        for (const sibling of siblings) {
          if (sibling.tagName === node.tagName) nth += 1
          if (sibling === node) break
        }
        if (nth > 1) segment += `:nth-of-type(${nth})`
      }
    }
    parts.unshift(segment)
    node = node.parentElement
  }
  return truncate(parts.join(' > '), PREVIEW_ELEMENT_LIMITS.fullPath)
}

/**
 * Snapshot a picked element: exact keys mapped by annotation-snapshot.ts; caps enforced
 * here (OUTER_HTML_CAP / TEXT_CAP).
 * @param el - the picked element (untrusted page DOM, read-only).
 * @returns the snapshot.
 */
export function snapshotOf(el: Element): {
  tagName: string
  id: string
  className: string
  cssPath: string
  fullPath: string
  label: string
  role: string
  stableClasses: string[]
  anchor: ReturnType<typeof sourceAnchorOf>
  outerHTML: string
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
} {
  const style = window.getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  return {
    tagName: truncate(el.tagName.toLowerCase(), PREVIEW_ELEMENT_LIMITS.tagName),
    id: truncate(el.id, PREVIEW_ELEMENT_LIMITS.id),
    className: truncate(
      typeof el.className === 'string' ? el.className : '',
      PREVIEW_ELEMENT_LIMITS.className,
    ),
    cssPath: cssPath(el),
    fullPath: fullPathOf(el),
    label: accessibleLabel(el),
    role: roleOf(el),
    stableClasses: stableClassesOf(el),
    anchor: sourceAnchorOf(el),
    outerHTML: truncate(el.outerHTML, OUTER_HTML_CAP),
    textContent: truncate(el.textContent ?? '', TEXT_CAP),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    computed: {
      display: truncate(style.display, PREVIEW_ELEMENT_LIMITS.computedValue),
      position: truncate(style.position, PREVIEW_ELEMENT_LIMITS.computedValue),
      fontSize: truncate(style.fontSize, PREVIEW_ELEMENT_LIMITS.computedValue),
      color: truncate(style.color, PREVIEW_ELEMENT_LIMITS.computedValue),
      backgroundColor: truncate(style.backgroundColor, PREVIEW_ELEMENT_LIMITS.computedValue),
      margin: truncate(style.margin, PREVIEW_ELEMENT_LIMITS.computedValue),
      padding: truncate(style.padding, PREVIEW_ELEMENT_LIMITS.computedValue),
      width: truncate(style.width, PREVIEW_ELEMENT_LIMITS.computedValue),
      height: truncate(style.height, PREVIEW_ELEMENT_LIMITS.computedValue),
    },
  }
}

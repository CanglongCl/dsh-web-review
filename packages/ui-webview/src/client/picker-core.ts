import { getCssSelector } from 'css-selector-generator'

/**
 * Picker core: snapshot capture helpers for picked elements (browser half).
 *
 * The CSS-selector path is delegated to `css-selector-generator` (id →
 * class → tag → nth-of-type priority, shortest unique selector); everything
 * else here is a thin wrapper over native DOM APIs. The injected picker
 * script (picker.ts) is event-only — these helpers never run inside the
 * target page's document context, so they may import freely.
 *
 * The page DOM is untrusted data, read-only — these helpers never write
 * into the page.
 *
 * Unit tests import this module directly (jsdom).
 */

/** Cap for the outerHTML snapshot (exact limit — truncation lands at cap). */
export const OUTER_HTML_CAP = 1500
/** Cap for the textContent snapshot. */
export const TEXT_CAP = 300

/** Truncate to `cap` characters (ellipsis included in the cap). */
export function truncate(value: string, cap: number): string {
  if (value.length <= cap) return value
  const head = Math.max(0, cap - 1)
  return `${value.slice(0, head)}…`
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
  return getCssSelector(el, SELECTOR_OPTIONS) ?? el.tagName.toLowerCase()
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
  return parts.join(' > ')
}

/**
 * Snapshot a picked element: exact keys shared with format.ts; caps enforced
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
    tagName: el.tagName.toLowerCase(),
    id: el.id,
    className: typeof el.className === 'string' ? el.className : '',
    cssPath: cssPath(el),
    fullPath: fullPathOf(el),
    outerHTML: truncate(el.outerHTML, OUTER_HTML_CAP),
    textContent: truncate(el.textContent ?? '', TEXT_CAP),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    computed: {
      display: style.display,
      position: style.position,
      fontSize: style.fontSize,
      color: style.color,
      backgroundColor: style.backgroundColor,
      margin: style.margin,
      padding: style.padding,
      width: style.width,
      height: style.height,
    },
  }
}

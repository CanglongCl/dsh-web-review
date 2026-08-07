/**
 * Annotation message assembly — the single assembly point for the
 * user-visible message sent into the conversation. Template strings are
 * product copy pinned in locales.ts; this module only composes them.
 *
 * The message is built for LOCATION, not description: every field is a
 * literal the model can search for in the session workspace source —
 * accessible text, stable class names, and (when the framework exposes it)
 * the source file/line/component that produced the element. Raw DOM
 * artifacts (outerHTML, computed styles, coordinates, the shortest cssPath)
 * are deliberately NOT included: they don't exist in source and only burn
 * tokens. Two tiers:
 *   - with a source anchor: text + source file:line + component chain;
 *   - without one: text + stable classes + full DOM path (the model infers
 *     the component boundary from the hierarchy).
 */
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { PickItem } from './contract.ts'
import type { WebviewKey } from './locales.ts'
import { truncate } from './picker-core.ts'

/** Split a URL into its route and a compact query summary (≤3 params). */
function shortenUrl(url: string): { route: string; query: string } {
  try {
    const parsed = new URL(url)
    const params = Array.from(parsed.searchParams.entries())
    if (params.length === 0) return { route: `${parsed.origin}${parsed.pathname}`, query: '' }
    const shown = params.slice(0, 3).map(([key, value]) => `${key}=${truncate(value, 24)}`)
    const rest = params.length > 3 ? `, +${params.length - 3} more` : ''
    return { route: `${parsed.origin}${parsed.pathname}`, query: `${shown.join(', ')}${rest}` }
  } catch {
    return { route: url, query: '' }
  }
}

/**
 * Escape a value for use inside an XML attribute. `>` is legal in attribute
 * values and stays readable for the model (`html > body > …`), so only `&`,
 * `"` and `<` are escaped.
 */
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}

/**
 * Human-readable element identity: `role "label"` (or `tag "label"` without
 * a role), falling back to the bare role/tag when the label is empty.
 */
function identityOf(s: PickItem['snapshot']): string {
  if (s.label !== '') {
    const kind = s.role !== '' ? s.role : s.tagName
    return `${kind} "${s.label}"`
  }
  return s.role !== '' ? s.role : s.tagName
}

/**
 * Compose the user message for the AI as an XML-style annotation block: the
 * page context plus one `<element>` entry per pick carrying the location
 * fields (see module doc), the user's comment in CDATA, and a closing
 * instruction. Template strings are product copy pinned in locales.ts.
 * @param url - the annotated page URL.
 * @param title - the annotated page title (may be empty).
 * @param picks - the annotation entries (at least one; caller gates).
 * @param t - the `webview` namespace translate function.
 * @returns the message text, sent verbatim as one text block.
 */
export function formatAnnotation(
  url: string,
  title: string,
  picks: readonly PickItem[],
  t: Translate<WebviewKey>,
): string {
  const { route, query } = shortenUrl(url)
  const lines: string[] = [t('annotation.open', { hint: t('annotation.hint') })]
  lines.push(query === ''
    ? t('annotation.page', { url: escapeXmlAttr(route), title: escapeXmlAttr(title) })
    : t('annotation.pageWithQuery', {
      url: escapeXmlAttr(route),
      query: escapeXmlAttr(query),
      title: escapeXmlAttr(title),
    }))
  picks.forEach((pick, index) => {
    const s = pick.snapshot
    const text = identityOf(s)
    const anchor = s.anchor
    if (anchor !== null) {
      const source = anchor.line !== undefined ? `${anchor.file}:${anchor.line}` : anchor.file
      lines.push(t('annotation.element.anchor', {
        index: String(index + 1),
        text: escapeXmlAttr(text),
        source: escapeXmlAttr(source),
        component: escapeXmlAttr(anchor.component),
      }))
    } else {
      lines.push(t('annotation.element.open', {
        index: String(index + 1),
        text: escapeXmlAttr(text),
        classes: escapeXmlAttr(s.stableClasses.join(' ')),
        path: escapeXmlAttr(s.fullPath),
      }))
    }
    const comment = pick.comment.trim()
    // No comment node for empty comments — the element stands alone.
    if (comment !== '') lines.push(t('annotation.comment', { comment }))
    lines.push(t('annotation.element.close'))
  })
  lines.push(t('annotation.close'))
  return lines.join('\n')
}

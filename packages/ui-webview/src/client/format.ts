/**
 * Annotation message assembly — the single assembly point for the
 * user-visible message sent into the conversation. Template strings are
 * product copy pinned in locales.ts; this module only composes them.
 */
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { PickItem } from './contract.ts'
import type { WebviewKey } from './locales.ts'

/**
 * Compose the user message for the AI as an XML-style annotation block: the
 * page context plus one `<element>` entry per pick carrying the shortest CSS
 * selector and the FULL DOM path, the truncated snapshot in CDATA, and the
 * user's comment; a closing instruction follows. Template strings are
 * product copy pinned in locales.ts; this module only composes them.
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
  const lines: string[] = [t('annotation.open'), t('annotation.page', { title, url })]
  picks.forEach((pick, index) => {
    const s = pick.snapshot
    lines.push(t('annotation.element.open', {
      index: String(index + 1),
      selector: s.cssPath,
      path: s.fullPath,
    }))
    lines.push(t('annotation.snapshot', { html: s.outerHTML }))
    const comment = pick.comment.trim()
    lines.push(comment !== '' ? t('annotation.comment', { comment }) : t('annotation.noComment'))
    lines.push(t('annotation.element.close'))
  })
  lines.push(t('annotation.close'))
  lines.push('')
  lines.push(t('annotation.instruction'))
  return lines.join('\n')
}

/**
 * Annotation message assembly — the single assembly point for the
 * user-visible message sent into the conversation. Template strings are
 * product copy pinned in locales.ts; this module only composes them.
 */
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { PickItem } from './contract.ts'
import type { WebviewKey } from './locales.ts'

/**
 * Compose the user message for the AI: page context, one numbered entry per
 * pick (cssPath, snapshot, comment), and the closing instruction.
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
  const lines: string[] = [t('annotation.header'), t('annotation.page', { title, url }), '']
  picks.forEach((pick, index) => {
    const s = pick.snapshot
    const idPart = s.id !== '' ? `#${s.id}` : ''
    const classPart = s.className !== ''
      ? `.${s.className.trim().split(/\s+/).filter(Boolean).join('.')}`
      : ''
    lines.push(t('annotation.entry.title', { index: String(index + 1) }))
    lines.push(t('annotation.entry.selector', { selector: s.cssPath }))
    lines.push(t('annotation.entry.element', {
      tag: s.tagName,
      id: idPart,
      classes: classPart,
      width: String(s.rect.width),
      height: String(s.rect.height),
      x: String(s.rect.x),
      y: String(s.rect.y),
    }))
    lines.push(t('annotation.entry.snapshot', { html: s.outerHTML }))
    const comment = pick.comment.trim()
    lines.push(comment !== '' ? t('annotation.entry.comment', { comment }) : t('annotation.entry.noComment'))
    lines.push('')
  })
  lines.push(t('annotation.instruction'))
  return lines.join('\n')
}

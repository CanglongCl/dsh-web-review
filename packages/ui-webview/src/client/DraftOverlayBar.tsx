/**
 * DraftOverlayBar: the "注释" annotation strip docked above the composer
 * (conversation.input.dock, GoalBar's slot). It renders the picks shared
 * with the preview tab as compact chips (number + element identity +
 * comment summary + hover-remove). Clicking a chip writes the focus signal
 * into the shared store — the preview tab consumes it and locates the
 * element (openComment + outline). With no picks the whole strip renders
 * nothing (GoalBar-style hiding).
 *
 * Presentation follows the dsh web design system tokens; state arrives via
 * useStore/actions from the shared store, copy via the locale seat. The
 * inject face is the shared one (syncAnnotations) — declared for the
 * four-share contract, unused here. No ctx, no contexts.
 */
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WebviewStore } from './stores.ts'
import { elementLabel, type WebviewInjected } from './WebviewView.tsx'

/** Full composed props: dock runtime share + shared store + locale + inject. */
export type WebviewDockProps =
  & PropsRuntime<'conversation.input.dock'>
  & PropsStore<WebviewStore>
  & PropsLocale<'webview'>
  & WebviewInjected

/** The annotation dock strip (see module doc). */
export function DraftOverlayBar({ useStore, actions, t }: WebviewDockProps) {
  const state = useStore((s) => s)
  if (state.picks.length === 0) return null
  return (
    <div className="wv-annotations-bar" data-webview-ui>
      <span className="wv-annotations-label">{t('dock.label')}</span>
      {state.picks.map((pick, index) => (
        <div
          key={pick.id}
          className="wv-chip"
          role="button"
          tabIndex={0}
          aria-label={`${index + 1}. ${elementLabel(pick.snapshot)}`}
          title={pick.comment.trim() !== '' ? pick.comment : undefined}
          onClick={() => { actions.setFocusPickId(pick.id) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              actions.setFocusPickId(pick.id)
            }
          }}
        >
          <span className="wv-chip-index">{index + 1}</span>
          <span className="wv-chip-label">{elementLabel(pick.snapshot)}</span>
          {pick.comment.trim() !== '' && (
            <span className="wv-chip-comment">{pick.comment}</span>
          )}
          <button
            type="button"
            className="wv-chip-remove"
            title={t('panel.pick.remove')}
            aria-label={t('panel.pick.remove')}
            onClick={(e) => {
              e.stopPropagation()
              actions.removePick(pick.id)
            }}
          >
            <IconCloseOutline16 size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

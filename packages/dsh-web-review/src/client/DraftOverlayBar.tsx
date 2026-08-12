/**
 * Compact annotation capsule above the stock composer. The capsule owns the
 * browser-to-host commit effect and exposes acknowledgement state; its detail
 * card opens on hover/focus and keeps every comment's target context visible.
 */
import { useEffect, useId, useRef, useState } from 'react'
import {
  IconCloseOutline16,
  IconLoadingOutline16,
  IconQueueOutline14,
  IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { AnnotationDraft } from '../annotation-contract.ts'
import { annotationDraft } from './annotation-snapshot.ts'
import type { ElementSnapshot, PickItem } from './contract.ts'
import type { WebviewStore } from './stores.ts'
import { elementLabel } from './WebviewView.tsx'
import { previewHrefFromClick } from './preview-link.ts'
import css from './DraftOverlayBar.module.css'

/** Host acknowledgement face bound to one session by the slot registration. */
export interface WebviewDockInjected {
  syncAnnotations: (snapshot: AnnotationDraft) => Promise<void>
  openPreview: (url: string) => void
}

/** Full composed props: dock runtime + shared store + locale + inject. */
export type WebviewDockProps =
  & PropsRuntime<'conversation.input.dock'>
  & PropsStore<WebviewStore>
  & PropsLocale<'webview'>
  & WebviewDockInjected

function kindOf(snapshot: ElementSnapshot): string {
  return snapshot.role.trim() || snapshot.tagName.trim() || 'element'
}

function targetOf(snapshot: ElementSnapshot): string {
  return snapshot.label.trim() || elementLabel(snapshot)
}

function sourceOf(pick: PickItem): string {
  const anchor = pick.snapshot.anchor
  if (anchor === null) return pick.snapshot.cssPath
  const source = anchor.line === undefined ? anchor.file : `${anchor.file}:${anchor.line}`
  return anchor.component.trim() === '' ? source : `${source} · ${anchor.component}`
}

/** Annotation composer capsule and hover/focus detail card. */
export function DraftOverlayBar({ useStore, useSession, actions, syncAnnotations, openPreview, t }: WebviewDockProps) {
  const state = useStore((s) => s)
  const latestHumanMessageSeq = useSession((session) =>
    session.nodes.findLast(node => node.kind === 'user')?.seq ?? -1)
  const [open, setOpen] = useState(false)
  const [retry, setRetry] = useState(0)
  const detailsId = useId()
  const revision = useRef(0)
  const hadAnnotations = useRef(false)
  const initialized = useRef(false)
  const lastHumanMessageSeq = useRef(latestHumanMessageSeq)
  const tRef = useRef(t)
  tRef.current = t
  const openPreviewRef = useRef(openPreview)
  openPreviewRef.current = openPreview

  // The dock entry stays mounted even while it renders no annotation chrome,
  // so it owns the session-wide assistant-link delegation. The browser's
  // normal external-link path remains available through modifier clicks.
  useEffect(() => {
    const handler = (event: MouseEvent): void => {
      const href = previewHrefFromClick(event)
      if (href === undefined) return
      event.preventDefault()
      openPreviewRef.current(href)
    }
    document.addEventListener('click', handler, true)
    return () => { document.removeEventListener('click', handler, true) }
  }, [])

  // Commit every store revision as a full snapshot. The injected function
  // serializes requests; the latest effect revision alone may publish status.
  useEffect(() => {
    const clearing = state.picks.length === 0
    const initialEmpty = clearing && !initialized.current
    initialized.current = true
    if (clearing && !hadAnnotations.current && !initialEmpty && state.annotationSync !== 'error') {
      actions.setAnnotationSync('synced')
      return
    }
    if (!clearing) hadAnnotations.current = true
    const currentRevision = ++revision.current
    if (!initialEmpty) actions.setAnnotationSync('syncing')
    const snapshot = annotationDraft(state.url, state.title, state.picks, state.selectedSkills)
    void syncAnnotations(snapshot).then(
      () => {
        if (revision.current !== currentRevision) return
        if (clearing) hadAnnotations.current = false
        actions.setAnnotationSync('synced')
      },
      () => {
        if (revision.current !== currentRevision) return
        actions.setAnnotationSync('error', tRef.current('dock.sync.error'))
      },
    )
    return () => { revision.current += 1 }
  }, [actions, retry, state.picks, state.selectedSkills, state.title, state.url, syncAnnotations])

  useEffect(() => {
    if (state.picks.length === 0) setOpen(false)
  }, [state.picks.length])

  // A new durable human message is the client-visible proof that stock
  // composer admission committed. Clear only annotations whose pending
  // snapshot was already acknowledged before that boundary; sending while a
  // sync is still in flight deliberately leaves them visible for retry.
  useEffect(() => {
    if (latestHumanMessageSeq <= lastHumanMessageSeq.current) return
    lastHumanMessageSeq.current = latestHumanMessageSeq
    if (state.picks.length > 0 && state.annotationSync === 'synced') actions.clearPicks()
  }, [actions, latestHumanMessageSeq, state.annotationSync, state.picks.length])

  const clearing = state.picks.length === 0
  if (clearing && state.annotationSync !== 'syncing' && state.annotationSync !== 'error') return null

  const count = state.picks.length
  const countLabel = clearing
    ? t('dock.clearing')
    : t('dock.count', { count: String(count) })
  const statusLabel = state.annotationSync === 'syncing'
    ? t('dock.syncing')
    : state.annotationSync === 'error'
      ? t('dock.sync.retry')
      : t('dock.synced')

  return (
    <div className={css.dock} data-webview-ui data-webview-annotations="">
      <div
        className={css.anchor}
        onMouseEnter={() => { if (!clearing) setOpen(true) }}
        onMouseLeave={(event) => {
          if (!event.currentTarget.contains(document.activeElement)) setOpen(false)
        }}
        onFocusCapture={() => { if (!clearing) setOpen(true) }}
        onBlurCapture={(event) => {
          const next = event.relatedTarget
          if (!(next instanceof Node) || !event.currentTarget.contains(next)) setOpen(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            setOpen(false)
          }
        }}
      >
        {open && !clearing && (
          <div
            id={detailsId}
            className={css.details}
            role="region"
            aria-label={t('dock.details')}
            data-webview-annotation-details=""
          >
            <ul className={css.list}>
              {state.picks.map((pick, index) => (
                <li key={pick.id} className={css.row} data-webview-annotation-row="">
                  <button
                    type="button"
                    className={css.rowMain}
                    aria-label={t('dock.focus', { index: String(index + 1), target: targetOf(pick.snapshot) })}
                    onClick={() => {
                      actions.setFocusPickId(pick.id)
                      setOpen(false)
                    }}
                  >
                    <span className={css.targetLine}>
                      <span className={css.index}>{index + 1}</span>
                      <span className={css.badge}>{kindOf(pick.snapshot)}</span>
                      <span className={css.target}>{targetOf(pick.snapshot)}</span>
                    </span>
                    <span className={pick.comment.trim() === '' ? css.emptyComment : css.comment}>
                      {pick.comment.trim() || t('dock.noComment')}
                    </span>
                    <span className={css.source}>{sourceOf(pick)}</span>
                  </button>
                  <button
                    type="button"
                    className={css.remove}
                    aria-label={t('panel.pick.remove')}
                    title={t('panel.pick.remove')}
                    data-webview-annotation-remove=""
                    onClick={() => { actions.removePick(pick.id) }}
                  >
                    <IconCloseOutline16 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div
          className={css.capsule}
          data-webview-annotation-capsule=""
          data-sync-status={state.annotationSync}
        >
          <button
            type="button"
            className={css.summary}
            aria-expanded={open}
            aria-controls={!clearing ? detailsId : undefined}
            aria-label={`${countLabel} · ${statusLabel}`}
            title={state.annotationSync === 'error' ? statusLabel : undefined}
            onClick={() => {
              if (state.annotationSync === 'error') setRetry(value => value + 1)
              if (!clearing) setOpen(true)
            }}
          >
            <span className={css.lead} aria-hidden><IconQueueOutline14 /></span>
            <span className={css.count}>{countLabel}</span>
            {state.annotationSync !== 'synced' && (
              <span className={css.status} title={statusLabel} aria-hidden>
                {state.annotationSync === 'syncing' && <IconLoadingOutline16 size={14} className={css.spinner} />}
                {state.annotationSync === 'error' && <IconWarningOutline16 size={14} />}
                {state.annotationSync === 'error' && <span>{t('dock.sync.failed')}</span>}
              </span>
            )}
          </button>
          {!clearing && (
            <button
              type="button"
              className={css.clear}
              aria-label={t('dock.clear')}
              title={t('dock.clear')}
              onClick={() => { actions.clearPicks() }}
            >
              <IconCloseOutline16 size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

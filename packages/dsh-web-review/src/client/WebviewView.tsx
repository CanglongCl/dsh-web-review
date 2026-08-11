/**
 * WebviewView: the "网页预览" conversation view tab. Renders browse chrome or
 * the annotation toolbar above a
 * full-height proxied iframe with the in-iframe element picker and annotation
 * echo layer (hover outline and numbered marker circles).
 *
 * Interaction model: the pick button (icon-only, far right of the URL row)
 * arms pick mode; clicking an element opens the host-owned white comment and
 * visual-property editor. Confirm commits its bounded diffs into the shared
 * store; Cancel restores the exact transaction baseline. Each annotation echoes
 * as a numbered circle — clicking it (or a dock detail row) re-opens the editor.
 *
 * The shared dock observes picks/url/title and commits the separate annotation
 * context; this view never touches the user's composer message. Assistant-link
 * delegation lives in the always-mounted annotation dock so it can activate
 * this view while Chat is visible.
 *
 * Presentation follows the dsh web design system: shared atoms (Input) and
 * the ic_ds_* icon set from @deepseek-ai/dsh-client-ui-primitives, plus the
 * --dsw-alias-* token vocabulary for everything custom. State arrives via
 * useStore/actions; no ctx, no contexts.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconNewChatOutline16,
  IconRefreshOutline16,
  IconRightUpOutline16,
  IconSendOutline16,
  IconTrashOutline16,
  IconWarningOutline16,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { ANNOTATION_LIMITS, MAX_ANNOTATIONS } from '../annotation-contract.ts'
import { proxyUrl } from '../proxy-url.ts'
import { ensurePicker, isSameOrigin, pickerOf, snapshotOf, type MarkerEntry, type PickerSurface } from './picker.ts'
import type { ElementSnapshot } from './contract.ts'
import type { PickItem } from './contract.ts'
import {
  AnnotationEditor,
  type AnnotationEditorMode,
  type AnnotationEditorValue,
  type ElementNavigationFeedback,
} from './AnnotationEditor.tsx'
import {
  applyCommitted,
  createLivePatch,
  restoreAll,
  type LiveElementPatch,
} from './live-patch.ts'
import { normalizePreviewUrl } from './navigation-url.ts'
import { sameElement, type ElementNavigationAction } from './element-navigation.ts'
import {
  discardEditorTransaction,
  rollbackEditorTransaction,
  type EditorPatchTransaction,
} from './editor-transaction.ts'
import type { WebviewStore } from './stores.ts'
import css from './WebviewView.module.css'

/** Full composed props: runtime + store + locale shares. */
export type WebviewSlotProps =
  & PropsRuntime<'conversation.view'>
  & PropsStore<WebviewStore>
  & PropsLocale<'webview'>
  & WebviewViewInjected

/** Session-bound actions supplied by the registration. */
export interface WebviewViewInjected {
  sendAnnotationsWithoutDraft: () => Promise<void>
}

interface EditorSession {
  id: string
  element: Element
  snapshot: ElementSnapshot
  existing: PickItem | null
  patch: LiveElementPatch
  /** Original committed target retained until a re-anchor is confirmed. */
  original: { element: Element; patch: LiveElementPatch } | null
  comment: string
  mode: AnnotationEditorMode
  navigationFeedback: ElementNavigationFeedback | null
}

/** Stable pick id without depending on crypto.randomUUID availability. */
function pickId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Read the iframe document title; cross-origin frames yield ''. */
function titleOf(frame: HTMLIFrameElement | null): string {
  if (frame === null) return ''
  try {
    return (frame.contentDocument?.title ?? '').slice(0, ANNOTATION_LIMITS.pageTitle)
  } catch {
    return ''
  }
}

/** The preview tab view (see module doc). */
export function WebviewView({
  useStore, useSession, useInput, inputActions, actions, sendAnnotationsWithoutDraft, t,
}: WebviewSlotProps) {
  const state = useStore((s) => s)
  const input = useInput(s => s)
  const promptError = useSession(session => session.promptError)
  // Effect/event callbacks read the freshest state and props through refs.
  const stateRef = useRef(state)
  stateRef.current = state
  const actionsRef = useRef(actions)
  actionsRef.current = actions
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  /** Live element references for each pick (echo markers + comment anchors). */
  const pickRefs = useRef(new Map<string, Element>())
  /** Host-owned annotation editor transaction. */
  const [editor, setEditor] = useState<EditorSession | null>(null)
  const editorRef = useRef(editor)
  editorRef.current = editor
  const navigationSequence = useRef(0)
  /** Exact inline/text rollback ledgers; DOM references never enter the store. */
  const patchRefs = useRef(new Map<string, LiveElementPatch>())
  const handledPickResetRevision = useRef(state.pickResetRevision)
  /** Whether the current frame content is same-origin (picker-capable). */
  const [pickerReady, setPickerReady] = useState(false)
  /** Browser Navigation API state, sampled after each iframe document load. */
  const [historyState, setHistoryState] = useState({ canGoBack: false, canGoForward: false })
  /** Dedicated annotation submission state; the stock composer stays untouched. */
  const [sendingAnnotations, setSendingAnnotations] = useState(false)
  const promptErrorAtSend = useRef(promptError)

  /** Reconcile the iframe marker circles with the current picks. The store
   * order is authoritative (pickRefs may briefly hold stale entries between
   * a navigation and the next frame load). */
  const syncMarkers = (): void => {
    const picker = pickerOf(frameRef.current)
    if (picker === null) return
    const entries: MarkerEntry[] = []
    stateRef.current.picks.forEach((pick, index) => {
      const el = pickRefs.current.get(pick.id)
      if (el !== undefined) entries.push({ id: pick.id, index: index + 1, element: el })
    })
    picker.syncMarkers(entries)
  }

  // Keep the echo markers in step with the pick list (add/remove/clear).
  useEffect(() => { syncMarkers() }, [state.picks])

  /** Re-anchor pick elements after a navigation (cssPath requery). */
  const refreshPickRefs = (): void => {
    const frame = frameRef.current
    const doc = frame?.contentDocument
    if (frame === null || doc === undefined || doc === null) return
    for (const pick of stateRef.current.picks) {
      const found = doc.querySelector(pick.snapshot.cssPath)
      if (found !== null && found.nodeType === 1) {
        pickRefs.current.set(pick.id, found)
        const previous = patchRefs.current.get(pick.id)
        if (previous !== undefined && previous.element !== found) restoreAll(previous)
        const patch = createLivePatch(found)
        applyCommitted(patch, pick.changes, pick.textChange)
        patchRefs.current.set(pick.id, patch)
      } else {
        pickRefs.current.delete(pick.id)
      }
    }
    syncMarkers()
  }

  const editorTransaction = (session: EditorSession): EditorPatchTransaction => {
    const committed = session.original === null || session.existing === null
      ? null
      : {
          patch: session.original.patch,
          changes: session.existing.changes,
          textChange: session.existing.textChange,
        }
    return { current: session.patch, committed }
  }

  const restoreEditorBaseline = (session: EditorSession): void => {
    rollbackEditorTransaction(editorTransaction(session))
  }

  const discardEditor = (session: EditorSession): void => {
    discardEditorTransaction(editorTransaction(session))
  }

  const closeEditor = (restore: boolean): void => {
    const current = editorRef.current
    if (current !== null && restore) restoreEditorBaseline(current)
    pickerOf(frameRef.current)?.clearSelection()
    setEditor(null)
  }

  const openEditor = (id: string, element: Element, existing: PickItem | null): void => {
    const current = editorRef.current
    if (current !== null && current.id !== id) restoreEditorBaseline(current)
    let patch: LiveElementPatch
    if (existing === null) {
      patch = createLivePatch(element)
    } else {
      patch = patchRefs.current.get(id) ?? createLivePatch(element)
      if (patch.element !== element) patch = createLivePatch(element)
      applyCommitted(patch, existing.changes, existing.textChange)
      patchRefs.current.set(id, patch)
    }
    pickerOf(frameRef.current)?.select(element)
    setEditor({
      id, element, snapshot: existing?.snapshot ?? snapshotOf(element), existing, patch,
      original: existing === null ? null : { element, patch },
      comment: existing?.comment ?? '', mode: 'collapsed', navigationFeedback: null,
    })
  }

  /** Change the current edit transaction's target without carrying element diffs. */
  const selectEditorElement = (
    element: Element,
    comment: string,
    mode: AnnotationEditorMode,
    action?: ElementNavigationAction,
  ): void => {
    const current = editorRef.current
    if (current === null || sameElement(current.element, element)) return
    restoreEditorBaseline(current)
    const original = current.original
    const returningToOriginal = original !== null && sameElement(original.element, element)
    const patch = returningToOriginal && original !== null
      ? original.patch
      : createLivePatch(element)
    pickerOf(frameRef.current)?.select(element)
    if (action !== undefined) navigationSequence.current += 1
    setEditor({
      ...current,
      element,
      snapshot: returningToOriginal && current.existing !== null
        ? current.existing.snapshot
        : snapshotOf(element),
      patch,
      comment,
      mode,
      navigationFeedback: mode !== 'select' && action !== undefined
        ? { action, sequence: navigationSequence.current }
        : null,
    })
  }

  /** Re-open the host editor (marker-circle click or dock focus signal). */
  const onMarkClick = (id: string): void => {
    const pick = stateRef.current.picks.find((p) => p.id === id)
    const el = pickRefs.current.get(id)
    if (pick !== undefined && el !== undefined) openEditor(id, el, pick)
  }

  /** Wire the handoff callbacks on a (re-)injected picker surface. */
  const wireHandoff = (picker: PickerSurface): void => {
    picker.onPick = (el) => {
      if (stateRef.current.picks.length >= MAX_ANNOTATIONS) {
        actionsRef.current.setError(t('panel.pick.limit', { count: String(MAX_ANNOTATIONS) }))
        return
      }
      const id = pickId()
      openEditor(id, el, null)
    }
    picker.onCancel = () => {
      if (stateRef.current.pickMode) actionsRef.current.togglePickMode()
    }
    picker.onMarkClick = (id) => { onMarkClick(id) }
  }

  // After a frame load: detect same-origin, (re-)inject the picker, wire the
  // handoff, rebuild the echo markers, and honor an armed pick mode.
  const onFrameLoad = (): void => {
    const frame = frameRef.current
    if (frame === null) return
    if (!isSameOrigin(frame)) {
      setPickerReady(false)
      actionsRef.current.setTitle('')
      return
    }
    const navigation = (frame.contentWindow as (Window & {
      navigation?: { canGoBack: boolean; canGoForward: boolean }
    }) | null)?.navigation
    setHistoryState({
      canGoBack: navigation?.canGoBack ?? false,
      canGoForward: navigation?.canGoForward ?? false,
    })
    actionsRef.current.setTitle(titleOf(frame))
    if (editorRef.current !== null) closeEditor(true)
    const picker = ensurePicker(frame)
    setPickerReady(picker !== null)
    if (picker !== null) {
      wireHandoff(picker)
      refreshPickRefs()
      if (stateRef.current.pickMode && !picker.isActive()) picker.activate()
    }
  }

  // Pick-mode lifecycle: activate/deactivate the injected picker and cancel
  // an uncommitted host-editor transaction when picking ends.
  useEffect(() => {
    const frame = frameRef.current
    if (frame === null) return
    const picker = pickerOf(frame)
    if (picker === null) return
    if (state.pickMode && !picker.isActive()) picker.activate()
    if (!state.pickMode) {
      if (picker.isActive()) picker.deactivate()
      if (editorRef.current !== null) closeEditor(true)
    }
  }, [state.pickMode])

  // Annotation removal/clear/send consumes its temporary page mutation too.
  useEffect(() => {
    const ids = new Set(state.picks.map(pick => pick.id))
    const reset = handledPickResetRevision.current !== state.pickResetRevision
    handledPickResetRevision.current = state.pickResetRevision
    const current = editorRef.current
    if (current !== null && (reset || (current.existing !== null && !ids.has(current.id)))) {
      discardEditor(current)
      pickerOf(frameRef.current)?.clearSelection()
      setEditor(null)
    }
    for (const [id, patch] of patchRefs.current) {
      if (ids.has(id)) continue
      restoreAll(patch)
      patchRefs.current.delete(id)
      pickRefs.current.delete(id)
    }
  }, [state.pickResetRevision, state.picks])

  // HMR/unmount must not strand temporary inline declarations in the page.
  useEffect(() => () => {
    const current = editorRef.current
    if (current !== null) discardEditor(current)
    for (const patch of patchRefs.current.values()) restoreAll(patch)
    patchRefs.current.clear()
    pickRefs.current.clear()
  }, [])

  // Focus signal: a dock detail row clicked this pick id — locate the element in
  // the frame (live ref, else re-anchor by cssPath) and re-open its comment.
  // The signal is one-shot: consumed here, so a later re-click re-triggers.
  useEffect(() => {
    const id = state.focusPickId
    if (id === null) return
    const pick = stateRef.current.picks.find((p) => p.id === id)
    let el = pickRefs.current.get(id)
    if (el === undefined && pick !== undefined) {
      const doc = frameRef.current?.contentDocument
      if (doc !== null && doc !== undefined) {
        const found = doc.querySelector(pick.snapshot.cssPath)
        // Realm-safe element check: the frame document is a separate realm,
        // so `found instanceof Element` is false there (and in jsdom).
        if (found !== null && found.nodeType === 1) el = found
      }
    }
    if (pick !== undefined && el !== undefined) openEditor(id, el, pick)
    actionsRef.current.setFocusPickId(null)
  }, [state.focusPickId])

  // The dock consumes only a matching durable plugin-context id and then
  // clears the picks. That exact store transition is this view's success edge.
  useEffect(() => {
    if (!sendingAnnotations || state.picks.length !== 0) return
    setSendingAnnotations(false)
    if (stateRef.current.pickMode) actionsRef.current.togglePickMode()
  }, [sendingAnnotations, state.picks.length])

  // Prompt failures stay on the stock session surface; mirror a concise
  // Preview error and keep the annotation state retryable.
  useEffect(() => {
    if (!sendingAnnotations || promptError === null || promptError === promptErrorAtSend.current) return
    setSendingAnnotations(false)
    actionsRef.current.setError(t('panel.pick.sendError'))
  }, [promptError, sendingAnnotations, t])

  /** Navigate the iframe to `url`; a new page invalidates the previous picks. */
  const navigate = (url: string): void => {
    const normalized = normalizePreviewUrl(url)
    if (normalized === undefined || normalized.length > ANNOTATION_LIMITS.pageUrl) {
      actions.setError(t('panel.urlInvalid'))
      return
    }
    actions.setError(null)
    setHistoryState({ canGoBack: false, canGoForward: false })
    actions.setUrl(normalized)
    actions.setTitle('')
    actions.clearPicks()
  }

  const frameSrc = state.url !== '' ? proxyUrl(state.url) : undefined
  const pickDisabled = !pickerReady || state.url === ''
  const visibleError = state.annotationSync.status === 'error' ? state.annotationSync.message : state.error
  const inputBusy = input.phase === 'adjudicating' || input.phase === 'submitting'
  const canSendAnnotations = state.picks.length > 0
    && state.annotationSync.status === 'ready'
    && !sendingAnnotations
    && !inputBusy

  const submitAnnotations = async (): Promise<void> => {
    if (!canSendAnnotations) return
    if (input.draft.trim().startsWith('/')) {
      actions.setError(t('panel.pick.slashDraft'))
      return
    }
    setSendingAnnotations(true)
    actions.setError(null)
    if (input.draft.trim() !== '') {
      promptErrorAtSend.current = promptError
      inputActions.submit()
      return
    }
    try {
      await sendAnnotationsWithoutDraft()
      if (stateRef.current.pickMode) actionsRef.current.togglePickMode()
    } catch {
      actions.setError(t('panel.pick.sendError'))
    } finally {
      setSendingAnnotations(false)
    }
  }

  const confirmEditor = (value: AnnotationEditorValue): void => {
    const current = editorRef.current
    if (current === null) return
    if (current.existing !== null && !stateRef.current.picks.some(pick => pick.id === current.id)) {
      discardEditor(current)
      pickerOf(frameRef.current)?.clearSelection()
      setEditor(null)
      return
    }
    const pick: PickItem = {
      id: current.id,
      snapshot: current.snapshot,
      comment: value.comment,
      changes: value.changes,
      textChange: value.textChange,
      viewport: value.viewport,
    }
    if (current.existing !== null && current.original !== null && !sameElement(current.original.element, current.element)) {
      restoreAll(current.original.patch)
    }
    patchRefs.current.set(current.id, current.patch)
    pickRefs.current.set(current.id, current.element)
    if (current.existing === null) actions.addPick(pick)
    else actions.updatePick(current.id, pick)
    pickerOf(frameRef.current)?.clearSelection()
    setEditor(null)
  }

  return (
    <div className={css.panel} data-webview-ui data-webview-panel="">
      {state.pickMode
        ? (
          <div className={css.annotationBar} data-webview-annotation-toolbar="">
            <button
              type="button"
              className={css.annotationIcon}
              aria-label={t('panel.pick.off')}
              title={t('panel.pick.off')}
              onClick={() => { actions.togglePickMode() }}
            >
              <IconCloseOutline16 size={16} />
            </button>
            <button
              type="button"
              className={css.annotationIcon}
              aria-label={t('panel.pick.clear')}
              title={t('panel.pick.clear')}
              disabled={state.picks.length === 0 || sendingAnnotations}
              onClick={() => { actions.clearPicks() }}
            >
              <IconTrashOutline16 size={16} />
            </button>
            <div className={css.annotationTitle} title={state.url}>
              {t('panel.pick.active', { url: state.url })}
            </div>
            <button
              type="button"
              className={css.annotationSend}
              disabled={!canSendAnnotations}
              aria-label={`${t('panel.pick.send')} ${String(state.picks.length)}`}
              onClick={() => { void submitAnnotations() }}
            >
              <IconSendOutline16 size={14} />
              <span>{sendingAnnotations ? t('panel.pick.sending') : t('panel.pick.send')}</span>
              <span className={css.annotationCount} aria-hidden>({state.picks.length})</span>
            </button>
          </div>
        )
        : (
          <div className={css.urlRow}>
            <button
              type="button"
              className={css.icon}
              aria-label={t('panel.back')}
              title={t('panel.back')}
              disabled={!historyState.canGoBack}
              onClick={() => { frameRef.current?.contentWindow?.history.back() }}
            >
              <IconChevronLeftOutline14 size={16} />
            </button>
            <button
              type="button"
              className={css.icon}
              aria-label={t('panel.forward')}
              title={t('panel.forward')}
              disabled={!historyState.canGoForward}
              onClick={() => { frameRef.current?.contentWindow?.history.forward() }}
            >
              <IconChevronRightOutline14 size={16} />
            </button>
            <button
              type="button"
              className={css.icon}
              aria-label={t('panel.refresh')}
              title={t('panel.refresh')}
              disabled={state.url === ''}
              onClick={() => { frameRef.current?.contentWindow?.location.reload() }}
            >
              <IconRefreshOutline16 size={16} />
            </button>
            <div className={css.urlField}>
              <Input
                className={css.url ?? ''}
                value={state.urlDraft}
                maxLength={ANNOTATION_LIMITS.pageUrl}
                placeholder={t('panel.urlPlaceholder')}
                onChange={(e) => {
                  actions.setUrlDraft(e.target.value)
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(state.urlDraft) }}
                spellCheck={false}
              />
              {state.url !== '' && (
                <a
                  className={css.inlineAction}
                  href={state.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('panel.external')}
                  title={t('panel.external')}
                >
                  <IconRightUpOutline16 size={12} />
                </a>
              )}
            </div>
            <button
              type="button"
              className={clsx(css.icon, css.commentIcon)}
              aria-label={t('panel.pick')}
              title={t('panel.pick')}
              disabled={pickDisabled}
              onClick={() => { actions.togglePickMode() }}
            >
              <IconNewChatOutline16 size={16} />
            </button>
          </div>
        )}
      {visibleError !== null && (
        <div className={css.error} role="alert" title={visibleError} data-webview-error="">
          <IconWarningOutline16 size={14} className={css.errorIcon} />
          <span>{visibleError}</span>
        </div>
      )}
      <div className={css.body} data-webview-preview-body="">
        <div className={css.frameWrap}>
          {frameSrc !== undefined
            ? (
              <iframe
                ref={frameRef}
                className={css.frame}
                src={frameSrc}
                title={t('panel.frame')}
                onLoad={onFrameLoad}
              />
            )
            : <div className={css.frameOverlay}>{t('panel.noUrl')}</div>}
          {editor !== null && frameRef.current !== null && (
            <AnnotationEditor
              key={`${editor.id}:${editor.snapshot.cssPath}`}
              id={editor.id}
              patch={editor.patch}
              frame={frameRef.current}
              comment={editor.comment}
              changes={editor.original !== null && sameElement(editor.original.element, editor.element) ? editor.existing?.changes ?? [] : []}
              textChange={editor.original !== null && sameElement(editor.original.element, editor.element) ? editor.existing?.textChange ?? null : null}
              initialMode={editor.mode}
              navigationFeedback={editor.navigationFeedback}
              t={t}
              onCancel={() => { closeEditor(false) }}
              onConfirm={confirmEditor}
              onSelectElement={selectEditorElement}
            />
          )}
        </div>
      </div>
    </div>
  )
}

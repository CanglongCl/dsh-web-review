/**
 * WebviewView: the "网页预览" conversation view tab. Renders browse chrome or
 * the annotation toolbar above a
 * full-height isolated iframe with the bridge-owned picker and annotation
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
import type {
  PreviewElementHandle,
  PreviewElementNavigationAction,
  PreviewElementTarget,
  PreviewSessionDescriptor,
  PreviewSessionId,
  PreviewTreeNode,
} from '../preview-contract.ts'
import type { PickItem } from './contract.ts'
import type { PageSnapshotDraft, PageSnapshotReceipt } from '../snapshot-contract.ts'
import {
  AnnotationEditor,
  type AnnotationEditorMode,
  type AnnotationEditorValue,
  type ElementNavigationFeedback,
} from './AnnotationEditor.tsx'
import { normalizePreviewUrl } from './navigation-url.ts'
import type { WebviewStore } from './stores.ts'
import type { FloatingEditorPosition, FloatingEditorSize } from './floating-position.ts'
import { readEditorSize, writeEditorSize } from './editor-size-memory.ts'
import {
  PreviewBridgeClient,
  type PreviewReadyState,
} from './preview-bridge.ts'
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
  returnToChat: () => void
  createPreviewSession: (target: string) => Promise<PreviewSessionDescriptor>
  releasePreviewSessions: (sessionIds: readonly PreviewSessionId[]) => Promise<void>
  /** Archive one captured page snapshot on the node face (session-bound). */
  uploadPageSnapshot: (payload: PageSnapshotDraft) => Promise<PageSnapshotReceipt>
}

interface EditorSession {
  id: string
  target: PreviewElementTarget
  existing: PickItem | null
  initialFocus: 'editor' | 'comment'
  originalHandle: PreviewElementHandle | null
  tree: PreviewTreeNode | null
  comment: string
  mode: AnnotationEditorMode
  navigationFeedback: ElementNavigationFeedback | null
  position: FloatingEditorPosition | null
  size: FloatingEditorSize | null
}

function loadPreferredEditorSize(): FloatingEditorSize | null {
  try {
    return typeof window === 'undefined' ? null : readEditorSize(window.localStorage)
  } catch {
    return null
  }
}

function persistPreferredEditorSize(size: FloatingEditorSize): void {
  try {
    writeEditorSize(window.localStorage, size)
  } catch {
    // Access to profile storage can be disabled; in-memory memory still works.
  }
}

/** Stable pick id without depending on crypto.randomUUID availability. */
function pickId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** The preview tab view (see module doc). */
export function WebviewView({
  useStore, useSession, useInput, inputActions, actions, sendAnnotationsWithoutDraft,
  returnToChat, createPreviewSession, releasePreviewSessions, uploadPageSnapshot, t,
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
  const bridgeRef = useRef<PreviewBridgeClient | null>(null)
  const [descriptor, setDescriptor] = useState<PreviewSessionDescriptor | null>(null)
  const [previewRequestRevision, setPreviewRequestRevision] = useState(0)
  const sessionRequest = useRef(0)
  const loadedPageUrl = useRef<string | null>(null)
  const mounted = useRef(true)
  /** Host-owned annotation editor transaction. */
  const [editor, setEditor] = useState<EditorSession | null>(null)
  const editorRef = useRef(editor)
  editorRef.current = editor
  const navigationSequence = useRef(0)
  const preferredEditorSize = useRef<FloatingEditorSize | null>(loadPreferredEditorSize())
  const handledPickResetRevision = useRef(state.pickResetRevision)
  /** The isolated bridge has completed its exact-Origin handshake. */
  const [pickerReady, setPickerReady] = useState(false)
  const [historyState, setHistoryState] = useState({ canGoBack: false, canGoForward: false })
  /** Dedicated annotation submission state; the stock composer stays untouched. */
  const [sendingAnnotations, setSendingAnnotations] = useState(false)
  const promptErrorAtSend = useRef(promptError)
  const onPickRef = useRef<(target: PreviewElementTarget) => void>(() => undefined)
  const onMarkClickRef = useRef<(id: string) => void>(() => undefined)
  const onShortcutRef = useRef<(action: PreviewElementNavigationAction) => void>(() => undefined)
  /** Send-time snapshot capture dedupe and dock-request bookkeeping. */
  const lastCaptureAtRef = useRef(0)
  const captureInFlightRef = useRef(false)
  const pickerReadyRef = useRef(false)
  const handledSnapshotRequestRef = useRef(0)

  useEffect(() => { pickerReadyRef.current = pickerReady }, [pickerReady])

  const release = (ids: readonly PreviewSessionId[]): void => {
    if (ids.length === 0) return
    void releasePreviewSessions(ids).catch(() => undefined)
  }

  const closeEditor = (restore: boolean): void => {
    if (editorRef.current !== null && restore) bridgeRef.current?.cancelEdit()
    else bridgeRef.current?.clearSelection()
    setEditor(null)
  }

  const loadTree = (id: string, handle: PreviewElementHandle): void => {
    const bridge = bridgeRef.current
    if (bridge === null) return
    void bridge.readTree(handle).then((tree) => {
      setEditor(current => current === null || current.id !== id || current.target.handle !== handle
        ? current
        : { ...current, tree })
    }).catch(() => undefined)
  }

  const openEditor = (
    id: string,
    target: PreviewElementTarget,
    existing: PickItem | null,
    initialFocus: EditorSession['initialFocus'] = 'editor',
  ): void => {
    const current = editorRef.current
    if (current !== null && current.id !== id) bridgeRef.current?.cancelEdit()
    setEditor({
      id,
      target,
      existing,
      initialFocus,
      originalHandle: existing === null ? null : target.handle,
      tree: null,
      comment: existing?.comment ?? '',
      mode: 'collapsed',
      navigationFeedback: null,
      position: null,
      size: preferredEditorSize.current,
    })
    loadTree(id, target.handle)
  }

  const selectEditorTarget = (
    target: PreviewElementTarget,
    comment: string,
    mode: AnnotationEditorMode,
    action?: PreviewElementNavigationAction,
  ): void => {
    const current = editorRef.current
    if (current === null || current.target.handle === target.handle) return
    if (action !== undefined) navigationSequence.current += 1
    setEditor({
      ...current,
      target,
      initialFocus: 'editor',
      tree: null,
      comment,
      mode,
      navigationFeedback: mode !== 'select' && action !== undefined
        ? { action, sequence: navigationSequence.current }
        : null,
    })
    loadTree(current.id, target.handle)
  }

  const navigateEditorTarget = (
    action: PreviewElementNavigationAction,
    comment: string,
    mode: AnnotationEditorMode,
  ): void => {
    const current = editorRef.current
    const bridge = bridgeRef.current
    if (current === null || bridge === null) return
    const sequence = ++navigationSequence.current
    void bridge.navigateElement(current.target.handle, action).then((target) => {
      if (target === null || sequence !== navigationSequence.current) return
      selectEditorTarget(target, comment, mode, action)
    }).catch(() => undefined)
  }

  const selectTreeTarget = (
    handle: PreviewElementHandle,
    comment: string,
    mode: AnnotationEditorMode,
  ): void => {
    const current = editorRef.current
    const bridge = bridgeRef.current
    if (current === null || bridge === null) return
    const sequence = ++navigationSequence.current
    void bridge.selectElement(handle).then((target) => {
      if (target === null || sequence !== navigationSequence.current) return
      selectEditorTarget(target, comment, mode)
    }).catch(() => undefined)
  }

  const onMarkClick = (id: string): void => {
    const pick = stateRef.current.picks.find((p) => p.id === id)
    const bridge = bridgeRef.current
    if (pick === undefined || bridge === null) return
    void bridge.openPick(id, pick.snapshot.cssPath).then((target) => {
      if (target !== null) openEditor(id, target, pick)
    }).catch(() => undefined)
  }

  onPickRef.current = (target) => {
    if (stateRef.current.picks.length >= MAX_ANNOTATIONS) {
      actionsRef.current.setError(t('panel.pick.limit', { count: String(MAX_ANNOTATIONS) }))
      bridgeRef.current?.cancelEdit()
      return
    }
    openEditor(pickId(), target, null, 'comment')
  }
  onMarkClickRef.current = onMarkClick
  onShortcutRef.current = (action) => {
    const current = editorRef.current
    if (current !== null) navigateEditorTarget(action, current.comment, current.mode)
  }

  // A store URL that came from the bridge already belongs to the current
  // session. Address-bar/assistant URL changes create a fresh isolated Origin.
  useEffect(() => {
    if (state.url === loadedPageUrl.current) return
    sessionRequest.current += 1
    const request = sessionRequest.current
    setPickerReady(false)
    setHistoryState({ canGoBack: false, canGoForward: false })
    setDescriptor(null)
    if (state.url === '') {
      loadedPageUrl.current = null
      setDescriptor(null)
      return
    }
    loadedPageUrl.current = state.url
    void createPreviewSession(state.url).then((next) => {
      if (!mounted.current || request !== sessionRequest.current) {
        release([next.sessionId])
        return
      }
      setDescriptor(next)
    }).catch(() => {
      if (mounted.current && request === sessionRequest.current) {
        loadedPageUrl.current = null
        actionsRef.current.setError(t('panel.previewUnavailable'))
      }
    })
  }, [state.url, previewRequestRevision, createPreviewSession, t])

  useEffect(() => {
    const frame = frameRef.current
    if (descriptor === null || frame === null) return
    const bridge = new PreviewBridgeClient(frame, descriptor, {
      onReady: (ready: PreviewReadyState) => {
        setPickerReady(true)
        setHistoryState({ canGoBack: ready.canGoBack, canGoForward: ready.canGoForward })
        actionsRef.current.setError(null)
        actionsRef.current.setTitle(ready.title)
        loadedPageUrl.current = ready.pageUrl
        if (stateRef.current.url !== ready.pageUrl) actionsRef.current.setUrl(ready.pageUrl)
        if (editorRef.current !== null) setEditor(null)
        bridge.syncMarkers(stateRef.current.picks)
        if (stateRef.current.pickMode) bridge.activate()
      },
      onPick: target => { onPickRef.current(target) },
      onCancelPick: () => {
        if (stateRef.current.pickMode) actionsRef.current.togglePickMode()
      },
      onMarkClick: id => { onMarkClickRef.current(id) },
      onTargetGeometry: (handle, rect, viewport) => {
        setEditor(current => current === null || current.target.handle !== handle
          ? current
          : { ...current, target: { ...current.target, rect, viewport } })
      },
      onShortcut: action => { onShortcutRef.current(action) },
      onHandoff: () => {
        setPickerReady(false)
        setHistoryState({ canGoBack: false, canGoForward: false })
        actionsRef.current.setTitle('')
        actionsRef.current.clearPicks()
        actionsRef.current.setSnapshotSync({ status: 'idle' })
        setEditor(null)
      },
      onUnavailable: () => {
        setPickerReady(false)
        actionsRef.current.setError(t('panel.previewUnavailable'))
      },
    })
    bridgeRef.current = bridge
    // Arm the exact-source/exact-Origin listener before starting navigation.
    // This is essential for an initial response that immediately crosses
    // target Origins: its short-lived handoff document must not post before
    // the parent knows the server-issued next descriptor.
    frame.src = descriptor.frameUrl
    return () => {
      if (bridgeRef.current === bridge) bridgeRef.current = null
      release(bridge.dispose())
    }
  }, [descriptor, releasePreviewSessions, t])

  useEffect(() => () => {
    mounted.current = false
    sessionRequest.current += 1
  }, [])

  const onFrameLoad = (): void => { bridgeRef.current?.frameLoaded() }

  useEffect(() => {
    const bridge = bridgeRef.current
    if (bridge === null) return
    if (state.pickMode) bridge.activate()
    if (!state.pickMode) {
      bridge.deactivate()
      if (editorRef.current !== null) closeEditor(true)
    }
  }, [state.pickMode])

  useEffect(() => {
    const ids = new Set(state.picks.map(pick => pick.id))
    const reset = handledPickResetRevision.current !== state.pickResetRevision
    handledPickResetRevision.current = state.pickResetRevision
    const current = editorRef.current
    if (current !== null && (reset || (current.existing !== null && !ids.has(current.id)))) {
      bridgeRef.current?.cancelEdit()
      setEditor(null)
    }
    bridgeRef.current?.syncMarkers(state.picks)
  }, [state.pickResetRevision, state.picks])

  useEffect(() => {
    const id = state.focusPickId
    if (id === null) return
    onMarkClick(id)
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
    loadedPageUrl.current = null
    setPreviewRequestRevision(value => value + 1)
    setHistoryState({ canGoBack: false, canGoForward: false })
    actions.setUrl(normalized)
    actions.setTitle('')
    actions.clearPicks()
    actions.setSnapshotSync({ status: 'idle' })
  }

  const frameSrc = descriptor?.frameUrl
  const pickDisabled = !pickerReady || state.url === ''
  const visibleError = state.annotationSync.status === 'error' ? state.annotationSync.message : state.error
  const inputBusy = input.phase === 'adjudicating' || input.phase === 'submitting'
  const canSendAnnotations = state.picks.length > 0
    && state.annotationSync.status === 'ready'
    && !sendingAnnotations
    && !inputBusy

  /** Capture + archive the annotated page before the send is admitted. */
  const capturePageSnapshot = async (): Promise<void> => {
    const bridge = bridgeRef.current
    const current = stateRef.current
    if (bridge === null || !pickerReadyRef.current || current.url === '' || captureInFlightRef.current) return
    captureInFlightRef.current = true
    lastCaptureAtRef.current = Date.now()
    actionsRef.current.setSnapshotSync({ status: 'capturing' })
    try {
      const captured = await bridge.captureSnapshot()
      if (captured === null) throw new Error('page capture unavailable')
      const receipt = await uploadPageSnapshot({
        page: { url: current.url, title: current.title },
        viewport: captured.viewport,
        scroll: captured.scroll,
        html: captured.html,
        screenshot: captured.screenshot,
        screenshotError: captured.screenshotError,
      })
      if (receipt.kind === 'saved') {
        actionsRef.current.setSnapshotSync({ status: 'saved', dir: receipt.dir })
      } else if (receipt.kind === 'disabled') {
        actionsRef.current.setSnapshotSync({ status: 'idle' })
      }
    } catch (error) {
      actionsRef.current.setSnapshotSync({
        status: 'error',
        message: error instanceof Error ? error.message : 'page snapshot failed',
      })
    } finally {
      captureInFlightRef.current = false
    }
  }

  /** Best-effort awaited capture; the snapshot never blocks an annotated send. */
  const captureForSend = async (): Promise<void> => {
    await Promise.race([
      capturePageSnapshot(),
      new Promise<void>((resolve) => { setTimeout(resolve, 5_000) }),
    ])
  }

  // The always-mounted dock bumps the request revision when a new user
  // message arrives while annotations are pending (stock-composer annotated
  // sends); the dedicated send above awaited its own capture and the
  // timestamp window prevents a duplicate.
  useEffect(() => {
    if (state.snapshotRequestRevision === handledSnapshotRequestRef.current) return
    handledSnapshotRequestRef.current = state.snapshotRequestRevision
    if (Date.now() - lastCaptureAtRef.current < 2_000) return
    void capturePageSnapshot()
  }, [state.snapshotRequestRevision])

  const submitAnnotations = async (): Promise<void> => {
    if (!canSendAnnotations) return
    if (input.draft.trim().startsWith('/')) {
      actions.setError(t('panel.pick.slashDraft'))
      return
    }
    setSendingAnnotations(true)
    actions.setError(null)
    await captureForSend()
    if (input.draft.trim() !== '') {
      promptErrorAtSend.current = promptError
      inputActions.submit()
      returnToChat()
      return
    }
    try {
      await sendAnnotationsWithoutDraft()
      returnToChat()
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
      bridgeRef.current?.cancelEdit()
      setEditor(null)
      return
    }
    const pick: PickItem = {
      id: current.id,
      snapshot: current.originalHandle === current.target.handle && current.existing !== null
        ? current.existing.snapshot
        : current.target.snapshot,
      comment: value.comment,
      changes: value.changes,
      textChange: value.textChange,
      viewport: value.viewport,
    }
    bridgeRef.current?.commitEdit(current.id, current.target.handle, value.changes, value.textChange)
    if (current.existing === null) actions.addPick(pick)
    else actions.updatePick(current.id, pick)
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
              onClick={() => { bridgeRef.current?.historyBack() }}
            >
              <IconChevronLeftOutline14 size={16} />
            </button>
            <button
              type="button"
              className={css.icon}
              aria-label={t('panel.forward')}
              title={t('panel.forward')}
              disabled={!historyState.canGoForward}
              onClick={() => { bridgeRef.current?.historyForward() }}
            >
              <IconChevronRightOutline14 size={16} />
            </button>
            <button
              type="button"
              className={css.icon}
              aria-label={t('panel.refresh')}
              title={t('panel.refresh')}
              disabled={state.url === ''}
              onClick={() => { bridgeRef.current?.reload() }}
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
      {state.snapshotSync.status !== 'idle' && (
        <div
          className={css.snapshotLine}
          data-webview-snapshot-status={
            state.snapshotSync.status === 'capturing' ? 'capturing'
              : state.snapshotSync.status === 'saved' ? 'saved'
                : 'error'
          }
          {...(state.snapshotSync.status === 'saved'
            ? { 'data-webview-snapshot-dir': state.snapshotSync.dir }
            : {})}
          title={state.snapshotSync.status === 'saved' ? state.snapshotSync.dir : undefined}
        >
          {state.snapshotSync.status === 'capturing' && t('panel.snapshot.capturing')}
          {state.snapshotSync.status === 'saved' && t('panel.snapshot.saved', { dir: state.snapshotSync.dir })}
          {state.snapshotSync.status === 'error' && t('panel.snapshot.error')}
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
                src="about:blank"
                title={t('panel.frame')}
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock allow-presentation"
                referrerPolicy="no-referrer"
                onLoad={onFrameLoad}
              />
            )
            : <div className={css.frameOverlay}>{state.url === '' ? t('panel.noUrl') : t('panel.loading')}</div>}
          {editor !== null && frameRef.current !== null && (
            <AnnotationEditor
              key={`${editor.id}:${editor.target.handle}`}
              id={editor.id}
              target={editor.target}
              tree={editor.tree}
              frame={frameRef.current}
              comment={editor.comment}
              changes={editor.originalHandle === editor.target.handle ? editor.existing?.changes ?? [] : []}
              textChange={editor.originalHandle === editor.target.handle ? editor.existing?.textChange ?? null : null}
              initialMode={editor.mode}
              initialFocus={editor.initialFocus}
              navigationFeedback={editor.navigationFeedback}
              selectedSkills={state.selectedSkills}
              position={editor.position}
              size={editor.size}
              t={t}
              onCommentChange={(comment) => {
                setEditor(current => current === null ? null : { ...current, comment })
              }}
              onCancel={() => { closeEditor(true) }}
              onConfirm={confirmEditor}
              onToggleSkill={actions.toggleSelectedSkill}
              onNavigateTarget={navigateEditorTarget}
              onSelectTarget={selectTreeTarget}
              onPreviewStyle={(property, value) => {
                bridgeRef.current?.previewStyle(editor.target.handle, property, value)
              }}
              onRestoreStyle={(property) => {
                bridgeRef.current?.restoreStyle(editor.target.handle, property)
              }}
              onPreviewText={(value) => {
                bridgeRef.current?.previewText(editor.target.handle, value)
              }}
              onRestoreText={() => {
                bridgeRef.current?.restoreText(editor.target.handle)
              }}
              onPositionChange={(position) => {
                setEditor(current => current === null ? null : { ...current, position })
              }}
              onSizeChange={(size) => {
                setEditor(current => current === null ? null : { ...current, size })
              }}
              onSizeCommit={(size) => {
                preferredEditorSize.current = size
                persistPreferredEditorSize(size)
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

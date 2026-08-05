/**
 * Webview header action + floating panel: the entry point registered into
 * the conversation header's action list. The component renders the toggle
 * button, the floating right-edge overlay (portal to document.body), the
 * link interceptor (capture-phase, active only while the panel is open),
 * and the picker lifecycle inside the same-origin iframe.
 *
 * Interaction model: the pick button (icon-only, far right of the URL row)
 * arms pick mode; clicking an element in the iframe opens a floating comment
 * field next to it; Enter commits the annotation into the horizontal
 * "注释" chip bar, Esc dismisses. Each annotation echoes as a numbered
 * circle floating over its element in the iframe — clicking a circle or a
 * chip re-expands that element's comment field.
 *
 * Presentation follows the dsh web design system: shared atoms (Button,
 * Input) and the ic_ds_* icon set from @deepseek-ai/dsh-client-ui-primitives,
 * plus the --dsw-alias-* token vocabulary for everything custom. State
 * arrives via useStore/actions, the send path via the injected sendText
 * callback; no ctx, no contexts.
 */
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  Button,
  IconBrowseOutline16,
  IconCheckOutline16,
  IconCloseOutline16,
  IconLinkOutline16,
  IconListPenOutline16,
  IconLoadingOutline16,
  IconRefreshOutline16,
  IconRightUpOutline16,
  IconSendOutline16,
  IconWarningOutline16,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { proxyUrl } from '../rewrite.ts'
import { ensurePicker, isSameOrigin, pickFromElement, pickerOf, type MarkerEntry, type PickerSurface } from './picker.ts'
import { formatAnnotation } from './format.ts'
import type { ElementSnapshot } from './contract.ts'
import type { WebviewStore } from './stores.ts'

/** The inject face: the thin, scope-addressed send path (assembly in apply). */
export interface WebviewInjected {
  sendText: (text: string) => Promise<void>
}

/** Full composed props: runtime + store + locale + inject shares. */
export type WebviewSlotProps =
  & PropsRuntime<'conversation.session.header.actions'>
  & PropsStore<WebviewStore>
  & PropsLocale<'webview'>
  & WebviewInjected

/** Stable pick id without depending on crypto.randomUUID availability. */
function pickId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Read the iframe document title; cross-origin frames yield ''. */
function titleOf(frame: HTMLIFrameElement | null): string {
  if (frame === null) return ''
  try {
    return frame.contentDocument?.title ?? ''
  } catch {
    return ''
  }
}

/** Compact element identity for the chip bar: tag#id.class1.class2. */
function elementLabel(s: ElementSnapshot): string {
  const id = s.id !== '' ? `#${s.id}` : ''
  const classes = s.className !== ''
    ? `.${s.className.trim().split(/\s+/).filter(Boolean).join('.')}`
    : ''
  return `${s.tagName}${id}${classes}`
}

/** The header action button + floating overlay panel (see module doc). */
export function WebviewHeaderAction({ useStore, actions, sendText, t }: WebviewSlotProps) {
  const state = useStore((s) => s)
  // Interceptor/picker effects read the freshest state through refs.
  const stateRef = useRef(state)
  stateRef.current = state
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  /** Live element references for each pick (echo markers + comment anchors). */
  const pickRefs = useRef(new Map<string, Element>())
  /** The in-flight pick whose comment field is open (not yet committed). */
  const pendingRef = useRef<{ id: string; el: Element } | null>(null)
  /** Chip nodes by pick id (scroll-into-view on marker clicks). */
  const chipRefs = useRef(new Map<string, HTMLDivElement | null>())
  /** Whether the current frame content is same-origin (picker-capable). */
  const [pickerReady, setPickerReady] = useState(false)
  /** Bump to force an iframe remount (refresh button). */
  const [frameKey, setFrameKey] = useState(0)
  /** Splitter drag is in flight (drives the active affordance). */
  const [splitDragging, setSplitDragging] = useState(false)
  /** Chip id currently flashed (marker-click echo). */
  const [flashId, setFlashId] = useState<string | null>(null)

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
      if (found instanceof Element) pickRefs.current.set(pick.id, found)
      else pickRefs.current.delete(pick.id)
    }
    syncMarkers()
  }

  /** Re-open an element's comment field and reveal its chip. */
  const onMarkClick = (id: string): void => {
    const pick = stateRef.current.picks.find((p) => p.id === id)
    const el = pickRefs.current.get(id)
    const picker = pickerOf(frameRef.current)
    if (picker !== null && el !== undefined) {
      picker.openComment(id, el, pick?.comment ?? '')
    }
    setFlashId(id)
    window.setTimeout(() => {
      setFlashId((current) => (current === id ? null : current))
    }, 1200)
    requestAnimationFrame(() => {
      chipRefs.current.get(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  }

  /** Enter on the floating field: commit a pending pick or update an existing one. */
  const onCommentCommit = (id: string, text: string): void => {
    const pending = pendingRef.current
    if (pending !== null && pending.id === id) {
      pendingRef.current = null
      pickRefs.current.set(id, pending.el)
      actions.addPick(pickFromElement(pending.el, id, text))
    } else {
      actions.updateComment(id, text)
    }
  }

  /** Esc on the floating field: drop an uncommitted pick, keep existing ones. */
  const onCommentDismiss = (id: string): void => {
    if (pendingRef.current?.id === id) pendingRef.current = null
  }

  /** Remove a pick and its echo marker. */
  const onRemovePick = (id: string): void => {
    actions.removePick(id)
    pickRefs.current.delete(id)
    if (pendingRef.current?.id === id) pendingRef.current = null
    pickerOf(frameRef.current)?.closeComment()
  }

  /** Wire the handoff callbacks on a (re-)injected picker surface. */
  const wireHandoff = (picker: PickerSurface): void => {
    picker.onPick = (el) => {
      const id = pickId()
      pendingRef.current = { id, el }
      picker.openComment(id, el, '')
    }
    picker.onCancel = () => { actionsRef.current.togglePickMode() }
    picker.onMarkClick = (id) => { onMarkClick(id) }
    picker.onCommentCommit = (id, text) => { onCommentCommit(id, text) }
    picker.onCommentDismiss = (id) => { onCommentDismiss(id) }
    picker.commentPlaceholder = t('panel.comment.float')
  }

  // Link interceptor: document capture-phase click; inert while closed.
  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      const current = stateRef.current
      if (!current.open) return
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const target = e.target
      if (!(target instanceof Element)) return
      if (target.closest('[data-webview-ui]') !== null) return
      const anchor = target.closest('a[href]')
      if (anchor === null) return
      const href = anchor.getAttribute('href') ?? ''
      if (!/^https?:\/\//i.test(href)) return
      e.preventDefault()
      actionsRef.current.open(href)
    }
    document.addEventListener('click', handler, true)
    return () => { document.removeEventListener('click', handler, true) }
  }, [])

  // After a frame load: detect same-origin, (re-)inject the picker, wire the
  // handoff, rebuild the echo markers, and honor an armed pick mode.
  const onFrameLoad = (): void => {
    const frame = frameRef.current
    if (frame === null) return
    if (!isSameOrigin(frame)) {
      setPickerReady(false)
      return
    }
    const picker = ensurePicker(frame)
    setPickerReady(picker !== null)
    if (picker !== null) {
      wireHandoff(picker)
      refreshPickRefs()
      if (stateRef.current.pickMode && !picker.isActive()) picker.activate()
    }
  }

  // Pick-mode lifecycle: activate/deactivate the injected picker and close
  // any floating comment field when picking ends.
  useEffect(() => {
    const frame = frameRef.current
    if (frame === null) return
    const picker = pickerOf(frame)
    if (picker === null) return
    if (state.pickMode && !picker.isActive()) picker.activate()
    if (!state.pickMode) {
      if (picker.isActive()) picker.deactivate()
      picker.closeComment()
      pendingRef.current = null
    }
  }, [state.pickMode])

  const navigate = (url: string): void => {
    if (url === '') return
    actions.open(url)
  }

  const onSend = async (): Promise<void> => {
    const current = stateRef.current
    if (current.picks.length === 0 || current.url === '' || current.sending) return
    actions.setError(null)
    actions.setSending(true)
    try {
      const text = formatAnnotation(current.url, titleOf(frameRef.current), current.picks, t)
      await sendText(text)
      actions.clearPicks()
      pickRefs.current.clear()
      pendingRef.current = null
    } catch (error) {
      actions.setError(t('panel.error.send', {
        message: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      actions.setSending(false)
    }
  }

  // Drag-resize: pointer capture on the left edge, width tracked by dx.
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null)
  const onResizeStart = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragState.current = { startX: e.clientX, startWidth: stateRef.current.width }
  }
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragState.current === null || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    actions.setWidth(dragState.current.startWidth - (e.clientX - dragState.current.startX))
  }
  const onResizeEnd = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragState.current === null) return
    dragState.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // Preview/annotations splitter: pointer capture on the divider, split
  // tracked as a share of the body height (clamped in the store).
  const splitDrag = useRef<{ startY: number; startSplit: number; bodyHeight: number } | null>(null)
  const onSplitStart = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const bodyHeight = bodyRef.current?.getBoundingClientRect().height ?? 1
    splitDrag.current = { startY: e.clientY, startSplit: stateRef.current.split, bodyHeight }
    setSplitDragging(true)
  }
  const onSplitMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = splitDrag.current
    if (drag === null || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    actions.setSplit(drag.startSplit + (e.clientY - drag.startY) / drag.bodyHeight)
  }
  const onSplitEnd = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (splitDrag.current === null) return
    splitDrag.current = null
    setSplitDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const frameSrc = state.url !== '' ? proxyUrl(state.url) : undefined
  const pickDisabled = !pickerReady || state.url === ''
  const onChipKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>, id: string): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onMarkClick(id)
    }
  }

  return (
    <>
      <button
        type="button"
        className="wv-toggle"
        aria-pressed={state.open || undefined}
        onClick={() => { actions.open() }}
        title={t('header.action')}
      >
        <IconBrowseOutline16 size={16} className="wv-toggle-icon" />
        <span>{t('header.action')}</span>
      </button>
      {state.open && createPortal(
        <div className="wv-panel" data-webview-ui style={{ width: state.width }}>
          <div
            className="wv-resize"
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
          />
          <div className="wv-header">
            <span className="wv-title">
              <IconBrowseOutline16 size={16} className="wv-title-icon" />
              {t('panel.title')}
            </span>
            <button
              type="button"
              className="wv-icon"
              title={t('panel.close')}
              onClick={() => { actions.close() }}
            >
              <IconCloseOutline16 size={16} />
            </button>
          </div>
          <div className="wv-urlrow">
            <Input
              className="wv-url"
              icon={<IconLinkOutline16 size={16} />}
              value={state.url}
              placeholder={t('panel.urlPlaceholder')}
              onChange={(e) => { actions.setUrl(e.target.value) }}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate(state.url) }}
              spellCheck={false}
            />
            <button
              type="button"
              className="wv-icon"
              title={t('panel.refresh')}
              disabled={state.url === ''}
              onClick={() => { setFrameKey((k) => k + 1) }}
            >
              <IconRefreshOutline16 size={16} />
            </button>
            {state.url !== '' && (
              <a
                className="wv-icon"
                href={state.url}
                target="_blank"
                rel="noopener noreferrer"
                title={t('panel.external')}
              >
                <IconRightUpOutline16 size={16} />
              </a>
            )}
            <button
              type="button"
              className={state.pickMode ? 'wv-icon wv-icon-accent' : 'wv-icon'}
              aria-pressed={state.pickMode || undefined}
              aria-label={state.pickMode ? t('panel.pick.off') : t('panel.pick')}
              title={state.pickMode ? t('panel.pick.off') : t('panel.pick')}
              disabled={pickDisabled}
              onClick={() => { actions.togglePickMode() }}
            >
              {state.pickMode
                ? <IconCheckOutline16 size={16} />
                : <IconListPenOutline16 size={16} />}
            </button>
          </div>
          {state.pickMode && <div className="wv-hint">{t('panel.pick.hint')}</div>}
          <div className="wv-body" ref={bodyRef}>
            <div className="wv-frame-wrap" style={{ flexBasis: `${state.split * 100}%` }}>
              {frameSrc !== undefined
                ? (
                  <iframe
                    key={frameKey}
                    ref={frameRef}
                    className="wv-frame"
                    src={frameSrc}
                    onLoad={onFrameLoad}
                  />
                )
                : <div className="wv-frame-overlay">{t('panel.noUrl')}</div>}
            </div>
            <div
              className="wv-split"
              role="separator"
              aria-orientation="horizontal"
              aria-valuemin={25}
              aria-valuemax={75}
              aria-valuenow={Math.round(state.split * 100)}
              data-dragging={splitDragging || undefined}
              onPointerDown={onSplitStart}
              onPointerMove={onSplitMove}
              onPointerUp={onSplitEnd}
            />
            <div className="wv-chips">
              <div className="wv-chips-head">
                <span className="wv-chips-label">{t('panel.picks.title')}</span>
                {state.picks.length > 0 && (
                  <span className="wv-chips-count">{state.picks.length}</span>
                )}
              </div>
              {state.picks.length === 0
                ? <div className="wv-chips-empty">{t('panel.picks.empty')}</div>
                : state.picks.map((pick, index) => (
                  <div
                    key={pick.id}
                    ref={(node) => { chipRefs.current.set(pick.id, node) }}
                    className={`wv-chip${flashId === pick.id ? ' wv-chip-flash' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${index + 1}. ${elementLabel(pick.snapshot)}`}
                    onClick={() => { onMarkClick(pick.id) }}
                    onKeyDown={(e) => { onChipKeyDown(e, pick.id) }}
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
                        onRemovePick(pick.id)
                      }}
                    >
                      <IconCloseOutline16 size={12} />
                    </button>
                  </div>
                ))}
            </div>
          </div>
          <div className="wv-footer">
            {state.error !== null && (
              <div className="wv-error" role="alert" title={state.error}>
                <IconWarningOutline16 size={14} className="wv-error-icon" />
                <span>{state.error}</span>
              </div>
            )}
            <Button
              variant="primary"
              size="md"
              icon={state.sending
                ? <IconLoadingOutline16 size={16} className="wv-spin" />
                : <IconSendOutline16 size={16} />}
              className="wv-send"
              disabled={state.picks.length === 0 || state.sending || state.url === ''}
              onClick={() => { void onSend() }}
            >
              {state.sending ? t('panel.send.progress') : t('panel.send')}
            </Button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

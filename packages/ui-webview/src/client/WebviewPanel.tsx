/**
 * Webview header action + floating panel: the entry point registered into
 * the conversation header's action list. The component renders the toggle
 * button, the floating right-edge overlay (portal to document.body), the
 * link interceptor (capture-phase, active only while the panel is open),
 * and the picker lifecycle inside the same-origin iframe.
 *
 * Presentation-only per the slot rules: state arrives via useStore/actions,
 * the send path via the injected sendText callback; no ctx, no contexts.
 */
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { proxyUrl } from '../rewrite.ts'
import { ensurePicker, isSameOrigin, pickFromElement, pickerOf } from './picker.ts'
import { formatAnnotation } from './format.ts'
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

/** The header action button + floating overlay panel (see module doc). */
export function WebviewHeaderAction({ useStore, actions, sendText, t }: WebviewSlotProps) {
  const state = useStore((s) => s)
  // Interceptor/picker effects read the freshest state through refs.
  const stateRef = useRef(state)
  stateRef.current = state
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  const frameRef = useRef<HTMLIFrameElement | null>(null)
  /** Whether the current frame content is same-origin (picker-capable). */
  const [pickerReady, setPickerReady] = useState(false)
  /** Bump to force an iframe remount (refresh button). */
  const [frameKey, setFrameKey] = useState(0)

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
  // handoff, and honor a pickMode that was armed before the load settled.
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
      picker.onPick = (el) => { actionsRef.current.addPick(pickFromElement(el, pickId())) }
      picker.onCancel = () => { actionsRef.current.togglePickMode() }
      if (stateRef.current.pickMode && !picker.isActive()) picker.activate()
    }
  }

  // Pick-mode lifecycle: activate/deactivate the injected picker.
  useEffect(() => {
    const frame = frameRef.current
    if (frame === null) return
    const picker = pickerOf(frame)
    if (picker === null) return
    if (state.pickMode && !picker.isActive()) picker.activate()
    if (!state.pickMode && picker.isActive()) picker.deactivate()
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

  const frameSrc = state.url !== ''
    ? (state.mode === 'proxy' ? proxyUrl(state.url) : state.url)
    : undefined
  const pickDisabled = state.mode === 'direct' || !pickerReady || state.url === ''

  return (
    <>
      <button
        type="button"
        className="wv-toggle"
        aria-pressed={state.open || undefined}
        onClick={() => { actions.open() }}
        title={t('header.action')}
      >
        {t('header.action')}
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
            <span className="wv-title">{t('panel.title')}</span>
            <input
              className="wv-url"
              value={state.url}
              placeholder={t('panel.urlPlaceholder')}
              onChange={(e) => { actions.setUrl(e.target.value) }}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate(state.url) }}
              spellCheck={false}
            />
            <button type="button" className="wv-icon" title={t('panel.open')} onClick={() => { navigate(state.url) }}>⏎</button>
            <button
              type="button" className="wv-icon" title={t('panel.refresh')}
              disabled={state.url === ''}
              onClick={() => { setFrameKey((k) => k + 1) }}
            >↻</button>
            {state.url !== '' && (
              <a className="wv-icon" href={state.url} target="_blank" rel="noopener noreferrer" title={t('panel.external')}>↗</a>
            )}
            <button type="button" className="wv-icon" title={t('panel.close')} onClick={() => { actions.close() }}>✕</button>
          </div>
          <div className="wv-toolbar">
            <button
              type="button"
              className="wv-chip"
              aria-pressed={state.mode === 'proxy' || undefined}
              onClick={() => { actions.setMode('proxy') }}
            >
              {t('panel.mode.proxy')}
            </button>
            <button
              type="button"
              className="wv-chip"
              aria-pressed={state.mode === 'direct' || undefined}
              onClick={() => { actions.setMode('direct') }}
            >
              {t('panel.mode.direct')}
            </button>
            <button
              type="button"
              className="wv-chip"
              aria-pressed={state.pickMode || undefined}
              disabled={pickDisabled}
              onClick={() => { actions.togglePickMode() }}
            >
              {state.pickMode ? t('panel.pick.off') : t('panel.pick')}
            </button>
            {state.pickMode && pickerReady && <span className="wv-hint">{t('panel.pick.hint')}</span>}
            {state.mode === 'direct' && <span className="wv-hint">{t('panel.pick.unavailable')}</span>}
          </div>
          <div className="wv-body">
            <div className="wv-frame-wrap">
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
              {state.error !== null && <div className="wv-frame-overlay">{state.error}</div>}
            </div>
            <div className="wv-annotations">
              {state.picks.length === 0
                ? <div className="wv-empty">{t('panel.picks.empty')}</div>
                : state.picks.map((pick) => (
                  <div className="wv-pick" key={pick.id}>
                    <div className="wv-pick-head">
                      <span className="wv-pick-selector" title={pick.snapshot.cssPath}>{pick.snapshot.cssPath}</span>
                      <button
                        type="button"
                        className="wv-icon"
                        title={t('panel.pick.remove')}
                        onClick={() => { actions.removePick(pick.id) }}
                      >
                        ✕
                      </button>
                    </div>
                    <pre className="wv-pick-snippet">{pick.snapshot.outerHTML}</pre>
                    <textarea
                      className="wv-comment"
                      placeholder={t('panel.comment.placeholder')}
                      value={pick.comment}
                      onChange={(e) => { actions.updateComment(pick.id, e.target.value) }}
                    />
                  </div>
                ))}
            </div>
          </div>
          <div className="wv-footer">
            <button
              type="button"
              className="wv-send"
              disabled={state.picks.length === 0 || state.sending || state.url === ''}
              onClick={() => { void onSend() }}
            >
              {state.sending ? t('panel.send.progress') : t('panel.send')}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

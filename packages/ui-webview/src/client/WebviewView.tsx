/**
 * WebviewView: the "预览" conversation view tab. Renders the URL row and a
 * full-height proxied iframe with the in-iframe element picker and annotation
 * echo layer (hover outline, floating comment field, numbered marker circles).
 *
 * Interaction model: the pick button (icon-only, far right of the URL row)
 * arms pick mode; clicking an element in the iframe opens a floating comment
 * field next to it; Enter commits the annotation into the shared store (the
 * dock above the composer renders the chips), Esc dismisses. Each annotation
 * echoes as a numbered circle over its element — clicking a circle re-expands
 * that element's comment field, as does a dock chip via the focus signal.
 *
 * The annotation XML is assembled here after every picks/url change and pushed
 * through the injected syncAnnotations (throttled in apply); the node half
 * prefixes it onto the next user message at send time. The link interceptor
 * (document capture-phase click) is active for the whole tab mount — the
 * conversation view ring mounts this component only while the tab is active.
 *
 * Presentation follows the dsh web design system: shared atoms (Input) and
 * the ic_ds_* icon set from @deepseek-ai/dsh-client-ui-primitives, plus the
 * --dsw-alias-* token vocabulary for everything custom. State arrives via
 * useStore/actions, the sync path via the injected syncAnnotations callback;
 * no ctx, no contexts.
 */
import { useEffect, useRef, useState } from 'react'
import {
  IconCheckOutline16,
  IconLinkOutline16,
  IconListPenOutline16,
  IconRefreshOutline16,
  IconRightUpOutline16,
  IconWarningOutline16,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { proxyUrl } from '../rewrite.ts'
import { ensurePicker, isSameOrigin, pickFromElement, pickerOf, type MarkerEntry, type PickerSurface } from './picker.ts'
import { formatAnnotation } from './format.ts'
import type { ElementSnapshot } from './contract.ts'
import type { WebviewStore } from './stores.ts'

/** The inject face shared by the preview tab and the annotation dock entries. */
export interface WebviewInjected {
  /**
   * Sync the current annotation XML for this session to the node half's
   * /webview-annotations route (trailing-throttled in apply); an empty xml
   * clears the session's server-side annotation state (send passes through).
   */
  syncAnnotations: (xml: string) => void
}

/** Full composed props: runtime + store + locale + inject shares. */
export type WebviewSlotProps =
  & PropsRuntime<'conversation.view'>
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

/** Compact element identity for the chips (dock + panel): tag#id.class1.class2. */
export function elementLabel(s: ElementSnapshot): string {
  const id = s.id !== '' ? `#${s.id}` : ''
  const classes = s.className !== ''
    ? `.${s.className.trim().split(/\s+/).filter(Boolean).join('.')}`
    : ''
  return `${s.tagName}${id}${classes}`
}

/** The preview tab view (see module doc). */
export function WebviewView({ useStore, actions, syncAnnotations, t }: WebviewSlotProps) {
  const state = useStore((s) => s)
  // Effect/event callbacks read the freshest state and props through refs.
  const stateRef = useRef(state)
  stateRef.current = state
  const actionsRef = useRef(actions)
  actionsRef.current = actions
  const syncRef = useRef(syncAnnotations)
  syncRef.current = syncAnnotations
  const tRef = useRef(t)
  tRef.current = t

  const frameRef = useRef<HTMLIFrameElement | null>(null)
  /** Live element references for each pick (echo markers + comment anchors). */
  const pickRefs = useRef(new Map<string, Element>())
  /** The in-flight pick whose comment field is open (not yet committed). */
  const pendingRef = useRef<{ id: string; el: Element } | null>(null)
  /** Whether the current frame content is same-origin (picker-capable). */
  const [pickerReady, setPickerReady] = useState(false)
  /** Bump to force an iframe remount (refresh button). */
  const [frameKey, setFrameKey] = useState(0)

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

  /** Re-open an element's comment field (marker-circle click or focus signal). */
  const onMarkClick = (id: string): void => {
    const pick = stateRef.current.picks.find((p) => p.id === id)
    const el = pickRefs.current.get(id)
    const picker = pickerOf(frameRef.current)
    if (picker !== null && el !== undefined) {
      picker.openComment(id, el, pick?.comment ?? '')
    }
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

  // Link interceptor: document capture-phase click, active for the whole tab
  // mount (the view ring mounts this component only while the tab is active).
  // Intercepts only unmodified left-clicks on http(s) links; clicks inside
  // [data-webview-ui] (this plugin's chrome) and inside the iframe (events
  // never bubble to the parent document) are never intercepted.
  useEffect(() => {
    const handler = (e: MouseEvent): void => {
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
      // A new page invalidates the previous annotation picks.
      actionsRef.current.setUrl(href)
      actionsRef.current.clearPicks()
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

  // Annotation sync: after any picks/url change, assemble the XML and push it
  // to the node half (empty picks clear — the next send passes through).
  useEffect(() => {
    const current = stateRef.current
    if (current.picks.length === 0) {
      syncRef.current('')
      return
    }
    if (current.url === '') return
    syncRef.current(formatAnnotation(current.url, titleOf(frameRef.current), current.picks, tRef.current))
  }, [state.picks, state.url])

  // Focus signal: a dock chip clicked this pick id — locate the element in
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
    const picker = pickerOf(frameRef.current)
    if (picker !== null && el !== undefined) {
      picker.openComment(id, el, pick?.comment ?? '')
    }
    actionsRef.current.setFocusPickId(null)
  }, [state.focusPickId])

  /** Navigate the iframe to `url`; a new page invalidates the previous picks. */
  const navigate = (url: string): void => {
    if (url === '') return
    actions.setUrl(url)
    actions.clearPicks()
  }

  const frameSrc = state.url !== '' ? proxyUrl(state.url) : undefined
  const pickDisabled = !pickerReady || state.url === ''

  return (
    <div className="wv-panel" data-webview-ui>
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
      {state.error !== null && (
        <div className="wv-error" role="alert" title={state.error}>
          <IconWarningOutline16 size={14} className="wv-error-icon" />
          <span>{state.error}</span>
        </div>
      )}
      {state.pickMode && <div className="wv-hint">{t('panel.pick.hint')}</div>}
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
        </div>
      </div>
    </div>
  )
}
